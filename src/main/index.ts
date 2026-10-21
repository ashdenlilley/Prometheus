import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'
import { reducer, type Action } from '../shared/model'
import { applyOps, diffOps } from '../shared/sync'
import { migrate } from '../shared/migrate'
import { seed } from '../shared/seed'
import { McpController } from './mcp'
import { Store } from './db'
import { SyncEngine } from './sync'

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
      seal: key => safeStorage.encryptString(key.toString('base64')).toString('base64'),
      open: sealed => {
        try {
          return Buffer.from(safeStorage.decryptString(Buffer.from(sealed, 'base64')), 'base64')
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
  if (existing) return existing
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

function broadcast(data: AppData) {
  base = data
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:external', data)
  }
}

// Remote changes from the sync engine. Same path as MCP writes: live copy, disk, renderer.
function applyRemote(next: AppData) {
  state = next
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
    sync.record(diffOps(prev, next, sync.clock))
    void persist(next)
    broadcast(next)
  }
}

const mcp = new McpController(dataDir(), host)

ipcMain.handle('data:load', async () => {
  const db = await openStore()
  state = await loadInitial(db)
  base = state
  await sync!.init()
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
    return
  }
  sync.record(ops)
  const merged = applyOps(state, ops).data
  const remoteAhead = JSON.stringify(merged) !== JSON.stringify(incoming)
  state = merged
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
  await sync!.join(folder, mode, passphrase)
  return sync!.getStatus()
})
ipcMain.handle('sync:unlock', async (_event, passphrase: string) => {
  await sync!.unlock(passphrase)
  return sync!.getStatus()
})
ipcMain.handle('sync:disable', () => sync!.disable())
ipcMain.handle('sync:now', () => sync!.syncNow())

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
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
