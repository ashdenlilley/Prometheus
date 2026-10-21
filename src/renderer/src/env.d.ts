import type { AppData } from '@shared/types'

declare global {
  interface Window {
    api: {
      load: () => Promise<AppData | null>
      save: (data: AppData) => Promise<void>
    }
  }
}

export {}
