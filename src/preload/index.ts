import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { JezoBridge, QuickCommand, QuickSubmission } from '../shared/bridge'

function listen<T>(channel: string, listener: (value: T) => void) {
  const handler = (_: IpcRendererEvent, value: T) => listener(value)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.off(channel, handler)
  }
}

const bridge: JezoBridge = {
  platform: process.platform,
  setTheme: (source) => ipcRenderer.send('theme:set', source),
  setContext: (pageTitle) => ipcRenderer.send('context:set', pageTitle),
  quick: {
    canHold: () => ipcRenderer.invoke('quick:can-hold'),
    submit: (text, as = 'ask') => ipcRenderer.send('quick:submit', { text, as }),
    hide: () => ipcRenderer.send('quick:hide'),
    onSubmit: (listener) => listen<QuickSubmission>('quick:submitted', listener),
    onCommand: (listener) => listen<QuickCommand>('quick:command', listener),
  },
}

contextBridge.exposeInMainWorld('jezo', bridge)
