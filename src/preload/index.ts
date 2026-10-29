import { contextBridge, ipcRenderer } from 'electron'
import type { AppData, PendingPost } from '../shared/types'
import type { AuditFilter, AuditRow } from '../shared/audit'

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load') as Promise<AppData | null>,
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
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status') as Promise<McpStatus>,
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('mcp:setEnabled', enabled) as Promise<McpStatus>,
    regenerate: () => ipcRenderer.invoke('mcp:regenerate') as Promise<McpStatus>
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
