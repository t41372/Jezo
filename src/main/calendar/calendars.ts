// All of the user's calendars in one place (docs/design/calendar.md): the Mac's
// own, through EventKit, and ICS subscriptions. Events aren't copied into the
// workspace. The calendar they come from owns them, and Jezo keeps only a cache
// in its data directory, so it still shows them offline.
//
// Where things live:
// - Subscriptions are the user's, in the workspace: calendar/subscriptions.yaml.
//   Each address is in the keychain, since a private calendar's address is
//   all it takes to read it.
// - The Mac's calendars belong to this machine: on or off, and which are
//   hidden, are in config.json.

import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { CalendarEvent, CalendarInfo, CalendarSource, CalendarStatus } from '../../shared/calendar'
import { getConfig, setConfig } from '../config'
import { getSecret, storeSecret } from '../secrets'
import type { Workspace } from '../workspace/workspace'
import { readIcs } from './ics'
import { macAccess, macAvailable, macCalendars, macEvents, requestMacAccess, watchMac, type MacAccess } from './mac'

const SUBSCRIPTIONS = 'calendar/subscriptions.yaml'
/** How often subscriptions are read again while Jezo is open. Feeds are usually regenerated hourly at most. */
const REFRESH_MINUTES = 30

interface Subscription {
  id: string
  name: string
  color?: string
  hidden?: boolean
}

/** What's cached about a subscription's last fetch, next to the feed itself. */
interface Fetched {
  syncedAt?: string
  etag?: string
  lastModified?: string
  error?: string
}

