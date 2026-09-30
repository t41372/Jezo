import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { JezoBridge, QuickCommand } from '../shared/bridge'
import type { SessionView } from '../shared/session'
import type { ItemChanges } from '../shared/workspace'

function listen<T>(channel: string, listener: (value: T) => void) {
  const handler = (_: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const bridge: JezoBridge = {
  platform: process.platform,
  workspace: {
    list: () => ipcRenderer.invoke('workspace:list'),
    create: (kind, data, body = '') => ipcRenderer.invoke('workspace:create', kind, data, body),
    update: (id, fields, options = {}) => ipcRenderer.invoke('workspace:update', id, fields, options),
    remove: (id) => ipcRenderer.invoke('workspace:remove', id),
    onChange: (listener) => listen<ItemChanges>('workspace:changed', listener),
  },
  agent: {
    list: () => ipcRenderer.invoke('agent:list'),
    send: (id, text, trigger) => ipcRenderer.invoke('agent:send', id, text, trigger),
    start: (trigger) => ipcRenderer.invoke('agent:start', trigger),
    abort: (id) => ipcRenderer.invoke('agent:abort', id),
    onChange: (listener) => listen<SessionView>('agent:changed', listener),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('skills:set-enabled', id, enabled),
  },
  models: {
    status: () => ipcRenderer.invoke('models:status'),
    choose: (choice) => ipcRenderer.invoke('models:choose', choice),
    setKey: (provider, key) => ipcRenderer.invoke('models:set-key', provider, key),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    undo: (id) => ipcRenderer.invoke('history:undo', id),
    onChange: (listener) => listen<void>('history:changed', listener),
  },
  setTheme: (source) => ipcRenderer.send('theme:set', source),
  setContext: (pageTitle) => ipcRenderer.send('context:set', pageTitle),
  quick: {
    canHold: () => ipcRenderer.invoke('quick:can-hold'),
    continue: (session) => ipcRenderer.send('quick:continue', session),
    hide: () => ipcRenderer.send('quick:hide'),
    onContinue: (listener) => listen<string>('quick:continued', listener),
    onCommand: (listener) => listen<QuickCommand>('quick:command', listener),
  },
}

contextBridge.exposeInMainWorld('jezo', bridge)
