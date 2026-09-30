// The windows' view of the workspace: they list items, ask for changes, and hear
// about every change, whoever made it.

import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { UndoLog } from '../agent/undo'
import { skillInstaller } from './skill-install'
import type { Fields } from '../../shared/workspace'
import { listSkills, setSkillEnabled } from './skills'
import type { Workspace } from './workspace'

const user = { by: 'user' } as const

export function serveWorkspace(workspace: Workspace, undo: UndoLog) {
  ipcMain.handle('workspace:list', () => workspace.list())
  ipcMain.handle('workspace:create', (_, kind: string, data: Fields, body: string) => workspace.create(kind, data, body, user))
  ipcMain.handle('workspace:update', (_, id: string, fields: Fields, options: { body?: string }) => workspace.update(id, fields, user, options))
  ipcMain.handle('workspace:remove', (_, id: string) => workspace.remove(id, user))
  ipcMain.handle('skills:list', () => listSkills(workspace.root))
  ipcMain.handle('skills:set-enabled', async (_, id: string, enabled: boolean) => {
    await setSkillEnabled(workspace, id, enabled)
    return listSkills(workspace.root)
  })
  const installer = skillInstaller(workspace)
  ipcMain.handle('skills:preview', (_, source: string) => installer.remote(source))
  ipcMain.handle('skills:pick', async () => {
    const picked = await dialog.showOpenDialog({
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Skills', extensions: ['zip', 'skill', 'gz', 'tgz'] }],
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return installer.local(picked.filePaths[0])
  })
  ipcMain.handle('skills:preview-update', (_, id: string) => installer.update(id))
  ipcMain.handle('skills:install', (_, token: string, paths: string[], replace?: boolean, overwriteModified?: boolean) => installer.install(token, paths, replace, overwriteModified))
  ipcMain.handle('skills:write', (_, input: { name: string; description: string; instructions: string }, replace?: boolean) => installer.write(input, replace))
  ipcMain.handle('skills:discard', (_, token: string) => installer.discard(token))
  ipcMain.handle('skills:remove', async (_, id: string) => {
    const skill = (await listSkills(workspace.root)).find((s) => s.id === id)
    if (!skill?.removable) throw new Error('Only top-level workspace methods can be removed.')
    await undo.userChange(`Remove "${skill.title}"`, () => installer.remove(id))
  })
  let skillsTimer: NodeJS.Timeout | undefined
  workspace.onFileChange((path) => {
    if (!/(^|\/)skills\//.test(path)) return
    clearTimeout(skillsTimer)
    skillsTimer = setTimeout(() => {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send('skills:changed')
    }, 80)
  })
  undo.onChange(() => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('skills:changed')
  })
  workspace.onChange((changes) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('workspace:changed', changes)
  })
}
