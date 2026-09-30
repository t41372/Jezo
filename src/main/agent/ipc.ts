// The windows' view of the agent: conversations, and the history of what it changed.

import { BrowserWindow, ipcMain } from 'electron'
import type { ModelChoice } from '../../shared/bridge'
import type { Trigger } from '../../shared/session'
import { getConfig, setConfig } from '../config'
import { modelStatus, setKey } from './models'
import type { AgentHost } from './host'
import type { UndoLog } from './undo'

const broadcast = (channel: string, value?: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value)
}

export function serveAgent(host: AgentHost, undo: UndoLog) {
  ipcMain.handle('agent:list', () => host.list())
  ipcMain.handle('agent:send', (_, id: string | null, text: string, trigger?: Trigger) => host.send(id, text, trigger))
  ipcMain.handle('agent:start', (_, trigger: Trigger) => host.start(trigger))
  ipcMain.handle('agent:abort', (_, id: string) => host.abort(id))
  host.onChange((view) => broadcast('agent:changed', view))

  ipcMain.handle('models:status', () => modelStatus(getConfig().model))
  ipcMain.handle('models:choose', async (_, choice: ModelChoice) => {
    const model = getConfig().model
    await setConfig({
      model: {
        use: choice.use ?? model.use,
        local: { ...model.local, ...(choice.localId && { id: choice.localId }) },
        // A different provider starts from its default model.
        cloud: choice.provider ? { provider: choice.provider } : { ...model.cloud, ...(choice.cloudId && { id: choice.cloudId }) },
      },
    })
    host.resetModels()
    return modelStatus(getConfig().model)
  })
  ipcMain.handle('models:set-key', async (_, provider: string, key: string | null) => {
    await setKey(provider, key)
    host.resetModels()
    return modelStatus(getConfig().model)
  })

  ipcMain.handle('history:list', () => undo.list())
  ipcMain.handle('history:undo', (_, id: string) => undo.undo(id))
  undo.onChange(() => broadcast('history:changed'))
}
