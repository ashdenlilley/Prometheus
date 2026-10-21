import { contextBridge, ipcRenderer } from 'electron'
import type { AppData } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  load: () => ipcRenderer.invoke('data:load') as Promise<AppData | null>,
  save: (data: AppData) => ipcRenderer.invoke('data:save', data) as Promise<void>,
  openExternal: (url: string) => ipcRenderer.invoke('shell:open', url) as Promise<void>,
  // Fires when the main process changes data (MCP tools). Returns an unsubscribe function.
  onExternal: (cb: (data: AppData) => void) => {
    const listener = (_event: unknown, data: AppData) => cb(data)
    ipcRenderer.on('data:external', listener)
    return () => {
      ipcRenderer.removeListener('data:external', listener)
    }
  },
  mcp: {
    status: () => ipcRenderer.invoke('mcp:status') as Promise<McpStatus>,
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('mcp:setEnabled', enabled) as Promise<McpStatus>,
    regenerate: () => ipcRenderer.invoke('mcp:regenerate') as Promise<McpStatus>
  }
})

export interface McpStatus {
  enabled: boolean
  running: boolean
  url: string
  token: string
  port: number
}
