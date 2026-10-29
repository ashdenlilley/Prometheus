/// <reference types="vite/client" />
import type { Agent, AppData, PendingPost, Webhook, WebhookEvent } from '@shared/types'
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
      createAgent: (name: string, color: string, level: Agent['level']) => Promise<{ agent: Agent; token: string }>
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
      webhooks: {
        create: (projectId: string, url: string, events: WebhookEvent[], allowLocal: boolean) => Promise<{ webhook: Webhook; secret: string }>
        rotateSecret: (id: string) => Promise<string>
        remove: (id: string) => Promise<void>
        test: (id: string) => Promise<string>
        deliveries: (id: string) => Promise<WebhookDelivery[]>
        redeliver: (deliveryId: string) => Promise<string>
      }
      integrations: {
        status: () => Promise<IntegrationStatus>
        setWebhook: (integrationId: string, url: string) => Promise<IntegrationStatus | { ok: false; error: string }>
        clearWebhook: (integrationId: string) => Promise<IntegrationStatus>
        test: (integrationId: string) => Promise<IntegrationTestResult>
        post: (posts: PendingPost[]) => Promise<void>
      }
    }
  }
}

export {}
