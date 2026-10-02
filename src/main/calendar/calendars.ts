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
import { dateOf, epochOf, now, readTime, todayIn, type Zone } from '../../shared/time'
import { deviceZone } from '../clock'
import { googleCalendars, googleClient, googleEvents, GoogleSignedOut, setGoogleClient, signIn, signOut, type GoogleCalendar, type SignInPage } from './google'
import { unknownZonesIn } from './ics'
import { readFeed } from './ics-reader'
import { macAccess, macAvailable, macCalendars, macEvents, requestMacAccess, watchMac, type MacAccess } from './mac'

const SUBSCRIPTIONS = 'calendar/subscriptions.yaml'
const GOOGLE = 'calendar/google.yaml'
/** How much of a Google calendar is kept: three months back, a year ahead. */
const GOOGLE_BACK = 90
const GOOGLE_AHEAD = 365
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
  /** Zones the feed names that nothing defines, found when it was fetched. */
  unknownZones?: string[]
}

interface GoogleAccount {
  /** The account's email. */
  id: string
  /** Calendars in it the user hid. */
  hidden?: string[]
}

/** The last read of one Google account, kept so it shows offline. Each event keeps its own zone. */
interface GoogleCopy {
  syncedAt?: string
  error?: string
  signedOut?: boolean
  from?: string
  to?: string
  calendars: GoogleCalendar[]
  events: Record<string, Omit<CalendarEvent, 'calendar'>[]>
}

const googleSource = (account: string) => `google:${account}`
/** A Google calendar's id in Jezo: calendar ids repeat across accounts (a shared calendar is in both). */
const googleCalendarId = (account: string, calendar: string) => `google:${account}/${calendar}`

/** The start of a day in a zone. */
const dayStart = (date: string, zone: Zone) => Temporal.PlainDate.from(date).toZonedDateTime(zone)

