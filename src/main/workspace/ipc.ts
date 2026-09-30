// The windows' view of the workspace: they list items, ask for changes, and hear
// about every change, whoever made it.

import { BrowserWindow, ipcMain } from 'electron'
import type { Fields } from '../../shared/workspace'
import { listSkills, setSkillEnabled } from './skills'
import type { Workspace } from './workspace'

const user = { by: 'user' } as const

export function serveWorkspace(workspace: Workspace) {
  ipcMain.handle('workspace:list', () => workspace.list())
  ipcMain.handle('workspace:create', (_, kind: string, data: Fields, body: string) => workspace.create(kind, data, body, user))
  ipcMain.handle('workspace:update', (_, id: string, fields: Fields, options: { body?: string }) => workspace.update(id, fields, user, options))
  ipcMain.handle('workspace:remove', (_, id: string) => workspace.remove(id, user))
  ipcMain.handle('skills:list', () => listSkills(workspace.root))
  ipcMain.handle('skills:set-enabled', async (_, id: string, enabled: boolean) => {
    await setSkillEnabled(workspace, id, enabled)
    return listSkills(workspace.root)
  })
  workspace.onChange((changes) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('workspace:changed', changes)
  })
}
