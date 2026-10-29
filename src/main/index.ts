import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'path'
import { homedir, hostname } from 'os'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'
import { reducer, type Action } from '../shared/model'
import { applyOps, Clock, diffOps } from '../shared/sync'
import { AUDIT_LIMIT, auditEntries, toCsv, type AuditEntry, type AuditFilter } from '../shared/audit'
import { subscriptionNotifications } from '../shared/subscriptions'
import { migrate } from '../shared/migrate'
import { seed } from '../shared/seed'
import { ensureTeams } from '../shared/teams'
import { adoptPersonal } from '../shared/sync'
import { McpController } from './mcp'
import { Store } from './db'
import { SyncEngine } from './sync'
import { CloudSync, type CloudDevice, type CloudStatus } from './cloud'
import { CredentialStore, type Sealer } from './credentials'
import { installMenu } from './menu'

// Live UI testing only: expose Chrome DevTools on localhost when PROMETHEUS_DEBUG_PORT is set.
if (process.env.PROMETHEUS_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.PROMETHEUS_DEBUG_PORT)

const isMac = process.platform === 'darwin'
const dataDir = () => app.getPath('userData')
const legacyFile = () => join(dataDir(), 'prometheus-data.json')

// Latest data known to the main process. Every change goes through here.
let state: AppData | null = null
// What the renderer last received. Renderer saves are diffed against this, so a save made before
// it saw a remote change cannot revert that change.
let base: AppData | null = null
let store: Store | null = null
let sync: SyncEngine | null = null
let cloud: CloudSync | null = null
// False when no keychain sits behind safeStorage, so cloud sign-in is refused (see openStore).
let cloudAllowed = false

const NO_KEYCHAIN = 'Cloud sync needs the OS keychain, which is not available on this device.'
const keychainSealer: Sealer = {
  seal: async text => (await safeStorage.encryptStringAsync(text)).toString('base64'),
  open: async sealed => {
    try {
      return (await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))).result
    } catch {
      return null
    }
  }
}
// Used when there is no keychain: nothing is written in plain text, so sign-in fails with a clear message.
const noKeychain: Sealer = {
  seal: async () => {
    throw new Error(NO_KEYCHAIN)
  },
  open: async () => {
    throw new Error(NO_KEYCHAIN)
  }
}

async function keychainAvailable(): Promise<boolean> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) return false
  return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
}

async function openStore(): Promise<Store> {
  if (store) return store
  const next = new Store(join(dataDir(), 'prometheus.db'))
  await next.open()
  store = next
  const engine = new SyncEngine(dataDir(), next, {
    read: () => state!,
    write: applyRemote,
    keys: {
      // The derived sync key is stored encrypted by the OS keychain (DPAPI / Keychain), never in plain text.
      seal: async key => (await safeStorage.encryptStringAsync(key.toString('base64'))).toString('base64'),
      open: async sealed => {
        try {
          const { result } = await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))
          return Buffer.from(result, 'base64')
        } catch {
          return null
        }
      }
    }
  })
  sync = engine
  const insecureTest = process.env.PROMETHEUS_CLOUD_ALLOW_INSECURE_TEST === '1' // test-only: plain-text credentials
  const keychain = await keychainAvailable()
  cloudAllowed = keychain || insecureTest
  cloud = new CloudSync({
    dir: dataDir(),
    store: next,
    clock: engine.clock,
    clocks: engine.clocks,
    hooks: { read: () => state!, write: applyRemote },
    credentials: new CredentialStore(join(dataDir(), 'cloud-credentials.json'), keychain ? keychainSealer : insecureTest ? undefined : noKeychain)
  })
  return next
}

// First run: import the v2/v3 JSON file if present, otherwise seed sample content.
async function loadInitial(db: Store): Promise<AppData> {
  const existing = db.read()
  if (existing) {
    // An older database is upgraded once, and saved only when that changed it
    const upgraded = ensureTeams(migrate(existing))
    if (upgraded !== existing) await db.save(upgraded)
    return upgraded
  }
  try {
    const legacy = migrate(JSON.parse(await fs.readFile(legacyFile(), 'utf8')))
    await db.save(legacy)
    await fs.rename(legacyFile(), `${legacyFile()}.bak`)
    return legacy
  } catch {
    const fresh = seed()
    await db.save(fresh)
    return fresh
  }
}

function persist(data: AppData) {
  if (!store) return Promise.resolve()
  return store.save(data)
}

// Called before persist() in each change path, so the rows are in the database for that write.
// Audit must never break a change, so failures are only logged.
function audit(entries: AuditEntry[]) {
  try {
    store?.appendAudit(entries)
  } catch (err) {
    console.warn('audit write failed', err)
  }
}

function broadcast(data: AppData) {
  base = data
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:external', data)
  }
}

// Remote changes from the sync engine. Same path as MCP writes: live copy, disk, renderer.
function applyRemote(next: AppData) {
  const prev = state
  if (state) next = subscriptionNotifications(state, next, 'sync')
  state = next
  // A throwaway clock: auditing must not advance the sync clock.
  if (prev) audit(auditEntries(diffOps(prev, next, new Clock('audit')), 'sync', new Date().toISOString()))
  void persist(next)
  broadcast(next)
}