/** When an event starts and ends, from `zone`, in milliseconds. A day runs from midnight there. */
export function span(e: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>, zone: Zone) {
  if (e.allDay) return { start: dayStart(e.start, zone).epochMilliseconds, end: dayStart(e.end, zone).epochMilliseconds }
  const at = (text: string) => epochOf(readTime(text, 'event'), zone) ?? 0
  return { start: at(e.start), end: at(e.end) }
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
    // The subscriptions are a workspace file the agent, an undo or the user's editor can change too.
    this.workspace.onFileChange((path) => {
      if (path !== SUBSCRIPTIONS) return
      this.changed()
      void this.refresh()
    })
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
    const today = todayIn(deviceZone()).toString()
    const { name: feedName } = await readFeed(text, today, today, deviceZone())
    const id = `s-${randomBytes(4).toString('hex')}`
    await storeSecret(secretName(id), address)
    await writeFile(join(this.cacheDir(), `${id}.ics`), text)
    const meta: Fetched = { syncedAt: new Date().toISOString(), etag: response.headers.get('etag') ?? undefined, lastModified: response.headers.get('last-modified') ?? undefined, unknownZones: unknownZonesIn(text) }
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
    const google = (await this.googleAccounts()).filter((a) => !id || googleSource(a.id) === id)
    await Promise.all([...list.map((s) => this.fetch(s.id)), ...google.map((a) => this.fetchGoogle(a.id))])
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
            await readFeed(text, '2000-01-01', '2000-01-02', 'UTC')
            // Removed while this was on its way: don't leave a copy behind.
            if (!(await this.subscriptions()).some((s) => s.id === id)) return
            await writeFile(join(this.cacheDir(), `${id}.ics`), text)
            meta.unknownZones = unknownZonesIn(text)
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
    // Turned on even when access was refused, so 連接 shows why and where to allow it rather than offering to connect again.
    if (this.access !== 'unavailable') await setConfig({ calendar: { ...getConfig().calendar, mac: true } })
    if (this.access === 'full') this.watch()
    this.changed()
    return this.access
  }

  async disconnectMac() {
    await setConfig({ calendar: { ...getConfig().calendar, mac: false } })
    this.stopWatching?.()
    this.stopWatching = null
    this.changed()
  }

  // ─── Google, with the user's own client ───

  private async googleAccounts(): Promise<GoogleAccount[]> {
    try {
      const text = await readFile(join(this.workspace.root, GOOGLE), 'utf8')
      const list = (parseYaml(text) as { accounts?: GoogleAccount[] } | null)?.accounts
      return Array.isArray(list) ? list.filter((a) => a && typeof a.id === 'string') : []
    } catch {
      return []
    }
  }

  private async saveGoogleAccounts(list: GoogleAccount[]) {
    const header = [
      '# Google accounts whose calendars Jezo shows, added in 連接. The sign-in for',
      "# each is in this Mac's keychain, with the Google client the user made.",
      '',
    ].join('\n')
    await this.workspace.writeFile(GOOGLE, header + stringifyYaml({ accounts: list }), { by: 'user' })
  }

  private googleFile = (account: string) => join(this.cacheDir(), `google-${Buffer.from(account).toString('base64url')}.json`)

  private async googleCopy(account: string): Promise<GoogleCopy> {
    try {
      return JSON.parse(await readFile(this.googleFile(account), 'utf8'))
    } catch {
      return { calendars: [], events: {} }
    }
  }

  async setGoogleClient(id: string, secret: string) {
    if (!id.trim() || !secret.trim()) throw new Error('Both the client ID and the client secret are needed.')
    await setGoogleClient({ id, secret })
    this.changed()
  }

  /** Signs in to one more Google account in the browser, then reads its calendars. */
  async connectGoogle(page: SignInPage) {
    const client = googleClient()
    if (!client) throw new Error('Set up the Google client first.')
    const account = await signIn(client, page)
    const accounts = await this.googleAccounts()
    if (!accounts.some((a) => a.id === account)) await this.saveGoogleAccounts([...accounts, { id: account }])
    await this.fetchGoogle(account)
    return account
  }

  async disconnectGoogle(account: string) {
    await this.saveGoogleAccounts((await this.googleAccounts()).filter((a) => a.id !== account))
    await signOut(account)
    await rm(this.googleFile(account), { force: true })
    this.changed()
  }

  private fetchGoogle(account: string): Promise<void> {
    const key = googleSource(account)
    const running = this.fetching.get(key)
    if (running) return running
    const work = (async () => {
      const copy = await this.googleCopy(account)
      try {
        const today = now().toZonedDateTimeISO(deviceZone()).startOfDay()
        const from = today.subtract({ days: GOOGLE_BACK }).toInstant()
        const to = today.add({ days: GOOGLE_AHEAD }).toInstant()
        const calendars = await googleCalendars(account)
        const events: GoogleCopy['events'] = {}
        for (const c of calendars) events[c.id] = await googleEvents(account, c.id, from, to)
        Object.assign(copy, { calendars, events, from: from.toString(), to: to.toString(), syncedAt: new Date().toISOString(), error: undefined, signedOut: undefined })
      } catch (error) {
        copy.error = (error as Error).message
        copy.signedOut = error instanceof GoogleSignedOut || undefined
      }
      // Removed while this was on its way: don't leave a copy behind.
      if (!(await this.googleAccounts()).some((a) => a.id === account)) return
      await writeFile(this.googleFile(account), JSON.stringify(copy))
      this.changed()
    })().finally(() => this.fetching.delete(key))
    this.fetching.set(key, work)
    return work
  }

  // ─── What the windows and the agent see ───

  async setHidden(calendar: string, hidden: boolean) {
    const google = /^google:([^/]+)\/(.+)$/.exec(calendar)
    if (google) {
      const [, account, id] = google
      const accounts = await this.googleAccounts()
      await this.saveGoogleAccounts(
        accounts.map((a) => {
          if (a.id !== account) return a
          const rest = (a.hidden ?? []).filter((h) => h !== id)
          return { ...a, hidden: hidden ? [...rest, id] : rest.length ? rest : undefined }
        }),
      )
      this.changed()
      return
    }
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
      // Allowed in System Settings after it was refused: from now on, changes there show here.
      if (config.mac && this.access === 'full' && !this.stopWatching) this.watch()
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
      const problems = meta.unknownZones?.map((zone) => ({ kind: 'unknown-zone' as const, zone }))
      sources.push({ id: s.id, kind: 'ics', name: s.name, state, syncedAt: meta.syncedAt, ...(meta.error && { error: meta.error }), ...(problems?.length && { problems }) })
      calendars.push({ id: s.id, name: s.name, color: s.color, account: s.name, source: s.id, hidden: !!s.hidden })
    }
    for (const account of await this.googleAccounts()) {
      const copy = await this.googleCopy(account.id)
      const key = googleSource(account.id)
      const state = this.fetching.has(key) ? 'syncing' : copy.signedOut ? 'needs-access' : copy.error ? 'error' : 'ok'
      sources.push({ id: key, kind: 'google', name: account.id, state, syncedAt: copy.syncedAt, ...(copy.error && { error: copy.error }) })
      for (const c of copy.calendars) {
        calendars.push({ id: googleCalendarId(account.id, c.id), name: c.name, color: c.color, account: account.id, source: key, hidden: !!account.hidden?.includes(c.id) })
      }
    }
    return { sources, calendars, googleClient: !!googleClient() }
  }

  /**
   * Timed events that overlap a todo's slot, read from where the device is. All-day
   * events don't block a time. Calendars that couldn't be read are named, so a
   * clash check never says "nothing there" about a calendar it couldn't see.
   */
  async overlapping(scheduled: string, minutes: number): Promise<{ events: CalendarEvent[]; unchecked: string[] }> {
    const zone = deviceZone()
    const value = readTime(scheduled)
    const from = epochOf(value, zone)
    if (from === undefined || !value) return { events: [], unchecked: [] }
    const until = from + minutes * 60_000
    // From the day before (an event that started earlier) to the day after the slot ends, however long it is.
    const first = dateOf(value, zone).subtract({ days: 1 })
    const last = Temporal.Instant.fromEpochMilliseconds(until).toZonedDateTimeISO(zone).toPlainDate().add({ days: 2 })
    const { events, unchecked } = await this.read(first.toString(), last.toString(), zone)
    return {
      events: events.filter((e) => {
        if (e.allDay) return false
        const { start, end } = span(e, zone)
        return start < until && end > from
      }),
      unchecked,
    }
  }

  /** Events from every calendar that isn't hidden, between two days in `zone` (`to` exclusive). */
  async events(from: string, to: string, zone: Zone = deviceZone()): Promise<CalendarEvent[]> {
    return (await this.read(from, to, zone)).events
  }

  /**
   * The events, and the calendars that couldn't be read for this range: not
   * connected, access taken away, a read that failed, no saved copy, or a range
   * past what's kept of Google. An empty answer then never means "nothing there".
   */
  async read(from: string, to: string, zone: Zone = deviceZone()): Promise<{ events: CalendarEvent[]; unchecked: string[] }> {
    const { sources, calendars } = await this.status()
    const unchecked = new Set(sources.filter((s) => s.state === 'error' || s.state === 'needs-access' || s.state === 'denied').map((s) => s.name))
    const shown = calendars.filter((c) => !c.hidden)
    const events: CalendarEvent[] = []
    const rangeStart = dayStart(from, zone).epochMilliseconds
    const rangeEnd = dayStart(to, zone).epochMilliseconds
    const inRange = (e: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>) => {
      const { start, end } = span(e, zone)
      return start < rangeEnd && (end > rangeStart || start >= rangeStart)
    }

    const mac = shown.filter((c) => c.source === 'mac').map((c) => c.id)
    if (mac.length) {
      try {
        // EventKit places an event with no zone (all-day, or a floating time) by the Mac's own zone; asked a day
        // either side, then kept by where it falls in `zone`, it's found when the run plans somewhere else.
        for (const e of await macEvents(dayStart(from, zone).subtract({ days: 1 }).toInstant(), dayStart(to, zone).add({ days: 1 }).toInstant(), mac)) {
          const { cancelled, allDay, repeats, ...rest } = e
          const event = { ...rest, ...(allDay && { allDay }), ...(repeats && { repeats }) }
          if (!cancelled && inRange(event)) events.push(event)
        }
      } catch (error) {
        console.error("Can't read the Mac's calendars:", error)
        unchecked.add('Mac')
      }
    }

    for (const c of shown.filter((c) => c.source !== 'mac' && !c.source.startsWith('google:'))) {
      const text = await this.feed(c.id)
      if (!text) {
        unchecked.add(c.name)
        continue
      }
      try {
        const feed = await readFeed(text, from, to, zone)
        for (const e of feed.events) events.push({ ...e, id: `${c.id}:${e.id}`, calendar: c.id })
      } catch (error) {
        console.error(`Can't read the calendar ${c.name}:`, error)
        unchecked.add(c.name)
      }
    }
    const copies = new Map<string, GoogleCopy>()
    for (const c of shown.filter((c) => c.source.startsWith('google:'))) {
      const account = c.source.slice('google:'.length)
      if (!copies.has(account)) copies.set(account, await this.googleCopy(account))
      const copy = copies.get(account)!
      // Kept for a fixed stretch around today; past it, Jezo doesn't know.
      if (!copy.from || !copy.to || rangeStart < Temporal.Instant.from(copy.from).epochMilliseconds || rangeEnd > Temporal.Instant.from(copy.to).epochMilliseconds) unchecked.add(account)
      const calendar = c.id.slice(c.source.length + 1)
      // Kept for a fixed stretch around today; overlapping the asked range is what counts.
      for (const e of copies.get(account)!.events[calendar] ?? []) if (inRange(e)) events.push({ ...e, id: `${c.id}:${e.id}`, calendar: c.id })
    }
    return { events: events.sort((a, b) => span(a, zone).start - span(b, zone).start), unchecked: [...unchecked] }
  }
}
