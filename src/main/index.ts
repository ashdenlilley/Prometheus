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
import { adoptPersonal } from '../shared/sync'
import { McpController } from './mcp'
import { Store } from './db'
import { SyncEngine } from './sync'
import { installMenu } from './menu'
import { WebhookDispatcher, WebhookSecrets } from './webhooks'
import { WEBHOOK_EVENTS, urlAllowed, webhookEvents, type WebhookDelivery } from '../shared/webhooks'
import { randomUUID } from 'crypto'
import type { Webhook, WebhookEvent } from '../shared/types'

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
let secrets: WebhookSecrets | null = null
let dispatcher: WebhookDispatcher | null = null

async function openStore(): Promise<Store> {
  if (store) return store
  const next = new Store(join(dataDir(), 'prometheus.db'))
  await next.open()
  store = next
  // Webhook secrets use the same OS keychain as the sync key. Plaintext only where no keychain exists.
  secrets = new WebhookSecrets(
    dataDir(),
    (await safeStorage.isAsyncEncryptionAvailable())
      ? {
          seal: async text => (await safeStorage.encryptStringAsync(text)).toString('base64'),
          open: async sealed => (await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))).result
        }
      : undefined
  )
  dispatcher = new WebhookDispatcher({
    store: next,
    getSecret: id => secrets!.getSecret(id),
    read: () => state,
    apply: action => applyLocal(action, 'automation', 'me')
  })
  dispatcher.start()
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

// Called before persist() in each change path, so the rows are in the database for that write.
// Audit must never break a change, so failures are only logged.
function audit(entries: AuditEntry[]) {
  try {
    store?.appendAudit(entries)
  } catch (err) {
    console.warn('audit write failed', err)
  }
}

// Queues outgoing webhooks for changes made on this device. Sync changes never call this.
// Like audit, a failure here must not break the change itself.
function enqueueWebhooks(prev: AppData, next: AppData, actor: string) {
  try {
    const events = webhookEvents(prev, next, actor, new Date().toISOString())
    if (events.length === 0) return
    dispatcher?.enqueue(events)
    // Send now rather than on the next 15 s tick. setImmediate lets the caller store the new state first.
    setImmediate(() => void dispatcher?.tick())
  } catch (err) {
    console.warn('webhook enqueue failed', err)
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

// One path for changes made in the main process: MCP calls, webhook settings from the UI, and the dispatcher.
function applyLocal(action: Action, source: AuditSource, actor: string) {
  if (!state || !sync) throw new Error('Prometheus has not loaded its data yet')
  const prev = state
  const next = reducer(prev, action)
  if (next === prev) return
  state = next
  const ops = diffOps(prev, next, sync.clock)
  sync.record(ops)
  audit(auditEntries(ops, source, new Date().toISOString(), action.type))
  enqueueWebhooks(prev, next, actor)
  // Notifications are deliberately left out of the sync op log, so they stay local to this device.
  state = subscriptionNotifications(prev, next, source === 'mcp' ? 'MCP' : 'Prometheus')
  void persist(state)
  broadcast(state)
}

const host = {
  read: () => state,
  apply: (action: Action) => applyLocal(action, 'mcp', 'mcp')
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
  const prev = state
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
  enqueueWebhooks(prev, merged, 'me')
  void persist(merged)
  if (remoteAhead) broadcast(merged)
  else base = incoming
})

// Only web links leave the app; anything else is ignored.
ipcMain.handle('shell:open', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
})

// Webhook config goes through applyLocal (audited as ui), so it syncs and reaches the renderer like any other change.
ipcMain.handle('webhooks:create', async (_event, projectId: string, url: string, events: WebhookEvent[], allowLocal: boolean) => {
  if (!state || !secrets) throw new Error('Prometheus has not loaded its data yet')
  if (!state.projects.some(p => p.id === projectId)) throw new Error('Project not found')
  const check = urlAllowed(url, allowLocal)
  if (!check.ok) throw new Error(check.reason)
  if (events.length === 0 || events.some(e => !WEBHOOK_EVENTS.includes(e))) throw new Error('Pick at least one valid event')
  const webhook: Webhook = { id: randomUUID(), projectId, url, events, enabled: true, allowLocal, createdAt: new Date().toISOString() }
  const secret = await secrets.createSecret(webhook.id)
  applyLocal({ type: 'addWebhook', webhook }, 'ui', 'me')
  return { webhook, secret }
})
ipcMain.handle('webhooks:rotateSecret', (_event, id: string) => {
  if (!state?.webhooks?.some(w => w.id === id)) throw new Error('Webhook not found')
  return secrets!.rotateSecret(id)
})
ipcMain.handle('webhooks:remove', async (_event, id: string) => {
  applyLocal({ type: 'deleteWebhook', id }, 'ui', 'me')
  await secrets!.deleteSecret(id)
})
ipcMain.handle('webhooks:test', (_event, id: string) => {
  const delivery = dispatcher?.testSend(id)
  if (!delivery) throw new Error('Webhook not found')
  void dispatcher!.tick()
  return delivery
})
ipcMain.handle('webhooks:deliveries', (_event, id: string) => store?.listDeliveries(id) ?? ([] as WebhookDelivery[]))
ipcMain.handle('webhooks:redeliver', (_event, deliveryId: string) => {
  const copy = dispatcher?.redeliver(deliveryId)
  if (!copy) throw new Error('Delivery not found')
  void dispatcher!.tick()
  return copy
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
  dispatcher?.stop()
  void mcp.stop()
  void sync?.flushNow()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