const host = {
  read: () => state,
  apply(action: Action) {
    if (!state || !sync) throw new Error('Prometheus has not loaded its data yet')
    const prev = state
    const next = reducer(prev, action)
    if (next === prev) return
    state = next
    const ops = diffOps(prev, next, sync.clock)
    sync.record(ops)
    cloud?.record(ops)
    audit(auditEntries(ops, 'mcp', new Date().toISOString(), action.type))
    // Notifications are deliberately left out of the sync op log, so they stay local to this device.
    state = subscriptionNotifications(prev, next, 'MCP')
    void persist(state)
    broadcast(state)
  }
}

const mcp = new McpController(dataDir(), host)

ipcMain.handle('data:load', async () => {
  const db = await openStore()
  state = await loadInitial(db)
  base = state
  await sync!.init()
  await cloud!.init()
  return state
})

// The renderer sends its whole working copy. Only the rows it changed since `base` become ops,
// and those are merged onto the live state. Rows changed remotely stay as they are.
ipcMain.handle('data:save', (_event, incoming: AppData) => {
  if (!state || !sync) {
    state = incoming
    base = incoming
    return persist(incoming)
  }
  const ops = diffOps(base ?? state, incoming, sync.clock)
  if (ops.length === 0) {
    base = incoming
    // Personal views are device-only and produce no ops; keep them anyway.
    const adopted = adoptPersonal(state, incoming)
    if (adopted !== state) {
      state = adopted
      return persist(adopted)
    }
    return
  }
  sync.record(ops)
  cloud?.record(ops)
  const merged = adoptPersonal(applyOps(state, ops).data, incoming)
  const remoteAhead = JSON.stringify(merged) !== JSON.stringify(incoming)
  state = merged
  audit(auditEntries(ops, 'ui', new Date().toISOString()))
  void persist(merged)
  if (remoteAhead) broadcast(merged)
  else base = incoming
})

// Only web links leave the app; anything else is ignored.
ipcMain.handle('shell:open', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
})

ipcMain.handle('mcp:status', () => mcp.status())
ipcMain.handle('mcp:setEnabled', (_event, enabled: boolean) => mcp.setEnabled(enabled))
ipcMain.handle('mcp:regenerate', () => mcp.regenerateToken())

// Sync folder. The default is the iCloud Drive folder on each platform; the user can pick any folder.
function defaultSyncFolder() {
  return isMac
    ? join(homedir(), 'Library', 'Mobile Documents', 'com~apple~CloudDocs', 'Prometheus')
    : join(homedir(), 'iCloudDrive', 'Prometheus')
}

ipcMain.handle('sync:status', () => sync?.getStatus() ?? null)
ipcMain.handle('sync:defaultFolder', () => defaultSyncFolder())
ipcMain.handle('sync:chooseFolder', async () => {
  const win = BrowserWindow.getFocusedWindow() ?? undefined
  const res = await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })
  return res.canceled ? null : res.filePaths[0]
})
ipcMain.handle('sync:inspect', (_event, folder: string) => sync!.inspect(folder))
ipcMain.handle('sync:join', async (_event, folder: string, mode: 'push' | 'adopt', passphrase: string) => {
  const c = cloud?.getStatus()
  if (c && (c.enabled || c.signIn)) throw new Error('Turn off cloud sync first.')
  await sync!.join(folder, mode, passphrase)
  return sync!.getStatus()
})
ipcMain.handle('sync:unlock', async (_event, passphrase: string) => {
  await sync!.unlock(passphrase)
  return sync!.getStatus()
})
ipcMain.handle('sync:disable', () => sync!.disable())
ipcMain.handle('sync:now', () => sync!.syncNow())

// Cloud sync (OS-359). Only one of folder sync and cloud sync may be on: checked here and in sync:join.
const requireCloud = (): CloudSync => {
  if (!cloud) throw new Error('Prometheus has not loaded its data yet')
  return cloud
}
ipcMain.handle('cloud:status', (): CloudStatus | null => cloud?.getStatus() ?? null)
ipcMain.handle('cloud:signIn', async (_event, serverUrl: string, email: string) => {
  if (typeof serverUrl !== 'string' || typeof email !== 'string') throw new Error('Enter a server URL and an email address.')
  if (!cloudAllowed) throw new Error(NO_KEYCHAIN)
  if (sync?.getStatus().enabled) throw new Error('Turn off folder sync first.')
  await requireCloud().startSignIn(serverUrl, email, hostname())
})
ipcMain.handle('cloud:cancelSignIn', () => cloud?.cancelSignIn())
ipcMain.handle('cloud:join', (_event, mode: 'merge' | 'adopt') => {
  if (mode !== 'merge' && mode !== 'adopt') throw new Error('Unknown join mode.')
  return requireCloud().join(mode)
})
ipcMain.handle('cloud:devices', (): Promise<CloudDevice[]> => requireCloud().devices())
ipcMain.handle('cloud:revokeDevice', (_event, id: string) => {
  if (typeof id !== 'string') throw new Error('Unknown device.')
  return requireCloud().revokeDevice(id)
})
ipcMain.handle('cloud:signOut', () => requireCloud().signOut())

ipcMain.handle('audit:list', (_event, filters: AuditFilter) => store?.readAudit(filters) ?? [])
ipcMain.handle('audit:csv', (_event, filters: AuditFilter) =>
  toCsv(store?.readAudit({ ...filters, limit: AUDIT_LIMIT }) ?? [])
)

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'Prometheus',
    backgroundColor: '#1f1f1f',
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Packaged builds take the icon from the bundle; dev runs need it set explicitly.
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  installMenu(isMac)
  createWindow()
  try {
    await mcp.start()
  } catch (err) {
    console.error('MCP did not start', err)
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void mcp.stop()
  void sync?.flushNow()
  cloud?.stop()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
