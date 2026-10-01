// Reads an iCalendar feed (RFC 5545) into the events that fall in a range,
// with repeating events expanded. ical.js does the parsing and the repeat
// rules; this file keeps what each time meant (docs/design/calendar.md, "Times
// from each source"). Feeds get time zones wrong in several ways (see
// ics.test.ts), so each is handled here: zones described in the feed itself
// (Outlook's Windows names), IANA names with no description, UTC, and
// floating times.

import ICAL from 'ical.js'
import type { CalendarEvent } from '../../shared/calendar'
import { stamp, type Zone } from '../../shared/time'

export interface IcsEvent extends Omit<CalendarEvent, 'calendar'> {}

export interface IcsCalendar {
  /** X-WR-CALNAME, which most feeds send. */
  name?: string
  events: IcsEvent[]
  /** Time zones events name that the feed doesn't define; their times are shown as written. */
  unknownZones: string[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const dateOf = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`
const wallOf = (t: ICAL.Time) => `${dateOf(t)}T${pad(t.hour)}:${pad(t.minute)}${t.second ? `:${pad(t.second)}` : ''}`

const knownZone = (name: string) => {
  try {
    Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(name)
    return true
  } catch {
    return false
  }
}

/** A UTC offset in seconds as "-05:00". */
const offsetName = (seconds: number) => `${seconds < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(seconds) / 3600))}:${pad(Math.floor((Math.abs(seconds) % 3600) / 60))}`

function parse(text: string) {
  let root: ICAL.Component
  try {
    root = new ICAL.Component(ICAL.parse(text) as unknown[])
  } catch (error) {
    throw new Error(`This isn't a calendar feed: ${(error as Error).message}`)
  }
  if (root.name !== 'vcalendar') throw new Error("This isn't a calendar feed.")
  // Zones the feed describes itself are the only way to read names like "Pacific Standard Time".
  const zones = new Map<string, ICAL.Timezone>()
  for (const vtz of root.getAllSubcomponents('vtimezone')) {
    const zone = new ICAL.Timezone(vtz)
    zones.set(zone.tzid, zone)
  }
  const defaultZone = String(root.getFirstPropertyValue('x-wr-timezone') ?? '') || undefined
  return { root, zones, defaultZone }
}

/**
 * Zones the feed names that neither it nor Temporal defines, in any of its
 * events, whatever dates are asked about: the warning belongs to the feed.
 */
export function unknownZonesIn(text: string): string[] {
  const { root, zones, defaultZone } = parse(text)
  const names = new Set<string>(defaultZone ? [defaultZone] : [])
  for (const vevent of root.getAllSubcomponents('vevent')) {
    for (const property of vevent.getAllProperties()) {
      const tzid = property.getParameter('tzid')
      if (typeof tzid === 'string') names.add(tzid)
    }
  }
  return [...names].filter((name) => !zones.has(name) && !knownZone(name))
}

/** A time as Jezo keeps it, with when it happens from where the user is, for the range and the order. */
interface Point {
  value: string
  at: number
  zone?: string
}

