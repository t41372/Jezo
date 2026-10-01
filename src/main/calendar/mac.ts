// The Mac's own calendars, through native/eventkit: a small Swift program the
// main process runs and reads JSON from. It sees every account added to the
// Mac (iCloud, Google, Exchange), so those need no connection of Jezo's own.

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type MacAccess = 'full' | 'notDetermined' | 'denied' | 'restricted' | 'writeOnly' | 'unavailable'

export interface MacCalendar {
  id: string
  title: string
  color?: string
  writable: boolean
  account: { id: string; title: string; kind: string }
}

export interface MacEvent {
  id: string
  calendar: string
  title: string
  start: string
  end: string
  allDay: boolean
  repeats: boolean
  /** The event's zone; none when it floats. */
  zone?: string
  location?: string
  notes?: string
  url?: string
  cancelled?: boolean
}

/** Built by scripts/native.ts into native/eventkit/build in development, and shipped in Resources/bin. */
const helper = () =>
  app.isPackaged ? join(process.resourcesPath, 'bin', 'jezo-eventkit') : join(import.meta.dirname, '../../native/eventkit/build/jezo-eventkit')

export const macAvailable = () => process.platform === 'darwin' && existsSync(helper())

function run<T>(args: string[]): Promise<T> {
  return new Promise((resolve, reject) => {
    execFile(helper(), args, { maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message))
      else resolve(JSON.parse(stdout) as T)
    })
  })
}

export async function macAccess(): Promise<MacAccess> {
  if (!macAvailable()) return 'unavailable'
  return (await run<{ access: MacAccess }>(['status'])).access
}

/** Shows macOS's own question the first time; afterwards it only reports the answer. */
export async function requestMacAccess(): Promise<MacAccess> {
  if (!macAvailable()) return 'unavailable'
  return (await run<{ access: MacAccess }>(['request'])).access
}

export const macCalendars = () => run<MacCalendar[]>(['calendars'])

/** Events between two moments, `to` exclusive, with repeats expanded. */
export const macEvents = (from: Temporal.Instant, to: Temporal.Instant, calendars: string[]) =>
  calendars.length ? run<MacEvent[]>(['events', from.toString(), to.toString(), ...calendars]) : Promise.resolve([])

/** Calls back whenever anything on the Mac's calendars changes, until stopped. */
export function watchMac(changed: () => void): () => void {
  let child: ChildProcess | null = spawn(helper(), ['watch'], { stdio: ['pipe', 'pipe', 'ignore'] })
  child.stdout?.on('data', () => changed())
  child.on('exit', () => (child = null))
  return () => {
    // Closing its stdin is how the helper knows to quit.
    child?.stdin?.end()
    child = null
  }
}
