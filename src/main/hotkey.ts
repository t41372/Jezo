// The ⌥X key: a short press opens the typing window, holding it records voice
// until release. Electron's globalShortcut only reports presses, so the hold
// needs the native module (native/hotkey). Where it can't load or register, a
// press still opens the typing window.

import { createRequire } from 'node:module'
import { globalShortcut } from 'electron'

// The addon is a CommonJS .node module.
const require = createRequire(import.meta.url)

/** Held longer than this, it's a hold instead of a press. */
const HOLD_MS = 250

export interface QuickKeyHandlers {
  press(): void
  holdStart(): void
  holdEnd(): void
}

type NativeHotkey = typeof import('@jezo/hotkey')
let native: NativeHotkey | null = null

/** Returns whether holding the key works on this machine. */
export function registerQuickKey(accelerator: string, handlers: QuickKeyHandlers): boolean {
  try {
    native = require('@jezo/hotkey') as NativeHotkey
    let timer: NodeJS.Timeout | null = null
    let holding = false
    native.register(accelerator, (state) => {
      if (state === 'down') {
        if (timer || holding) return
        timer = setTimeout(() => {
          timer = null
          holding = true
          handlers.holdStart()
        }, HOLD_MS)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
        handlers.press()
      } else if (holding) {
        holding = false
        handlers.holdEnd()
      }
    })
    return true
  } catch (error) {
    native = null
    console.warn(`Holding ${accelerator} won't work, only pressing it:`, error)
  }
  if (!globalShortcut.register(accelerator, handlers.press)) console.warn(`Couldn't register ${accelerator}`)
  return false
}

export function unregisterQuickKey() {
  native?.unregister()
  globalShortcut.unregisterAll()
}
