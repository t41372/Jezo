// Which zone the device is in (docs/design/time.md, "Where the user is").
//
// The device's zone is the truth about where the user is. Node in the main
// process keeps the zone it started with even after the OS changes it, so the
// zone is read from the OS itself, and looked at again on launch, resume,
// unlock, window focus and each tick.

import { readlinkSync } from 'node:fs'
import { BrowserWindow, powerMonitor } from 'electron'
import type { Zone } from '../shared/time'

/** macOS keeps the zone as a link into the zoneinfo database. Tests point this at a link of their own. */
const LOCALTIME = process.env.JEZO_LOCALTIME ?? '/etc/localtime'

/** The OS's zone, read fresh. */
function readZone(): Zone {
  if (process.platform !== 'win32') {
    try {
      const target = readlinkSync(LOCALTIME)
      const at = target.indexOf('zoneinfo/')
      if (at >= 0) return target.slice(at + 'zoneinfo/'.length)
    } catch {
      // Not a link (some Linux systems copy the file): fall back to what the runtime says.
    }
  }
  // The runtime answers with TZ once it's set, and Jezo sets it below. Unset, Node asks the OS
  // again; it's put back right after, so code on the default zone never sees the gap.
  const bridge = process.env.TZ
  delete process.env.TZ
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } finally {
    if (bridge !== undefined) process.env.TZ = bridge
  }
}

let current: Zone = readZone()
const listeners = new Set<(zone: Zone, previous: Zone) => void>()
// Code that still reads the process's default zone (Date, libraries) follows along.
process.env.TZ = current

/** The device's zone, as of the last look. */
export const deviceZone = () => current

export function onZoneChange(listener: (zone: Zone, previous: Zone) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Looks at the OS's zone again. Returns true when it changed. */
export function checkZone() {
  const zone = readZone()
  if (zone === current) return false
  const previous = current
  current = zone
  process.env.TZ = zone
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('time:zone', zone)
  for (const listener of listeners) listener(zone, previous)
  return true
}

/** Starts looking whenever the device may have moved: waking, unlocking, coming back to the app, and every 30 seconds. */
export function watchZone() {
  powerMonitor.on('resume', checkZone)
  powerMonitor.on('unlock-screen', checkZone)
  setInterval(checkZone, 30_000)
}
