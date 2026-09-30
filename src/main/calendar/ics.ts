// Reads an iCalendar feed (RFC 5545) into the events that fall in a range,
// with repeating events expanded. ical.js does the parsing and the repeat
// rules; this file turns its times into Jezo's local times. Feeds get time
// zones wrong in several ways (see ics.test.ts), so each is handled here:
// zones described in the feed itself (Outlook's Windows names), IANA names
// with no description, UTC, and floating times.

import ICAL from 'ical.js'
import type { CalendarEvent } from '../../shared/calendar'

export interface IcsEvent extends Omit<CalendarEvent, 'calendar'> {}

export interface IcsCalendar {
  /** X-WR-CALNAME, which most feeds send. */
  name?: string
  events: IcsEvent[]
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const localTime = (d: Date) => `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
const dateOf = (t: ICAL.Time) => `${t.year}-${pad(t.month)}-${pad(t.day)}`

const knownZone = (name: string) => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: name })
    return true
  } catch {
    return false
  }
}

/** How far a zone is from UTC at an instant, in milliseconds. */
function offsetAt(zone: string, at: number) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date(at))
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value)
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - at
}

/**
 * The instant a wall-clock time in an IANA zone names. Around a daylight-saving
 * change, RFC 5545 decides: a time that happens twice is the first one, and a
 * time that doesn't happen (the skipped hour) uses the offset from before the change.
 */
function inZone(t: ICAL.Time, zone: string): Date {
  const wall = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  const before = offsetAt(zone, wall - 86_400_000)
  const after = offsetAt(zone, wall + 86_400_000)
  const fits = [...new Set([before, after])].map((o) => wall - o).filter((at) => offsetAt(zone, at) === wall - at)
  return new Date(fits.length ? Math.min(...fits) : wall - before)
}

export function readIcs(text: string, from: string, to: string): IcsCalendar {
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

  /** A time from the feed as a local Date. */
  const instant = (t: ICAL.Time, tzid: string | undefined): Date => {
    if (t.zone === ICAL.Timezone.utcTimezone) return t.toJSDate()
    if (tzid && zones.has(tzid)) return new Date(t.toUnixTime() * 1000)
    const zone = tzid ?? defaultZone
    if (zone && knownZone(zone)) return inZone(t, zone)
    // Floating time, or a zone nobody can name: the time as written, here.
    return new Date(t.year, t.month - 1, t.day, t.hour, t.minute, t.second)
  }

  const start = ICAL.Time.fromDateString(from)
  const end = ICAL.Time.fromDateString(to)
  const rangeStart = new Date(`${from}T00:00`)
  const rangeEnd = new Date(`${to}T00:00`)

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

  const events: IcsEvent[] = []
  const add = (e: ICAL.Event, startTime: ICAL.Time, endTime: ICAL.Time, id: string, repeats: boolean) => {
    if (String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return
    const allDay = startTime.isDate
    let s: string, en: string
    if (allDay) {
      s = dateOf(startTime)
      // DTEND is exclusive; with none, or none after the start, the event is that one day.
      const last = endTime && endTime.compare(startTime) > 0 ? endTime : startTime.clone()
      if (last.compare(startTime) <= 0) last.adjust(1, 0, 0, 0)
      en = dateOf(last)
      if (en <= from || s >= to) return
    } else {
      const zoneOf = (p: string) => (e.component.getFirstProperty(p)?.getParameter('tzid') as string | undefined) ?? undefined
      const a = instant(startTime, zoneOf('dtstart'))
      const b = endTime ? instant(endTime, zoneOf('dtend') ?? zoneOf('dtstart')) : a
      if (a >= rangeEnd || (b <= rangeStart && a < rangeStart)) return
      s = localTime(a)
      en = localTime(b)
    }
    const text = (p: string) => {
      const v = e.component.getFirstPropertyValue(p)
      return v == null || v === '' ? undefined : String(v)
    }
    events.push({
      id,
      title: e.summary ?? '',
      start: s,
      end: en,
      ...(allDay && { allDay: true }),
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

  events.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
  // Feeds repeat UIDs they shouldn't; every event still needs its own id.
  const seen = new Map<string, number>()
  for (const e of events) {
    const n = seen.get(e.id) ?? 0
    seen.set(e.id, n + 1)
    if (n) e.id = `${e.id}#${n}`
  }
  return { name: String(root.getFirstPropertyValue('x-wr-calname') ?? '') || undefined, events }
}
