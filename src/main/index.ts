import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'
import { reducer, type Action } from '../shared/model'
import { applyOps, Clock, diffOps } from '../shared/sync'
import { AUDIT_LIMIT, auditEntries, toCsv, type AuditEntry, type AuditFilter, type AuditSource } from '../shared/audit'
import { subscriptionNotifications } from '../shared/subscriptions'
import { migrate } from '../shared/migrate'
import { seed } from '../shared/seed'
import { ensureTeams } from '../shared/teams'
import { adoptPersonal } from '../shared/sync'
import { McpController } from './mcp'
import { Store } from './db'
import { SyncEngine } from './sync'
import { CredentialStore, type Sealer } from './credentials'
import { FixtureGitHubClient, GitPoller, HttpGitHubClient, type GitHubClient } from './github'
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

async function openStore(): Promise<Store> {
  if (store) return store
  const next = new Store(join(dataDir(), 'prometheus.db'))
  await next.open()
  store = next
  sync = new SyncEngine(dataDir(), next, {
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

// Changes made by the main process itself (MCP tools, git polling). Same path as a UI save, with its own audit source.
function applyLocal(action: Action, source: Extract<AuditSource, 'mcp' | 'git'>) {
  if (!state || !sync) throw new Error('Prometheus has not loaded its data yet')
  const prev = state
  const next = reducer(prev, action)
  if (next === prev) return
  state = next
  const ops = diffOps(prev, next, sync.clock)
  sync.record(ops)
  audit(auditEntries(ops, source, new Date().toISOString(), action.type))
  // Notifications are deliberately left out of the sync op log, so they stay local to this device.
  state = subscriptionNotifications(prev, next, source === 'mcp' ? 'MCP' : 'Git')
  void persist(state)
  broadcast(state)
}

const mcp = new McpController(dataDir(), { read: () => state, apply: action => applyLocal(action, 'mcp') })

// GitHub. The token lives in the credential store (OS keychain when available). Settings are per device.
const GITHUB_TOKEN = 'github.token'
interface GitSettings {
  pollMinutes: number
  branchPrefix: string
  login: string | null
}

let credentials: CredentialStore | null = null
let gitSettings: GitSettings = { pollMinutes: 2, branchPrefix: '', login: null }
let poller: GitPoller | null = null
let pollerRun = 0
const gitSettingsFile = () => join(dataDir(), 'git-settings.json')
const tokenOf = () => credentials!.get(GITHUB_TOKEN)
// PROMETHEUS_GITHUB_FIXTURES is for tests only: it swaps the network client for fixture files.
const githubClient = (token: () => Promise<string | null>): GitHubClient =>
  process.env.PROMETHEUS_GITHUB_FIXTURES ? new FixtureGitHubClient(process.env.PROMETHEUS_GITHUB_FIXTURES, token) : new HttpGitHubClient(token)

async function initGit() {
  // Keychain sealing needs the app ready, so the store is made here rather than at import.
  // On Linux without a keyring Electron falls back to a fixed key ('basic_text'), which is not real protection,
  // so that counts as no keychain. Fixture runs (tests only) accept it.
  const weakLinux = process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text' && !process.env.PROMETHEUS_GITHUB_FIXTURES
  const sealer = !weakLinux && (await safeStorage.isAsyncEncryptionAvailable())
    ? ({
        seal: async text => (await safeStorage.encryptStringAsync(text)).toString('base64'),
        open: async sealed => {
          try {
            return (await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))).result
          } catch {
            return null
          }
        }
      } satisfies Sealer)
    : undefined
  credentials = new CredentialStore(join(dataDir(), 'credentials.json'), sealer)
  try {
    gitSettings = { ...gitSettings, ...JSON.parse(await fs.readFile(gitSettingsFile(), 'utf8')) }
  } catch {
    // No settings yet: the defaults stand
  }
}

async function saveGitSettings(patch: Partial<GitSettings>) {
  gitSettings = { ...gitSettings, ...patch }
  await fs.writeFile(gitSettingsFile(), JSON.stringify(gitSettings, null, 2))
}

// Polls while data is loaded and a token is saved. Called again whenever either changes; a stale call stops.
async function startPoller() {
  const run = ++pollerRun
  poller?.stop()
  poller = null
  const hasToken = !!credentials && (await credentials.has(GITHUB_TOKEN))
  if (run !== pollerRun || !hasToken || !state) return
  poller = new GitPoller({
    client: githubClient(tokenOf),
    read: () => state,
    apply: action => applyLocal(action, 'git'),
    intervalMs: gitSettings.pollMinutes * 60_000
  })
  poller.start()
}

// The token itself is never returned: only its last four characters.
async function gitStatus() {
  const token = credentials ? await tokenOf() : null
  const poll = poller?.status() ?? { lastPoll: null, error: null, backoffUntil: null }
  return {
    hasToken: !!token,
    login: token ? gitSettings.login : null,
    tokenHint: token ? token.slice(-4) : null,
    pollMinutes: gitSettings.pollMinutes,
    branchPrefix: gitSettings.branchPrefix,
    lastPoll: poll.lastPoll,
    error: poll.error,
    backoffUntil: poll.backoffUntil
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

ipcMain.handle('data:load', async () => {
  const db = await openStore()
  state = await loadInitial(db)
  base = state
  await sync!.init()
  void startPoller()
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

ipcMain.handle('git:status', () => gitStatus())
ipcMain.handle('git:setToken', async (_event, token: string) => {
  const value = token.trim()
  // The token is only ever kept sealed by the OS keychain, never in plain text.
  if (!credentials?.sealed) return { ok: false, error: 'No OS keychain is available on this device, so the token cannot be stored safely.' }
  try {
    const { login } = await githubClient(async () => value).viewer()
    await credentials!.set(GITHUB_TOKEN, value)
    await saveGitSettings({ login })
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
  await startPoller()
  return gitStatus()
})
ipcMain.handle('git:clearToken', async () => {
  await credentials!.delete(GITHUB_TOKEN)
  await saveGitSettings({ login: null })
  await startPoller()
  return gitStatus()
})
ipcMain.handle('git:test', async () => {
  try {
    return { ok: true, login: (await githubClient(tokenOf).viewer()).login }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
})
ipcMain.handle('git:refresh', async () => {
  await poller?.pollOnce()
  return gitStatus()
})
// Only these two settings are accepted from the renderer; anything else in the patch is ignored.
ipcMain.handle('git:setSettings', async (_event, patch: { pollMinutes?: unknown; branchPrefix?: unknown }) => {
  const next: Partial<GitSettings> = {}
  if (typeof patch?.pollMinutes === 'number' && Number.isFinite(patch.pollMinutes)) next.pollMinutes = Math.min(15, Math.max(1, Math.round(patch.pollMinutes)))
  if (typeof patch?.branchPrefix === 'string') next.branchPrefix = patch.branchPrefix.trim().slice(0, 40)
  await saveGitSettings(next)
  poller?.setInterval(gitSettings.pollMinutes * 60_000)
  return gitStatus()
})

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
  await sync!.join(folder, mode, passphrase)
  return sync!.getStatus()
})
ipcMain.handle('sync:unlock', async (_event, passphrase: string) => {
  await sync!.unlock(passphrase)
  return sync!.getStatus()
})
ipcMain.handle('sync:disable', () => sync!.disable())
ipcMain.handle('sync:now', () => sync!.syncNow())

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
  await initGit()
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
  poller?.stop()
  void sync?.flushNow()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
