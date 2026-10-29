import { app, BrowserWindow, dialog, ipcMain, safeStorage, shell } from 'electron'
import { join } from 'path'
import { homedir } from 'os'
import { promises as fs } from 'fs'
import type { Agent, AppData, PendingPost } from '../shared/types'
import { reducer, type Action } from '../shared/model'
import { slackMessage, stripPendingPosts } from '../shared/integrations'
import { applyOps, Clock, diffOps } from '../shared/sync'
import { SlackSender, allowedWebhookUrl, webhookCredential, webhookHint } from './slack'
import { AUDIT_LIMIT, auditEntries, toCsv, type AuditEntry, type AuditFilter, type AuditSource } from '../shared/audit'
import { subscriptionNotifications } from '../shared/subscriptions'
import { migrate } from '../shared/migrate'
import { seed } from '../shared/seed'
import { ensureTeams } from '../shared/teams'
import { adoptPersonal } from '../shared/sync'
import { McpController, type McpKeys } from './mcp'
import { LEGACY_AGENT, agentAssignee, displayAssignee, isAgentAssignee, stampActor } from '../shared/agents'
import { Store } from './db'
import { SyncEngine } from './sync'
import { CredentialStore, type Sealer } from './credentials'
import { FixtureGitHubClient, GitPoller, HttpGitHubClient, type GitHubClient } from './github'
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
function slackSecrets(): CredentialStore {
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
    const url = await slackSecrets().get(webhookCredential(integration.id))
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
    if (!kept.has(i.id)) void slackSecrets().delete(webhookCredential(i.id))
  }
}

async function integrationStatus() {
  const store = slackSecrets()
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
  dropRemovedWebhooks(prev, next)
  // Changes that arrive by sync never post: pendingPosts is not synced, so they cannot arrive here.
  state = next
  // A throwaway clock: auditing must not advance the sync clock.
  if (prev) audit(auditEntries(diffOps(prev, next, new Clock('audit')), 'sync', new Date().toISOString()))
  void persist(next)
  broadcast(next)
}

// One path for changes made in the main process: MCP calls, webhook settings from the UI, and the dispatcher.
// stampAs, when given, marks new activity entries with that actor (an agent assignee for MCP and REST calls).
function applyLocal(action: Action, source: AuditSource, actor: string, stampAs?: string) {
  if (!state || !sync) throw new Error('Prometheus has not loaded its data yet')
  const prev = state
  let reduced = reducer(prev, action)
  if (reduced === prev) return
  // Posts queued by this change are sent by this device, then cleared before anything is stored
  const posts = reduced.pendingPosts ?? []
  if (posts.length) {
    void postPending(reduced, posts)
    reduced = reducer(reduced, { type: 'clearPendingPosts', ids: posts.map(p => p.id) })
  }
  const next = stampAs ? stampActor(prev, reduced, stampAs) : reduced
  state = next
  const ops = diffOps(prev, next, sync.clock)
  sync.record(ops)
  audit(auditEntries(ops, source, new Date().toISOString(), action.type))
  enqueueWebhooks(prev, next, actor)
  // Notifications are deliberately left out of the sync op log, so they stay local to this device.
  const by = stampAs && isAgentAssignee(stampAs) ? displayAssignee(prev, stampAs) : source === 'mcp' ? 'MCP' : source === 'git' ? 'Git' : 'Prometheus'
  state = subscriptionNotifications(prev, next, by)
  void persist(state)
  broadcast(state)
}

const host = {
  read: () => state,
  // Activity written here is attributed to the calling agent. Without an actor, that is the shared token.
  apply: (action: Action, actor?: string) => applyLocal(action, 'mcp', 'mcp', actor ?? agentAssignee(LEGACY_AGENT.id))
}

// The keychain is only reliable once the app is ready (Linux reports it unavailable before that),
// so the controller is created in whenReady.
let mcp: McpController | undefined
function mcpReady(): McpController {
  if (!mcp) throw new Error('MCP is not ready yet')
  return mcp
}

// Sealing uses the OS keychain. Without it, the token stays in plain text in mcp.json.
function mcpKeys(): McpKeys | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  return {
    seal: async token => (await safeStorage.encryptStringAsync(token)).toString('base64'),
    open: async sealed => {
      try {
        const { result } = await safeStorage.decryptStringAsync(Buffer.from(sealed, 'base64'))
        return result
      } catch {
        return null
      }
    }
  }
}

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
    apply: action => applyLocal(action, 'git', 'git'),
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
ipcMain.handle('data:save', (_event, received: AppData) => {
  // Pending posts belong to the window that queued them. They are never stored.
  const incoming = stripPendingPosts(received)
  dropRemovedWebhooks(state, incoming)
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

// Slack webhooks. The URL only goes in and never comes back out: the UI gets a hint.
ipcMain.handle('integrations:status', () => integrationStatus())
ipcMain.handle('integrations:setWebhook', async (_event, integrationId: string, url: string) => {
  if (!slackSecrets().sealed) {
    return { ok: false, error: 'Secure storage is not available on this device, so the webhook URL cannot be saved.' }
  }
  if (!allowedWebhookUrl(url)) {
    return { ok: false, error: 'That is not a Slack incoming webhook URL (https://hooks.slack.com/services/…).' }
  }
  await slackSecrets().set(webhookCredential(integrationId), url)
  return integrationStatus()
})
ipcMain.handle('integrations:clearWebhook', async (_event, integrationId: string) => {
  await slackSecrets().delete(webhookCredential(integrationId))
  return integrationStatus()
})
ipcMain.handle('integrations:test', async (_event, integrationId: string) => {
  const url = await slackSecrets().get(webhookCredential(integrationId))
  if (!url) return { ok: false, error: 'No webhook URL is set up on this device' }
  const text = 'Test message from Prometheus'
  return slack.send(url, { text, blocks: [{ type: 'section', text: { type: 'mrkdwn', text } }] })
})
// The renderer saves its change before it sends posts, so the change is in `state` by now.
ipcMain.handle('integrations:post', (_event, posts: PendingPost[]) => {
  if (state) void postPending(state, posts)
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

ipcMain.handle('mcp:status', () => mcpReady().status())
ipcMain.handle('mcp:setEnabled', (_event, enabled: boolean) => mcpReady().setEnabled(enabled))
ipcMain.handle('mcp:regenerate', () => mcpReady().regenerateToken())

// The token is returned once, here, and never stored in plain text. Only its hash goes into data.
ipcMain.handle('agents:create', (_event, name: string, color: string, level: Agent['level']) => {
  if (typeof name !== 'string' || !name.trim() || !['read', 'comment', 'write'].includes(level)) {
    throw new Error('An agent needs a name and a level of read, comment or write')
  }
  const created = mcpReady().createAgent(name.trim(), String(color), level)
  host.apply({ type: 'addAgent', agent: created.agent }, 'me')
  return created
})

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
  asyncEncryption = await safeStorage.isAsyncEncryptionAvailable().catch(() => false)
  // Packaged builds take the icon from the bundle; dev runs need it set explicitly.
  if (isMac && !app.isPackaged) app.dock?.setIcon(join(__dirname, '../../build/icon.png'))
  installMenu(isMac)
  await initGit()
  mcp = new McpController(dataDir(), host, mcpKeys())
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
  void mcp?.stop()
  poller?.stop()
  void sync?.flushNow()
})

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
