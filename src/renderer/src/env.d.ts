/// <reference types="vite/client" />
import type { AppData } from '@shared/types'

export interface SyncStatus {
  enabled: boolean
  folder: string | null
  deviceId: string
  deviceName: string
  pending: number
  lastSync: number | null
  error: string | null
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
      onExternal: (cb: (data: AppData) => void) => () => void
      sync: {
        status: () => Promise<SyncStatus | null>
        defaultFolder: () => Promise<string>
        chooseFolder: () => Promise<string | null>
        inspect: (folder: string) => Promise<{ devices: number; segments: number }>
        join: (folder: string, mode: 'push' | 'adopt') => Promise<SyncStatus>
        disable: () => Promise<void>
        now: () => Promise<void>
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
