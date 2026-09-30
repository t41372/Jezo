import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { JezoBridge, QuickCommand, SpeechStatus } from '../shared/bridge'
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
  speech: {
    status: () => ipcRenderer.invoke('speech:status'),
    install: () => ipcRenderer.invoke('speech:install'),
    onStatus: (listener) => listen<SpeechStatus>('speech:status', listener),
    start: () => ipcRenderer.invoke('speech:start'),
    audio: (chunk) => ipcRenderer.send('speech:audio', chunk),
    end: () => ipcRenderer.invoke('speech:end'),
    onText: (listener) => listen<string>('speech:text', listener),
  },
  calendar: {
    status: () => ipcRenderer.invoke('calendar:status'),
    events: (from, to) => ipcRenderer.invoke('calendar:events', from, to),
    subscribe: (url, name) => ipcRenderer.invoke('calendar:subscribe', url, name),
    unsubscribe: (id) => ipcRenderer.invoke('calendar:unsubscribe', id),
    refresh: (id) => ipcRenderer.invoke('calendar:refresh', id),
    connectMac: () => ipcRenderer.invoke('calendar:connect-mac'),
    disconnectMac: () => ipcRenderer.invoke('calendar:disconnect-mac'),
    openMacSettings: () => ipcRenderer.invoke('calendar:open-mac-settings'),
    setHidden: (id, hidden) => ipcRenderer.invoke('calendar:set-hidden', id, hidden),
    setGoogleClient: (id, secret) => ipcRenderer.invoke('calendar:set-google-client', id, secret),
    connectGoogle: (page) => ipcRenderer.invoke('calendar:connect-google', page),
    disconnectGoogle: (account) => ipcRenderer.invoke('calendar:disconnect-google', account),
    onChange: (listener) => listen<void>('calendar:changed', () => listener()),
  },
  schedule: {
    get: () => ipcRenderer.invoke('schedule:get'),
    set: (change) => ipcRenderer.invoke('schedule:set', change),
  },
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    setEnabled: (id, enabled) => ipcRenderer.invoke('skills:set-enabled', id, enabled),
    preview: (source) => ipcRenderer.invoke('skills:preview', source),
    pick: () => ipcRenderer.invoke('skills:pick'),
    previewUpdate: (id) => ipcRenderer.invoke('skills:preview-update', id),
    install: (token, paths, replace, overwriteModified) => ipcRenderer.invoke('skills:install', token, paths, replace, overwriteModified),
    write: (input, replace) => ipcRenderer.invoke('skills:write', input, replace),
    discard: (token) => ipcRenderer.invoke('skills:discard', token),
    remove: (id) => ipcRenderer.invoke('skills:remove', id),
    onChange: (listener) => listen<void>('skills:changed', listener),
  },
  memory: {
    remember: (input) => ipcRenderer.invoke('memory:remember', input),
    forget: (id) => ipcRenderer.invoke('memory:forget', id),
    restore: (record) => ipcRenderer.invoke('memory:restore', record),
    discard: (id) => ipcRenderer.invoke('memory:discard', id),
  },
  providers: {
    list: () => ipcRenderer.invoke('providers:list'),
    get: (id) => ipcRenderer.invoke('providers:get', id),
    setKey: (id, key) => ipcRenderer.invoke('providers:set-key', id, key),
    setBaseUrl: (id, baseUrl) => ipcRenderer.invoke('providers:set-base-url', id, baseUrl),
    check: (id, model) => ipcRenderer.invoke('providers:check', id, model),
    refresh: (id) => ipcRenderer.invoke('providers:refresh', id),
    setModelEnabled: (id, model, enabled) => ipcRenderer.invoke('providers:set-model-enabled', id, model, enabled),
    addCustom: (input) => ipcRenderer.invoke('providers:add-custom', input),
    remove: (id) => ipcRenderer.invoke('providers:remove', id),
    choosable: () => ipcRenderer.invoke('providers:choosable'),
    choices: () => ipcRenderer.invoke('providers:choices'),
    choose: (role, ref) => ipcRenderer.invoke('providers:choose', role, ref),
    setThinking: (level) => ipcRenderer.invoke('providers:set-thinking', level),
    importFromPi: () => ipcRenderer.invoke('providers:import-pi'),
    onChange: (listener) => listen<void>('providers:changed', listener),
  },
  history: {
    list: () => ipcRenderer.invoke('history:list'),
    undo: (id) => ipcRenderer.invoke('history:undo', id),
    onChange: (listener) => listen<void>('history:changed', listener),
  },
  setTheme: (source) => ipcRenderer.send('theme:set', source),
  setLanguage: (language) => ipcRenderer.send('language:set', language),
  onOpenSession: (listener) => listen<string>('session:open', listener),
  setContext: (pageTitle) => ipcRenderer.send('context:set', pageTitle),
  quick: {
    canHold: () => ipcRenderer.invoke('quick:can-hold'),
    continue: (session) => ipcRenderer.send('quick:continue', session),
    hide: () => ipcRenderer.send('quick:hide'),
    resize: (height) => ipcRenderer.send('quick:resize', height),
    onCommand: (listener) => listen<QuickCommand>('quick:command', listener),
  },
}

contextBridge.exposeInMainWorld('jezo', bridge)
