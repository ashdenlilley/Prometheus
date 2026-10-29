/// <reference types="vite/client" />
import type { AppData, Webhook, WebhookEvent } from '@shared/types'
import type { AuditFilter, AuditRow } from '@shared/audit'
import type { WebhookDelivery } from '@shared/webhooks'

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
      webhooks: {
        create: (projectId: string, url: string, events: WebhookEvent[], allowLocal: boolean) => Promise<{ webhook: Webhook; secret: string }>
        rotateSecret: (id: string) => Promise<string>
        remove: (id: string) => Promise<void>
        test: (id: string) => Promise<string>
        deliveries: (id: string) => Promise<WebhookDelivery[]>
        redeliver: (deliveryId: string) => Promise<string>
      }
    }
  }
}

export {}
