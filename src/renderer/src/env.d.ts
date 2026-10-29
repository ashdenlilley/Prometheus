/// <reference types="vite/client" />
import type { Agent, AppData, PendingPost, Webhook, WebhookEvent } from '@shared/types'
import type { AuditFilter, AuditRow } from '@shared/audit'
import type { WebhookDelivery } from '@shared/webhooks'
import type { Role } from '@shared/permissions'

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
  userId: string | null
  role: Role | null
  presence: { userId: string; name: string; issueId?: string }[]
  backup: string | null
}

export interface CloudDevice {
  id: string
  name: string
  createdAt: number
  lastSeenAt: number
  current: boolean
}

export interface CloudMember {
  id: string
  name: string
  role: Role
  email?: string
  projects?: string[]
  createdAt?: number
}

export interface CloudInvite {
  id: string
  email: string
  name: string
  role: Role
  projects: string[]
  expiresAt: number
}

export interface CloudMembers {
  members: CloudMember[]
  invites: CloudInvite[]
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
      cloud: {
        status: () => Promise<CloudStatus | null>
        signIn: (serverUrl: string, email: string) => Promise<void>
        cancelSignIn: () => Promise<void>
        join: (mode: 'merge' | 'adopt') => Promise<void>
        devices: () => Promise<CloudDevice[]>
        revokeDevice: (id: string) => Promise<void>
        signOut: () => Promise<void>
        members: () => Promise<CloudMembers>
        invite: (body: { email: string; name?: string; role: Role; projects?: string[] }) => Promise<void>
        updateMember: (id: string, patch: { role?: Role; projects?: string[]; name?: string }) => Promise<void>
        removeMember: (id: string) => Promise<void>
        revokeInvite: (id: string) => Promise<void>
        setPresence: (issueId: string | null) => Promise<void>
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
