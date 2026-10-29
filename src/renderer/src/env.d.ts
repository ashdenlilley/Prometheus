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

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  port: number
}

export interface GitStatus {
  hasToken: boolean
  login: string | null
  tokenHint: string | null
  pollMinutes: number
  branchPrefix: string
  lastPoll: number | null
  error: string | null
  backoffUntil: number | null
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
      mcp: {
        status: () => Promise<McpStatus>
        setEnabled: (enabled: boolean) => Promise<McpStatus>
        regenerate: () => Promise<McpStatus>
      }
      git: {
        status: () => Promise<GitStatus>
        setToken: (token: string) => Promise<GitStatus | { ok: false; error: string }>
        clearToken: () => Promise<GitStatus>
        test: () => Promise<{ ok: boolean; login?: string; error?: string }>
        refresh: () => Promise<GitStatus>
        setSettings: (settings: { pollMinutes?: number; branchPrefix?: string }) => Promise<GitStatus>
      }
    }
  }
}

export {}
