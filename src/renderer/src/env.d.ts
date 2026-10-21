/// <reference types="vite/client" />
import type { AppData } from '@shared/types'

declare global {
  interface Window {
    api: {
      platform: NodeJS.Platform
      load: () => Promise<AppData | null>
      save: (data: AppData) => Promise<void>
      openExternal: (url: string) => Promise<void>
    }
  }
}

export {}
