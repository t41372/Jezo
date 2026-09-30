// The windows' view of the agent: conversations, and the history of what it changed.

import { BrowserWindow, ipcMain } from 'electron'
import type { CustomProviderInput, ModelRef, Schedule as ScheduleTimes } from '../../shared/bridge'
import type { Trigger } from '../../shared/session'
import type { Providers } from './providers'
import type { Schedule } from './schedule'
import type { AgentHost } from './host'
import type { UndoLog } from './undo'

const broadcast = (channel: string, value?: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value)
}

export function serveAgent(host: AgentHost, undo: UndoLog, providers: Providers, schedule: Schedule) {
  ipcMain.handle('schedule:get', () => schedule.times())
  ipcMain.handle('schedule:set', (_, change: Partial<ScheduleTimes>) => schedule.setTimes(change))

  ipcMain.handle('agent:list', () => host.list())
  ipcMain.handle('agent:send', (_, id: string | null, text: string, trigger?: Trigger) => host.send(id, text, trigger))
  ipcMain.handle('agent:start', (_, trigger: Trigger) => host.start(trigger))
  ipcMain.handle('agent:abort', (_, id: string) => host.abort(id))
  host.onChange((view) => broadcast('agent:changed', view))

  ipcMain.handle('providers:list', () => providers.list())
  ipcMain.handle('providers:get', (_, id: string) => providers.detail(id))
  ipcMain.handle('providers:set-key', (_, id: string, key: string | null) => providers.setKey(id, key))
  ipcMain.handle('providers:set-base-url', (_, id: string, url: string) => providers.setBaseUrl(id, url))
  ipcMain.handle('providers:check', (_, id: string, model: string) => providers.check(id, model))
  ipcMain.handle('providers:refresh', (_, id: string) => providers.refresh(id))
  ipcMain.handle('providers:set-model-enabled', (_, id: string, model: string, enabled: boolean) => providers.setModelEnabled(id, model, enabled))
  ipcMain.handle('providers:add-custom', (_, input: CustomProviderInput) => providers.addCustom(input))
  ipcMain.handle('providers:remove', (_, id: string) => providers.remove(id))
  ipcMain.handle('providers:choosable', () => providers.choosable())
  ipcMain.handle('providers:choices', () => providers.choices())
  ipcMain.handle('providers:choose', (_, role: 'main' | 'background', ref: ModelRef | null) => providers.choose(role, ref))
  ipcMain.handle('providers:set-thinking', (_, level: string) => providers.setThinking(level))
  ipcMain.handle('providers:import-pi', () => providers.importFromPi())
  providers.onChange(() => broadcast('providers:changed'))


  ipcMain.handle('history:list', () => undo.list())
  ipcMain.handle('history:undo', (_, id: string) => undo.undo(id))
  undo.onChange(() => broadcast('history:changed'))
}