/** The events between two days (`to` exclusive), as days in `zone`, the device's. */
export function readIcs(text: string, from: string, to: string, zone: Zone): IcsCalendar {
  const { root, zones, defaultZone } = parse(text)
  const unknownZones = new Set<string>()

  /**
   * A time from the feed, keeping its meaning: a moment in the zone it was given
   * in, or a local time when it floats. Around a daylight-saving change, RFC 5545
   * and Temporal agree: a time that happens twice is the first, and one in the
   * skipped hour is moved by the gap.
   */
  const point = (t: ICAL.Time, tzid: string | undefined): Point => {
    if (t.zone === ICAL.Timezone.utcTimezone) {
      const at = t.toJSDate().getTime()
      return { value: stamp('UTC', at), at }
    }
    const name = tzid ?? defaultZone
    if (name && zones.has(name)) {
      // The feed defines this zone, so the moment and its offset are the feed's, even when Temporal knows
      // the name: the feed's rules are what its author meant. A floating time takes X-WR-TIMEZONE's.
      const local = tzid ? t : Object.assign(t.clone(), { zone: zones.get(name)! })
      const at = local.toUnixTime() * 1000
      return { value: stamp(offsetName(local.utcOffset()), at), at, zone: name }
    }
    if (name && knownZone(name)) {
      const at = Temporal.PlainDateTime.from(wallOf(t)).toZonedDateTime(name, { disambiguation: 'compatible' }).epochMilliseconds
      return { value: stamp(name, at), at, zone: name }
    }
    if (name) unknownZones.add(name)
    // Floating: the clock as written, wherever the user is.
    const value = wallOf(t)
    return { value, at: Temporal.PlainDateTime.from(value).toZonedDateTime(zone, { disambiguation: 'compatible' }).epochMilliseconds }
  }

  const rangeStart = Temporal.PlainDate.from(from).toZonedDateTime(zone).epochMilliseconds
  const rangeEnd = Temporal.PlainDate.from(to).toZonedDateTime(zone).epochMilliseconds
  const start = ICAL.Time.fromDateString(from)
  const end = ICAL.Time.fromDateString(to)

  /** A UID for events that have none, from what they say: the same on every read. */
  const uidOf = (e: ICAL.Event) => e.uid || `no-uid:${e.summary ?? ''}:${e.startDate?.toString() ?? ''}`

  // Moved or cancelled occurrences arrive as separate VEVENTs with the series' UID and a RECURRENCE-ID.
  const series = new Map<string, ICAL.Event>()
  const exceptions: ICAL.Component[] = []
  const singles: ICAL.Event[] = []
  for (const vevent of root.getAllSubcomponents('vevent')) {
    try {
      if (vevent.hasProperty('recurrence-id')) exceptions.push(vevent)
      else {
        const e = new ICAL.Event(vevent)
        if (!e.startDate) continue
        if (e.isRecurring()) series.set(uidOf(e), e)
        else singles.push(e)
      }
    } catch {
      // One event the parser can't read shouldn't hide the rest.
    }
  }
  for (const vevent of exceptions) {
    const parent = series.get(String(vevent.getFirstPropertyValue('uid')))
    try {
      if (parent) parent.relateException(new ICAL.Event(vevent))
      else singles.push(new ICAL.Event(vevent))
    } catch {
      // As above.
    }
  }

  const events: (IcsEvent & { at: number })[] = []
  const add = (e: ICAL.Event, startTime: ICAL.Time, endTime: ICAL.Time, id: string, repeats: boolean) => {
    if (String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return
    const allDay = startTime.isDate
    let s: string, en: string, at: number, eventZone: string | undefined
    if (allDay) {
      s = dateOf(startTime)
      // DTEND is exclusive; with none, or none after the start, the event is that one day.
      const last = endTime && endTime.compare(startTime) > 0 ? endTime : startTime.clone()
      if (last.compare(startTime) <= 0) last.adjust(1, 0, 0, 0)
      en = dateOf(last)
      if (en <= from || s >= to) return
      at = Temporal.PlainDate.from(s).toZonedDateTime(zone).epochMilliseconds
    } else {
      const zoneOf = (p: string) => (e.component.getFirstProperty(p)?.getParameter('tzid') as string | undefined) ?? undefined
      const a = point(startTime, zoneOf('dtstart'))
      const b = endTime ? point(endTime, zoneOf('dtend') ?? zoneOf('dtstart')) : a
      if (a.at >= rangeEnd || (b.at <= rangeStart && a.at < rangeStart)) return
      s = a.value
      en = b.value
      at = a.at
      eventZone = a.zone
    }
    const text = (p: string) => {
      const v = e.component.getFirstPropertyValue(p)
      return v == null || v === '' ? undefined : String(v)
    }
    events.push({
      id,
      at,
      title: e.summary ?? '',
      start: s,
      end: en,
      ...(allDay && { allDay: true }),
      ...(eventZone && { zone: eventZone }),
      ...(text('location') && { location: text('location') }),
      ...(text('description') && { notes: text('description') }),
      ...(text('url') && { url: text('url') }),
      ...(repeats && { repeats: true }),
    })
  }

  for (const e of singles) {
    try {
      const recurrenceId = e.component.getFirstPropertyValue('recurrence-id') as ICAL.Time | null
      add(e, e.startDate, e.endDate, `${uidOf(e)}@${(recurrenceId ?? e.startDate).toString()}`, false)
    } catch {
      // As above.
    }
  }

  for (const e of series.values()) {
    try {
      // Start a day early and stop a day late: the range is in local dates, the rule in the feed's zone.
      const stop = end.clone()
      stop.adjust(1, 0, 0, 0)
      const it = e.iterator()
      let next: ICAL.Time | null
      // Skip ahead cheaply for series that began long ago.
      const earliest = start.clone()
      earliest.adjust(-1 - Math.ceil(e.duration.toSeconds() / 86_400), 0, 0, 0)
      while ((next = it.next())) {
        if (next.compare(stop) >= 0) break
        if (next.compare(earliest) < 0) continue
        const d = e.getOccurrenceDetails(next)
        add(d.item, d.startDate, d.endDate, `${uidOf(e)}@${d.recurrenceId.toString()}`, true)
      }
    } catch {
      // As above.
    }
  }

  events.sort((a, b) => a.at - b.at || a.title.localeCompare(b.title))
  // Feeds repeat UIDs they shouldn't; every event still needs its own id.
  const seen = new Map<string, number>()
  for (const e of events) {
    const n = seen.get(e.id) ?? 0
    seen.set(e.id, n + 1)
    if (n) e.id = `${e.id}#${n}`
  }
  return { name: String(root.getFirstPropertyValue('x-wr-calname') ?? '') || undefined, events: events.map(({ at: _at, ...e }) => e), unknownZones: [...unknownZones] }
}
