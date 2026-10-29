/// <reference types="vite/client" />
import type { AppData } from '@shared/types'
import type { AuditFilter, AuditRow } from '@shared/audit'

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

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  port: number
}

declare global {
  interface Window {
    api: {
      platform: NodeJS.Platform
      load: () => Promise<AppData | null>
      save: (data: AppData) => Promise<void>
      openExternal: (url: string) => Promise<void>
      auditList: (filters: AuditFilter) => Promise<AuditRow[]>
      auditCsv: (filters: AuditFilter) => Promise<string>
      onExternal: (cb: (data: AppData) => void) => () => void
      onEditCommand: (cb: (cmd: 'undo' | 'redo') => void) => () => void
      sync: {
        status: () => Promise<SyncStatus | null>
        defaultFolder: () => Promise<string>
        chooseFolder: () => Promise<string | null>
        inspect: (folder: string) => Promise<SyncInspect>
        join: (folder: string, mode: 'push' | 'adopt', passphrase: string) => Promise<SyncStatus>
        unlock: (passphrase: string) => Promise<SyncStatus>
        disable: () => Promise<void>
        now: () => Promise<void>
      }
      cloud: {
        status: () => Promise<CloudStatus | null>
        signIn: (serverUrl: string, email: string) => Promise<void>
        cancelSignIn: () => Promise<void>
        join: (mode: 'merge' | 'adopt') => Promise<void>
        devices: () => Promise<CloudDevice[]>
        revokeDevice: (id: string) => Promise<void>
        signOut: () => Promise<void>
      }
      mcp: {
        status: () => Promise<McpStatus>
        setEnabled: (enabled: boolean) => Promise<McpStatus>
        regenerate: () => Promise<McpStatus>
      }
    }
  }
}

export {}
