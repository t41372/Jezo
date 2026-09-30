// The ⌥X window. A press opens it for typing; holding ⌥X shows it for voice
// without taking focus from the app the user is in, until the key is released.

import { BrowserWindow, screen, systemPreferences, type BrowserWindowConstructorOptions } from 'electron'
import type { QuickCommand } from '../shared/bridge'

/** The window is as tall as what it shows (the page says, through quick:resize), up to this. */
const WIDTH = 680
const MAX_HEIGHT = 560

let window: BrowserWindow | null = null
let mode: 'type' | 'voice' = 'type'
/** Whether ⌥X is held right now. The key can be released while macOS asks for the microphone. */
let holding = false

export function createQuickWindow(options: BrowserWindowConstructorOptions, load: (w: BrowserWindow) => void) {
  window = new BrowserWindow({
    width: WIDTH,
    height: 132,
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
  // Placed when it opens, a third of the way down the screen the pointer is on, like Spotlight.
  // As it grows with an answer, its top stays put.
  if (window.isVisible()) return
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  window.setPosition(Math.round(workArea.x + (workArea.width - WIDTH) / 2), Math.round(workArea.y + workArea.height * 0.22))
}

/** The page's height changed. */
export function resizeQuick(height: number) {
  if (!window) return
  const [, y] = window.getPosition()
  window.setBounds({ width: WIDTH, height: Math.min(MAX_HEIGHT, Math.max(60, height)), y })
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
