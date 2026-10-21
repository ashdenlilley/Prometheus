import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'
import { reducer, type Action } from '../shared/model'
import { McpController } from './mcp'

// Live UI testing only: expose Chrome DevTools on localhost when PROMETHEUS_DEBUG_PORT is set.
if (process.env.PROMETHEUS_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.PROMETHEUS_DEBUG_PORT)

const isMac = process.platform === 'darwin'
const dataDir = () => app.getPath('userData')
const dataFile = () => join(dataDir(), 'prometheus-data.json')

// Latest data known to the main process. The renderer saves here; MCP writes go through here.
let state: AppData | null = null

// Writes run one at a time so overlapping saves cannot interleave.
let writeQueue: Promise<void> = Promise.resolve()

function persist(data: AppData) {
  writeQueue = writeQueue
    .then(async () => {
      const tmp = `${dataFile()}.tmp`
      await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
      await fs.rename(tmp, dataFile())
    })
    .catch(err => console.error('save failed', err))
  return writeQueue
}

function broadcast(data: AppData) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('data:external', data)
  }
}

const host = {
  read: () => state,
  apply(action: Action) {
    if (!state) throw new Error('Prometheus has not loaded its data yet')
    state = reducer(state, action)
    persist(state)
    broadcast(state)
  }
}

const mcp = new McpController(dataDir(), host)

ipcMain.handle('data:load', async () => {
  try {
    const loaded = JSON.parse(await fs.readFile(dataFile(), 'utf8')) as AppData
    // Only v3 data is usable by MCP; older files are upgraded by the renderer on first save.
    if (loaded.version === 3) state = loaded
    return loaded
  } catch {
    return null
  }
})

ipcMain.handle('data:save', (_event, data: AppData) => {
  state = data
  return persist(data)
})

// Only web links leave the app; anything else is ignored.
ipcMain.handle('shell:open', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
})

ipcMain.handle('mcp:status', () => mcp.status())
ipcMain.handle('mcp:setEnabled', (_event, enabled: boolean) => mcp.setEnabled(enabled))
ipcMain.handle('mcp:regenerate', () => mcp.regenerateToken())

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
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
