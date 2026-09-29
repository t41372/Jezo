// A global hotkey that reports both press ("down") and release ("up"), which
// Electron's globalShortcut can't do. See docs/design/frontend.md.

const addon = require('./build/Release/hotkey.node')

/** "Alt+X" → { key: "X", modifiers: { alt: true, ... } } */
function parse(accelerator) {
  const parts = accelerator.split('+').map((p) => p.trim())
  const key = parts.pop()
  const has = (...names) => parts.some((p) => names.includes(p.toLowerCase()))
  return {
    key: key.length === 1 ? key.toUpperCase() : key,
    modifiers: {
      alt: has('alt', 'option'),
      cmd: has('cmd', 'command', 'super', 'meta'),
      ctrl: has('ctrl', 'control'),
      shift: has('shift'),
    },
  }
}

/**
 * Registers the hotkey, replacing any registered before. Throws with the reason
 * when the OS refuses it.
 */
function register(accelerator, listener) {
  const { key, modifiers } = parse(accelerator)
  const error = addon.register(key, modifiers, listener)
  if (error) throw new Error(`Couldn't register ${accelerator}: ${error}`)
}

module.exports = { register, unregister: addon.unregister }
