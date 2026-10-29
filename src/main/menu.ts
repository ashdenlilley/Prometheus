import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

// Replaces the default Edit menu, whose own undo/redo roles can swallow Cmd+Z before the renderer sees it.
// Undo/redo go to the renderer over IPC instead; text fields still get native undo there.
export function installMenu(isMac: boolean) {
  const send = (cmd: 'undo' | 'redo') => (_item: unknown, win?: unknown) =>
    ((win as BrowserWindow | undefined) ?? BrowserWindow.getFocusedWindow())?.webContents.send('edit:command', cmd)
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: send('undo') },
        { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: send('redo') },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' as const }] : []),
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
