import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import type { AppData } from '../shared/types'

const isMac = process.platform === 'darwin'
const dataFile = () => join(app.getPath('userData'), 'prometheus-data.json')

// Writes run one at a time so overlapping saves cannot interleave.
let writeQueue: Promise<void> = Promise.resolve()

async function writeData(data: AppData) {
  const tmp = `${dataFile()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, dataFile())
}

ipcMain.handle('data:load', async () => {
  try {
    return JSON.parse(await fs.readFile(dataFile(), 'utf8')) as AppData
  } catch {
    return null
  }
})

ipcMain.handle('data:save', (_event, data: AppData) => {
  writeQueue = writeQueue.then(() => writeData(data)).catch(err => console.error('save failed', err))
  return writeQueue
})

// Only web links leave the app; anything else is ignored.
ipcMain.handle('shell:open', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
})

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 620,
    title: 'Prometheus',
    backgroundColor: isMac ? '#00000000' : '#16171b',
    // macOS: full-size content with translucent sidebar; traffic lights sit over the sidebar.
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 18, y: 18 } : undefined,
    vibrancy: isMac ? 'sidebar' : undefined,
    visualEffectState: 'active',
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

app.whenReady().then(() => {
  // Packaged builds take the icon from the bundle; dev runs need it set explicitly.
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
