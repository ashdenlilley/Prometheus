import { contextBridge, ipcRenderer } from 'electron'
import type { Agent, AppData, PendingPost, Webhook, WebhookEvent } from '../shared/types'
import type { AuditFilter, AuditRow } from '../shared/audit'
import type { WebhookDelivery } from '../shared/webhooks'

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load') as Promise<AppData | null>,
  createAgent: (name: string, color: string, level: Agent['level']) =>
    ipcRenderer.invoke('agents:create', name, color, level) as Promise<{ agent: Agent; token: string }>,
  save: (data: AppData) => ipcRenderer.invoke('data:save', data) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url) as Promise<void>,
  auditList: (filters: AuditFilter) => ipcRenderer.invoke('audit:list', filters) as Promise<AuditRow[]>,
  auditCsv: (filters: AuditFilter) => ipcRenderer.invoke('audit:csv', filters) as Promise<string>,
  // Fires when the main process changes data (MCP tools). Returns an unsubscribe function.
  onExternal: (cb: (data: AppData) => void) => {
    const listener = (_event: unknown, data: AppData) => cb(data)
    ipcRenderer.on('data:external', listener)
    return () => {
      ipcRenderer.removeListener('data:external', listener)
    }
  },
  // Fires for the Edit menu's Undo/Redo (Cmd+Z). Returns an unsubscribe function.
  onEditCommand: (cb: (cmd: 'undo' | 'redo') => void) => {
    const listener = (_event: unknown, cmd: 'undo' | 'redo') => cb(cmd)
    ipcRenderer.on('edit:command', listener)
    return () => {
      ipcRenderer.removeListener('edit:command', listener)
    }
  },
  sync: {
    status: () => ipcRenderer.invoke('sync:status') as Promise<SyncStatus | null>,
    defaultFolder: () => ipcRenderer.invoke('sync:defaultFolder') as Promise<string>,
    chooseFolder: () => ipcRenderer.invoke('sync:chooseFolder') as Promise<string | null>,
    inspect: (folder: string) => ipcRenderer.invoke('sync:inspect', folder) as Promise<SyncInspect>,
    join: (folder: string, mode: 'push' | 'adopt', passphrase: string) =>
      ipcRenderer.invoke('sync:join', folder, mode, passphrase) as Promise<SyncStatus>,
    unlock: (passphrase: string) => ipcRenderer.invoke('sync:unlock', passphrase) as Promise<SyncStatus>,
    disable: () => ipcRenderer.invoke('sync:disable') as Promise<void>,
    now: () => ipcRenderer.invoke('sync:now') as Promise<void>
  },
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status') as Promise<CloudStatus | null>,
    signIn: (serverUrl: string, email: string) => ipcRenderer.invoke('cloud:signIn', serverUrl, email) as Promise<void>,
    cancelSignIn: () => ipcRenderer.invoke('cloud:cancelSignIn') as Promise<void>,
    join: (mode: 'merge' | 'adopt') => ipcRenderer.invoke('cloud:join', mode) as Promise<void>,
    devices: () => ipcRenderer.invoke('cloud:devices') as Promise<CloudDevice[]>,
    revokeDevice: (id: string) => ipcRenderer.invoke('cloud:revokeDevice', id) as Promise<void>,
    signOut: () => ipcRenderer.invoke('cloud:signOut') as Promise<void>
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status') as Promise<McpStatus>,
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('mcp:setEnabled', enabled) as Promise<McpStatus>,
    regenerate: () => ipcRenderer.invoke('mcp:regenerate') as Promise<McpStatus>
  },
  git: {
    status: () => ipcRenderer.invoke('git:status') as Promise<GitStatus>,
    setToken: (token: string) => ipcRenderer.invoke('git:setToken', token) as Promise<GitStatus | { ok: false; error: string }>,
    clearToken: () => ipcRenderer.invoke('git:clearToken') as Promise<GitStatus>,
    test: () => ipcRenderer.invoke('git:test') as Promise<{ ok: boolean; login?: string; error?: string }>,
    refresh: () => ipcRenderer.invoke('git:refresh') as Promise<GitStatus>,
    setSettings: (settings: { pollMinutes?: number; branchPrefix?: string }) => ipcRenderer.invoke('git:setSettings', settings) as Promise<GitStatus>
  },
  webhooks: {
    create: (projectId: string, url: string, events: WebhookEvent[], allowLocal: boolean) =>
      ipcRenderer.invoke('webhooks:create', projectId, url, events, allowLocal) as Promise<{ webhook: Webhook; secret: string }>,
    rotateSecret: (id: string) => ipcRenderer.invoke('webhooks:rotateSecret', id) as Promise<string>,
    remove: (id: string) => ipcRenderer.invoke('webhooks:remove', id) as Promise<void>,
    test: (id: string) => ipcRenderer.invoke('webhooks:test', id) as Promise<string>,
    deliveries: (id: string) => ipcRenderer.invoke('webhooks:deliveries', id) as Promise<WebhookDelivery[]>,
    redeliver: (deliveryId: string) => ipcRenderer.invoke('webhooks:redeliver', deliveryId) as Promise<string>
  },
  integrations: {
    status: () => ipcRenderer.invoke('integrations:status') as Promise<IntegrationStatus>,
    setWebhook: (integrationId: string, url: string) =>
      ipcRenderer.invoke('integrations:setWebhook', integrationId, url) as Promise<IntegrationStatus | { ok: false; error: string }>,
    clearWebhook: (integrationId: string) => ipcRenderer.invoke('integrations:clearWebhook', integrationId) as Promise<IntegrationStatus>,
    test: (integrationId: string) => ipcRenderer.invoke('integrations:test', integrationId) as Promise<IntegrationTestResult>,
    post: (posts: PendingPost[]) => ipcRenderer.invoke('integrations:post', posts) as Promise<void>
  }
})

export interface IntegrationStatus {
  keychain: boolean
  configured: Record<string, { hint: string }> // integration id -> masked webhook URL
}

export type IntegrationTestResult = { ok: true } | { ok: false; status?: number; error: string }


export interface GitStatus {
  hasToken: boolean
  login: string | null
  tokenHint: string | null // last four characters of the token only
  pollMinutes: number
  branchPrefix: string
  lastPoll: number | null
  error: string | null
  backoffUntil: number | null
}

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  port: number
}

export interface SyncStatus {
  enabled: boolean
  folder: string | null
  deviceId: string
  deviceName: string
  pending: number
  lastSync: number | null
  error: string | null
  needsPassphrase: boolean
}

export interface SyncInspect {
  devices: number
  segments: number
  encrypted: boolean
}

export interface CloudStatus {
  enabled: boolean
  serverUrl: string
  email: string
  deviceId: string
  deviceName: string
  state: 'off' | 'signing-in' | 'connecting' | 'connected' | 'offline' | 'error'
  pending: number
  lastSync: number | null
  error: string | null
  signIn: { email: string; expiresAt: number } | null
  needsJoin: boolean
}

export interface CloudDevice {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  current: boolean
}