const secretName = (id: string) => `calendar:${id}`
/** webcal:// is https:// that calendar apps know to open. */
const httpUrl = (url: string) => url.trim().replace(/^webcals?:\/\//i, 'https://')

export class Calendars {
  private listeners = new Set<() => void>()
  private fetching = new Map<string, Promise<void>>()
  private timer: NodeJS.Timeout | null = null
  private stopWatching: (() => void) | null = null
  private access: MacAccess = 'unavailable'
  private refreshedAt = 0

  constructor(private workspace: Workspace) {}

  private cacheDir = () => join(app.getPath('userData'), 'calendar')

  async open() {
    await mkdir(this.cacheDir(), { recursive: true })
    this.access = await macAccess().catch(() => 'unavailable' as const)
    if (getConfig().calendar.mac && this.access === 'full') this.watch()
    this.timer = setInterval(() => void this.refresh(), REFRESH_MINUTES * 60_000)
    void this.refresh()
  }

  close() {
    if (this.timer) clearInterval(this.timer)
    this.stopWatching?.()
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }

  private watch() {
    this.stopWatching?.()
    this.stopWatching = watchMac(() => this.changed())
  }

  // ─── Subscriptions ───

  private async subscriptions(): Promise<Subscription[]> {
    try {
      const text = await readFile(join(this.workspace.root, SUBSCRIPTIONS), 'utf8')
      const list = (parseYaml(text) as { subscriptions?: Subscription[] } | null)?.subscriptions
      return Array.isArray(list) ? list.filter((s) => s && typeof s.id === 'string') : []
    } catch {
      return []
    }
  }

  private async saveSubscriptions(list: Subscription[]) {
    const header = [
      '# Calendars Jezo subscribes to, added in 連接. Each address is in the system',
      "# keychain, not here: a private calendar's address is all it takes to read it.",
      '',
    ].join('\n')
    await this.workspace.writeFile(SUBSCRIPTIONS, header + stringifyYaml({ subscriptions: list }), { by: 'user' })
  }

  private async fetched(id: string): Promise<Fetched> {
    try {
      return JSON.parse(await readFile(join(this.cacheDir(), `${id}.json`), 'utf8'))
    } catch {
      return {}
    }
  }

  private async feed(id: string): Promise<string | null> {
    try {
      return await readFile(join(this.cacheDir(), `${id}.ics`), 'utf8')
    } catch {
      return null
    }
  }

  /**
   * Checks the address works and reads the calendar's name from it before
   * saving anything, so a wrong address fails here, with the reason, rather
   * than as an empty calendar later.
   */
  async subscribe(url: string, name?: string): Promise<CalendarSource> {
    const address = httpUrl(url)
    const response = await fetch(address, { signal: AbortSignal.timeout(20_000), headers: { accept: 'text/calendar, */*' } })
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
    const text = await response.text()
    const today = new Date().toISOString().slice(0, 10)
    const { name: feedName } = readIcs(text, today, today)
    const id = `s-${randomBytes(4).toString('hex')}`
    await storeSecret(secretName(id), address)
    await writeFile(join(this.cacheDir(), `${id}.ics`), text)
    const meta: Fetched = { syncedAt: new Date().toISOString(), etag: response.headers.get('etag') ?? undefined, lastModified: response.headers.get('last-modified') ?? undefined }
    await writeFile(join(this.cacheDir(), `${id}.json`), JSON.stringify(meta))
    const subscription = { id, name: name?.trim() || feedName || new URL(address).hostname }
    await this.saveSubscriptions([...(await this.subscriptions()), subscription])
    this.changed()
    return { id, kind: 'ics', name: subscription.name, state: 'ok', syncedAt: meta.syncedAt }
  }

  async unsubscribe(id: string) {
    await this.saveSubscriptions((await this.subscriptions()).filter((s) => s.id !== id))
    await storeSecret(secretName(id), null)
    await rm(join(this.cacheDir(), `${id}.ics`), { force: true })
    await rm(join(this.cacheDir(), `${id}.json`), { force: true })
    this.changed()
  }

  /** Reads subscriptions again: one, or all of them. A failure keeps the last copy and records why. */
  async refresh(id?: string) {
    if (!id) this.refreshedAt = Date.now()
    const list = (await this.subscriptions()).filter((s) => !id || s.id === id)
    await Promise.all(list.map((s) => this.fetch(s.id)))
  }

  /** For coming back to the app: reads subscriptions again unless that happened in the last few minutes. */
  refreshIfStale(minutes = 5) {
    if (Date.now() - this.refreshedAt > minutes * 60_000) void this.refresh()
  }

  private fetch(id: string): Promise<void> {
    const running = this.fetching.get(id)
    if (running) return running
    const work = (async () => {
      const address = getSecret(secretName(id))
      const before = await this.fetched(id)
      const meta: Fetched = { ...before }
      if (!address) {
        meta.error = 'The address is missing from this Mac’s keychain. Remove this calendar and add it again.'
      } else {
        try {
          const headers: Record<string, string> = { accept: 'text/calendar, */*' }
          if (before.etag) headers['if-none-match'] = before.etag
          if (before.lastModified) headers['if-modified-since'] = before.lastModified
          const response = await fetch(address, { signal: AbortSignal.timeout(20_000), headers })
          if (response.status !== 304) {
            if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim())
            const text = await response.text()
            readIcs(text, '2000-01-01', '2000-01-02')
            // Removed while this was on its way: don't leave a copy behind.
            if (!(await this.subscriptions()).some((s) => s.id === id)) return
            await writeFile(join(this.cacheDir(), `${id}.ics`), text)
            meta.etag = response.headers.get('etag') ?? undefined
            meta.lastModified = response.headers.get('last-modified') ?? undefined
          }
          meta.syncedAt = new Date().toISOString()
          delete meta.error
        } catch (error) {
          meta.error = (error as Error).message
        }
      }
      if (!(await this.subscriptions()).some((s) => s.id === id)) return
      await writeFile(join(this.cacheDir(), `${id}.json`), JSON.stringify(meta))
      this.changed()
    })().finally(() => this.fetching.delete(id))
    this.fetching.set(id, work)
    return work
  }

  // ─── The Mac's calendars ───

  /** Turns the Mac's calendars on, asking macOS for access if it hasn't been asked. */
  async connectMac(): Promise<MacAccess> {
    this.access = await requestMacAccess()
    if (this.access === 'full') {
      await setConfig({ calendar: { ...getConfig().calendar, mac: true } })
      this.watch()
    }
    this.changed()
    return this.access
  }

  async disconnectMac() {
    await setConfig({ calendar: { ...getConfig().calendar, mac: false } })
    this.stopWatching?.()
    this.stopWatching = null
    this.changed()
  }

  // ─── What the windows and the agent see ───

  async setHidden(calendar: string, hidden: boolean) {
    const subscriptions = await this.subscriptions()
    if (subscriptions.some((s) => s.id === calendar)) {
      await this.saveSubscriptions(subscriptions.map((s) => (s.id === calendar ? { ...s, hidden: hidden || undefined } : s)))
    } else {
      const rest = getConfig().calendar.hidden.filter((id) => id !== calendar)
      await setConfig({ calendar: { ...getConfig().calendar, hidden: hidden ? [...rest, calendar] : rest } })
    }
    this.changed()
  }

  async status(): Promise<CalendarStatus> {
    const sources: CalendarSource[] = []
    const calendars: CalendarInfo[] = []
    const config = getConfig().calendar

    if (macAvailable()) {
      if (config.mac) this.access = await macAccess().catch(() => this.access)
      const state = !config.mac ? 'off' : this.access === 'full' ? 'ok' : this.access === 'notDetermined' ? 'needs-access' : 'denied'
      const mac: CalendarSource = { id: 'mac', kind: 'mac', name: 'Mac', state }
      if (state === 'ok') {
        try {
          for (const c of await macCalendars()) {
            calendars.push({ id: c.id, name: c.title, color: c.color, account: c.account.title, source: 'mac', hidden: config.hidden.includes(c.id) })
          }
          mac.syncedAt = new Date().toISOString()
        } catch (error) {
          Object.assign(mac, { state: 'error', error: (error as Error).message })
        }
      }
      sources.push(mac)
    }

    for (const s of await this.subscriptions()) {
      const meta = await this.fetched(s.id)
      const state = this.fetching.has(s.id) ? 'syncing' : meta.error ? 'error' : 'ok'
      sources.push({ id: s.id, kind: 'ics', name: s.name, state, syncedAt: meta.syncedAt, ...(meta.error && { error: meta.error }) })
      calendars.push({ id: s.id, name: s.name, color: s.color, account: s.name, source: s.id, hidden: !!s.hidden })
    }
    return { sources, calendars }
  }

  /** Timed events that overlap a stretch of time, like a todo's slot. All-day events don't block a time. */
  async overlapping(start: string, minutes: number): Promise<CalendarEvent[]> {
    const date = start.slice(0, 10)
    const next = new Date(`${date}T00:00`)
    next.setDate(next.getDate() + 1)
    const to = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`
    const from = new Date(`${start}`).getTime()
    const until = from + minutes * 60_000
    return (await this.events(date, to)).filter((e) => !e.allDay && new Date(e.start).getTime() < until && new Date(e.end).getTime() > from)
  }

  /** Events from every calendar that isn't hidden, between two local dates (`to` exclusive). */
  async events(from: string, to: string): Promise<CalendarEvent[]> {
    const { calendars } = await this.status()
    const shown = calendars.filter((c) => !c.hidden)
    const events: CalendarEvent[] = []

    const mac = shown.filter((c) => c.source === 'mac').map((c) => c.id)
    if (mac.length) {
      try {
        for (const e of await macEvents(from, to, mac)) {
          if (e.cancelled) continue
          const { cancelled: _c, allDay, repeats, ...rest } = e
          events.push({ ...rest, ...(allDay && { allDay }), ...(repeats && { repeats }) })
        }
      } catch (error) {
        console.error("Can't read the Mac's calendars:", error)
      }
    }

    for (const c of shown.filter((c) => c.source !== 'mac')) {
      const text = await this.feed(c.id)
      if (!text) continue
      try {
        for (const e of readIcs(text, from, to).events) events.push({ ...e, id: `${c.id}:${e.id}`, calendar: c.id })
      } catch (error) {
        console.error(`Can't read the calendar ${c.name}:`, error)
      }
    }
    return events.sort((a, b) => a.start.localeCompare(b.start))
  }
}
