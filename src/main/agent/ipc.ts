// The windows' view of the agent: conversations, and the history of what it changed.

import { app, BrowserWindow, ipcMain } from 'electron'
import type { CustomProviderInput, ModelRef, Schedule as ScheduleTimes } from '../../shared/bridge'
import type { Trigger } from '../../shared/session'
import type { Providers, Role } from './providers'
import type { Schedule } from './schedule'
import type { AgentHost } from './host'
import type { UndoLog } from './undo'
import type { PiClient, PiSendMessageInput } from '@assistant-ui/react-pi'

const broadcast = (channel: string, value?: unknown) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value)
}

const isQuickWindow = (window: BrowserWindow) => window.webContents.getURL().includes('/quick.html')

export function serveAgent(host: AgentHost, undo: UndoLog, providers: Providers, schedule: Schedule) {
  ipcMain.handle('schedule:get', () => schedule.times())
  ipcMain.handle('schedule:set', (_, change: Partial<ScheduleTimes>) => schedule.setTimes(change))
  ipcMain.handle('schedule:run', (_, id: string) => schedule.run(id))
  ipcMain.handle('schedule:history', (_, id: string) => schedule.rows(id))
  ipcMain.handle('schedule:skip', (_, id: string) => schedule.skip(id))
  ipcMain.handle('schedule:problems', () => schedule.problems())
  schedule.onHistory((id) => broadcast('schedule:history-changed', id))
  // The OS keeps this setting, so it's read from there (docs/design/automations.md, "Staying available").
  ipcMain.handle('schedule:at-login', () => app.getLoginItemSettings().openAtLogin)
  ipcMain.handle('schedule:set-at-login', (_, on: boolean) => {
    app.setLoginItemSettings({ openAtLogin: on })
    return app.getLoginItemSettings().openAtLogin
  })

  ipcMain.handle('agent:list', () => host.list())
  ipcMain.handle('agent:send', (_, id: string | null, text: string, trigger?: Trigger, behavior?: 'followUp' | 'steer') => host.send(id, text, trigger, behavior))
  ipcMain.handle('agent:start', (_, trigger: Trigger, zone?: string) => host.start(trigger, zone))
  ipcMain.handle('agent:abort', (_, id: string) => host.abort(id))
  ipcMain.handle('agent:nudge', (_, id: string) => host.nudge(id))
  ipcMain.handle('agent:commands', () => host.commands())
  ipcMain.handle('agent:arguments', (_, name: string, typed: string) => host.argumentSuggestions(name, typed))
  ipcMain.handle('agent:extension-answer', (_, id: string, request: string, value?: string | boolean) => host.answerExtension(id, request, value))
  host.onChange((view, catalogChanged) => {
    // The quick window has a small SessionView preview. Main uses Pi events
    // for streaming and only needs these views when the saved records change.
    for (const window of BrowserWindow.getAllWindows()) {
      if (catalogChanged || isQuickWindow(window)) window.webContents.send('agent:changed', view)
    }
  })

  ipcMain.handle('chat:list', () => host.listThreads())
  ipcMain.handle('chat:create', (_, input: Parameters<PiClient['createThread']>[0]) => host.createThread(input))
  ipcMain.handle('chat:get', (_, id: string) => host.getThread(id))
  ipcMain.handle('chat:send', (_, id: string, input: PiSendMessageInput) => host.sendMessage(id, input))
  ipcMain.handle('chat:clear-queue', (_, id: string) => host.clearQueue(id))
  ipcMain.handle('chat:edit', (_, id: string, entryId: string, text: string) => host.edit(id, entryId, text))
  ipcMain.handle('chat:retry', (_, id: string, entryId: string | null) => host.retry(id, entryId))
  ipcMain.handle('chat:navigate', (_, id: string, leafId: string) => host.navigate(id, leafId))
  ipcMain.handle('chat:rename', (_, id: string, title: string) => host.rename(id, title))
  ipcMain.handle('chat:models', () => providers.choosable().map(({ provider, model }) => ({ provider, modelId: model.id, name: model.name, supportsThinking: model.reasoning })))
  host.onEvent((event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!isQuickWindow(window)) window.webContents.send('chat:event', event)
    }
  })

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
  ipcMain.handle('providers:choose', (_, role: Role, ref: ModelRef | null) => providers.choose(role, ref))
  ipcMain.handle('providers:set-thinking', (_, level: string) => providers.setThinking(level))
  ipcMain.handle('providers:import-pi', () => providers.importFromPi())
  providers.onChange(() => broadcast('providers:changed'))


  ipcMain.handle('history:list', () => undo.list())
  ipcMain.handle('history:undo', (_, id: string) => undo.undo(id))
  undo.onChange(() => broadcast('history:changed'))
}
