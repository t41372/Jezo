// The ⌥X window. A press opens it for typing; holding ⌥X shows it for voice
// without taking focus from the app the user is in, until the key is released.

import { BrowserWindow, systemPreferences, type BrowserWindowConstructorOptions } from 'electron'
import type { QuickCommand } from '../shared/bridge'

const SIZE = {
  type: { width: 640, height: 380 },
  voice: { width: 680, height: 168 },
}

let window: BrowserWindow | null = null
let mode: 'type' | 'voice' = 'type'
/** Whether ⌥X is held right now. The key can be released while macOS asks for the microphone. */
let holding = false

export function createQuickWindow(options: BrowserWindowConstructorOptions, load: (w: BrowserWindow) => void) {
  window = new BrowserWindow({
    ...SIZE.type,
    show: false,
    frame: false,
    transparent: process.platform !== 'darwin',
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    ...options,
  })
  window.on('blur', () => window?.hide())
  window.on('closed', () => (window = null))
  load(window)
}

function send(command: QuickCommand) {
  window?.webContents.send('quick:command', command)
}

function setMode(next: 'type' | 'voice') {
  if (!window) return
  mode = next
  window.setSize(SIZE[next].width, SIZE[next].height)
  // Voice is a dark capsule; typing uses the light or dark popover material.
  if (process.platform === 'darwin') window.setVibrancy(next === 'voice' ? 'hud' : 'popover')
  window.center()
}

export function hideQuick() {
  window?.hide()
}

/** A press: open for typing, or close if it's already open for typing. */
export function toggleTyping() {
  if (!window) return
  if (window.isVisible() && mode === 'type') return window.hide()
  setMode('type')
  send({ kind: 'type' })
  window.show()
  window.focus()
}

export async function startVoice(context: string | null) {
  if (!window) return
  holding = true
  if (process.platform === 'darwin') await systemPreferences.askForMediaAccess('microphone')
  // Released while the permission dialog was up: there's nothing to listen to.
  if (!holding) return
  setMode('voice')
  send({ kind: 'voice-start', context })
  window.showInactive()
}

/** The key was released. The window takes focus so the answer can be read and dismissed. */
export function endVoice() {
  holding = false
  if (!window || mode !== 'voice') return
  setMode('type')
  send({ kind: 'voice-end' })
  window.show()
  window.focus()
}
