import { contextBridge, ipcRenderer } from 'electron'
import type { AppData } from '../shared/types'

contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load') as Promise<AppData | null>,
  save: (data: AppData) => ipcRenderer.invoke('data:save', data) as Promise<void>
})
