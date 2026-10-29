import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import type { AppData, PendingPost } from '../shared/types'
import { reducer, type Action } from '../shared/model'
import { slackMessage, stripPendingPosts } from '../shared/integrations'
import { applyOps, Clock, diffOps } from '../shared/sync'
import { CredentialStore, type Sealer } from './credentials'
import { SlackSender, allowedWebhookUrl, webhookCredential, webhookHint } from './slack'
import { AUDIT_LIMIT, auditEntries, toCsv, type AuditEntry, type AuditFilter } from '../shared/audit'
import { subscriptionNotifications } from '../shared/subscriptions'
import { migrate } from '../shared/migrate'
import { seed } from '../shared/seed'
import { ensureTeams } from '../shared/teams'
import { adoptPersonal } from '../shared/sync'
import { McpController } from './mcp'
import { Store } from './db'
import { SyncEngine } from './sync'
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

// Per-device secrets (Slack webhook URLs). Sealed by the OS keychain; never in AppData or sync.
let secretStore: CredentialStore | null = null
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
// Linux's 'basic_text' backend is not a keychain. It is only accepted by the test-only flag.
// Set once the app is ready: the async safeStorage API is what seals, so its availability is what counts.
let asyncEncryption = false
const keychainAvailable = () =>
  asyncEncryption &&
  (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text' || process.env.PROMETHEUS_SLACK_ALLOW_INSECURE_TEST === '1')
// Created on first use, because safeStorage can only be queried once the app is ready.
function secrets(): CredentialStore {
  secretStore ??= new CredentialStore(join(dataDir(), 'integration-secrets.json'), keychainAvailable() ? keychainSealer : undefined)
  return secretStore
}

const slack = new SlackSender({
  allow: allowedWebhookUrl,
  onFailure: ({ name, error, at }) => notifyLocal(`Slack post to ${name} failed: ${error}`, at)
})

// Notices about this device's own sends. Goes through apply so it reaches the renderer like any change.
function notifyLocal(text: string, at = new Date().toISOString()) {
  host.apply({ type: 'notify', notification: { id: crypto.randomUUID(), at, text, read: false } })
}

// Sends posts queued by this device. Each is resolved against the data it was queued from.
async function postPending(data: AppData, posts: PendingPost[]) {
  for (const post of posts) {
    const integration = data.integrations?.find(i => i.id === post.integrationId)
    const issue = data.issues.find(i => i.id === post.issueId)
    if (!integration || !issue) continue
    const url = await secrets().get(webhookCredential(integration.id))
    if (!url) {
      notifyLocal(`Slack integration ${integration.name} is not set up on this device`)
      continue
    }
    slack.enqueue({ name: integration.name, url, message: slackMessage(data, issue, { reason: post.reason, template: post.template }) })
  }
}

// A removed integration takes its webhook URL with it, on this device.
function dropRemovedWebhooks(prev: AppData | null, next: AppData) {
  const kept = new Set((next.integrations ?? []).map(i => i.id))
  for (const i of prev?.integrations ?? []) {
    if (!kept.has(i.id)) void secrets().delete(webhookCredential(i.id))
  }
}

async function integrationStatus() {
  const store = secrets()
  const configured: Record<string, { hint: string }> = {}
  for (const i of state?.integrations ?? []) {
    const url = await store.get(webhookCredential(i.id))
    if (url) configured[i.id] = { hint: webhookHint(url) }
  }
  return { keychain: store.sealed, configured }
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
  dropRemovedWebhooks(prev, next)
  // Changes that arrive by sync never post: pendingPosts is not synced, so they cannot arrive here.
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
    let next = reducer(prev, action)
    if (next === prev) return
    // Posts queued by this change are sent by this device, then cleared before anything is stored
    const posts = next.pendingPosts ?? []
    if (posts.length) {
      void postPending(next, posts)
      next = reducer(next, { type: 'clearPendingPosts', ids: posts.map(p => p.id) })
    }
    state = next
    const ops = diffOps(prev, next, sync.clock)
    sync.record(ops)
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
  return state
})

// The renderer sends its whole working copy. Only the rows it changed since `base` become ops,
// and those are merged onto the live state. Rows changed remotely stay as they are.
ipcMain.handle('data:save', (_event, received: AppData) => {
  // Pending posts belong to the window that queued them. They are never stored.
  const incoming = stripPendingPosts(received)
  dropRemovedWebhooks(state, incoming)
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

// Slack webhooks. The URL only goes in and never comes back out: the UI gets a hint.
ipcMain.handle('integrations:status', () => integrationStatus())
ipcMain.handle('integrations:setWebhook', async (_event, integrationId: string, url: string) => {
  if (!secrets().sealed) {
    return { ok: false, error: 'Secure storage is not available on this device, so the webhook URL cannot be saved.' }
  }
  if (!allowedWebhookUrl(url)) {
    return { ok: false, error: 'That is not a Slack incoming webhook URL (https://hooks.slack.com/services/…).' }
  }
  await secrets().set(webhookCredential(integrationId), url)
  return integrationStatus()
})
ipcMain.handle('integrations:clearWebhook', async (_event, integrationId: string) => {
  await secrets().delete(webhookCredential(integrationId))
  return integrationStatus()
})
ipcMain.handle('integrations:test', async (_event, integrationId: string) => {
  const url = await secrets().get(webhookCredential(integrationId))
  if (!url) return { ok: false, error: 'No webhook URL is set up on this device' }
  const text = 'Test message from Prometheus'
  return slack.send(url, { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] })
})
// The renderer saves its change before it sends posts, so the change is in `state` by now.
ipcMain.handle('integrations:post', (_event, posts: PendingPost[]) => {
  if (state) void postPending(state, posts)
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
  asyncEncryption = await safeStorage.isAsyncEncryptionAvailable().catch(() => false)
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
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
