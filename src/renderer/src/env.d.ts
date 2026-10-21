/// <reference types="vite/client" />
import type { AppData } from '@shared/types'

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
      mcp: {
        status: () => Promise<McpStatus>
        setEnabled: (enabled: boolean) => Promise<McpStatus>
        regenerate: () => Promise<McpStatus>
      }
    }
  }
}

export {}
