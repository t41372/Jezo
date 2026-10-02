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
const plainOf = (t: ICAL.Time) => Temporal.PlainDateTime.from({ year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second })
const wallText = (w: Temporal.PlainDateTime) => w.toString({ smallestUnit: w.second ? 'second' : 'minute' })

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

const DAY_MS = 86_400_000

/**
 * A VTIMEZONE for a zone the runtime knows, built from the runtime's own rules
 * (the tz database Temporal uses everywhere else in Jezo): one observance per
 * change. With it in the feed, ical.js expands repeats in the event's real zone,
 * so UNTIL and EXDATE are compared as moments. A zone without changes is one
 * observance.
 */
function vtimezone(tzid: string, until: Temporal.Instant): ICAL.Component {
  const vtz = new ICAL.Component('vtimezone')
  vtz.addPropertyWithValue('tzid', tzid)
  const observance = (wall: Temporal.PlainDateTime, from: number, to: number) => {
    const c = new ICAL.Component(to > from ? 'daylight' : 'standard')
    c.addPropertyWithValue('dtstart', ICAL.Time.fromData({ year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute, second: wall.second }))
    c.addPropertyWithValue('tzoffsetfrom', ICAL.UtcOffset.fromSeconds(from))
    c.addPropertyWithValue('tzoffsetto', ICAL.UtcOffset.fromSeconds(to))
    vtz.addSubcomponent(c)
  }
  const seconds = (z: Temporal.ZonedDateTime) => Math.round(z.offsetNanoseconds / 1e9)
  let at = Temporal.Instant.from('1900-01-01T00:00:00Z').toZonedDateTimeISO(tzid)
  observance(Temporal.PlainDateTime.from('1900-01-01T00:00:00'), seconds(at), seconds(at))
  for (;;) {
    const next = at.getTimeZoneTransition('next')
    if (!next || Temporal.Instant.compare(next.toInstant(), until) > 0) break
    const before = seconds(next.subtract({ nanoseconds: 1 }))
    // DTSTART is the clock just before the change, in the offset it changes from.
    observance(next.toInstant().add({ seconds: before }).toZonedDateTimeISO('UTC').toPlainDateTime(), before, seconds(next))
    at = next
  }
  return vtz
}

/** When a zone the feed defines changes its offset: from what, to what, sorted. */
interface Change {
  ms: number
  from: number
  to: number
}

/**
 * A feed's VTIMEZONE as the list of its changes, read from its observances: each
 * one's DTSTART, RRULE and RDATEs are clocks in the offset it changes from.
 * ical.js expands the rules (floating clocks, which it gets right); the offsets
 * are worked out here, because ical.js puts the change of a zone it reads from a
 * feed an hour off around the change itself.
 */
function changesOf(zone: ICAL.Timezone, until: number): Change[] {
  const changes: Change[] = []
  for (const observance of [...zone.component.getAllSubcomponents('standard'), ...zone.component.getAllSubcomponents('daylight')]) {
    const from = (observance.getFirstPropertyValue('tzoffsetfrom') as ICAL.UtcOffset).toSeconds()
    const to = (observance.getFirstPropertyValue('tzoffsetto') as ICAL.UtcOffset).toSeconds()
    const start = observance.getFirstPropertyValue('dtstart') as ICAL.Time
    const msOf = (t: ICAL.Time) => plainOf(t).toZonedDateTime('UTC').epochMilliseconds - from * 1000
    const add = (t: ICAL.Time) => changes.push({ ms: msOf(t), from, to })
    add(start)
    for (const rdate of observance.getAllProperties('rdate')) for (const value of rdate.getValues() as ICAL.Time[]) if (value?.year) add(value)
    const rule = observance.getFirstPropertyValue('rrule') as ICAL.Recur | null
    if (!rule) continue
    const it = rule.iterator(start)
    for (let next = it.next(); next && msOf(next) <= until; next = it.next()) if (next.compare(start) !== 0) add(next)
  }
  return changes.sort((a, b) => a.ms - b.ms)
}

/** A moment's offset in a zone the feed defines, in seconds. */
function offsetIn(changes: Change[], ms: number) {
  let offset = changes[0]?.from ?? 0
  for (const change of changes) {
    if (change.ms > ms) break
    offset = change.to
  }
  return offset
}

/**
 * A clock in a zone the feed defines, as a moment, the way RFC 5545 reads it: a
 * clock that happens twice is the first (3.3.5), and one the clocks skip keeps
 * the offset from before the change, so 02:30 is 03:30 (erratum 4271, which
 * Google and Apple Calendar follow).
 */
function inFeedZone(wall: Temporal.PlainDateTime, changes: Change[]) {
  const asUtc = wall.toZonedDateTime('UTC').epochMilliseconds
  const before = offsetIn(changes, asUtc - DAY_MS)
  const after = offsetIn(changes, asUtc + DAY_MS)
  // Each offset around the clock gives a moment; it's real if the zone has that offset then.
  const real = [...new Set([asUtc - before * 1000, asUtc - after * 1000])].filter((ms) => offsetIn(changes, ms) * 1000 === asUtc - ms).sort((a, b) => a - b)
  const ms = real[0] ?? asUtc - before * 1000
  return { ms, offset: offsetIn(changes, ms) }
}

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

/** Every zone the feed's events name, and X-WR-TIMEZONE. */
function namedZones(root: ICAL.Component, defaultZone: string | undefined) {
  const names = new Set<string>(defaultZone ? [defaultZone] : [])
  for (const vevent of root.getAllSubcomponents('vevent')) {
    for (const property of vevent.getAllProperties()) {
      const tzid = property.getParameter('tzid')
      if (typeof tzid === 'string') names.add(tzid)
    }
  }
  return names
}

/**
 * Zones the feed names that neither it nor Temporal defines, in any of its
 * events, whatever dates are asked about: the warning belongs to the feed.
 */
export function unknownZonesIn(text: string): string[] {
  const { root, zones, defaultZone } = parse(text)
  return [...namedZones(root, defaultZone)].filter((name) => !zones.has(name) && !knownZone(name))
}

/** A time as Jezo keeps it, with when it happens from where the user is, for the range and the order. */
interface Point {
  value: string
  at: number
  zone?: string
  /** A UTC time: a moment, with no zone to name. */
  utc?: boolean
}

/** The events between two days (`to` exclusive), as days in `zone`, the device's. */
export function readIcs(text: string, from: string, to: string, zone: Zone): IcsCalendar {
  const { root, zones, defaultZone } = parse(text)
  const unknownZones = new Set<string>()
  const rangeStart = Temporal.PlainDate.from(from).toZonedDateTime(zone).epochMilliseconds
  const rangeEnd = Temporal.PlainDate.from(to).toZonedDateTime(zone).epochMilliseconds

  // Zones the feed names without defining them, but the runtime knows, get a definition before
  // anything is read, scoped to this feed. Only the feed's own definitions are its author's rules.
  const own = new Set(zones.keys())
  const horizon = Temporal.Instant.fromEpochMilliseconds(rangeEnd).add({ hours: 24 * 366 * 10 })
  for (const name of namedZones(root, defaultZone)) {
    if (zones.has(name) || !knownZone(name)) continue
    const vtz = vtimezone(name, horizon)
    root.addSubcomponent(vtz)
    zones.set(name, new ICAL.Timezone({ component: vtz, tzid: name }))
  }

  // The feed's own zones as lists of changes, worked out once per read.
  const changeLists = new Map<string, Change[]>()
  const changesFor = (name: string) => {
    let changes = changeLists.get(name)
    if (!changes) changeLists.set(name, (changes = changesOf(zones.get(name)!, horizon.epochMilliseconds)))
    return changes
  }

  /** A clock in a zone the feed named, as a moment: the feed's own rules, or the runtime's for an IANA name. */
  const resolve = (wall: Temporal.PlainDateTime, name: string | undefined): Point => {
    if (name && own.has(name)) {
      const { ms, offset } = inFeedZone(wall, changesFor(name))
      return { value: stamp(offsetName(offset), ms), at: ms, zone: name }
    }
    if (name && knownZone(name)) {
      // Around a daylight-saving change, RFC 5545 and Temporal agree: a time that happens twice is the first,
      // and one in the skipped hour is moved by the gap.
      const at = wall.toZonedDateTime(name, { disambiguation: 'compatible' }).epochMilliseconds
      return { value: stamp(name, at), at, zone: name }
    }
    if (name) unknownZones.add(name)
    // Floating: the clock as written, wherever the user is.
    return { value: wallText(wall), at: wall.toZonedDateTime(zone, { disambiguation: 'compatible' }).epochMilliseconds }
  }

  /** A moment, written in the zone a time was given in. */
  const at = (ms: number, like: Point): Point => {
    if (like.zone && own.has(like.zone)) return { value: stamp(offsetName(offsetIn(changesFor(like.zone), ms)), ms), at: ms, zone: like.zone }
    if (like.zone) return { value: stamp(like.zone, ms), at: ms, zone: like.zone }
    if (like.utc) return { value: stamp('UTC', ms), at: ms, utc: true }
    // Floating: the clock moves by the same amount.
    const wall = Temporal.PlainDateTime.from(like.value).add({ milliseconds: ms - like.at })
    return { value: wallText(wall), at: ms }
  }

  /** A time from the feed, keeping its meaning: a moment in the zone it was given in, or a local time when it floats. */
  const point = (t: ICAL.Time, tzid: string | undefined): Point => {
    if (t.zone === ICAL.Timezone.utcTimezone) {
      const ms = t.toJSDate().getTime()
      return { value: stamp('UTC', ms), at: ms, utc: true }
    }
    return resolve(plainOf(t), tzid ?? defaultZone)
  }

  /**
   * An event's end from its start and DURATION (RFC 5545, 3.3.6): weeks and days
   * are calendar days in its zone, hours and less are elapsed time after them.
   */
  const lasting = (start: Point, startTime: ICAL.Time, duration: ICAL.Duration, tzid: string | undefined): Point => {
    const sign = duration.isNegative ? -1 : 1
    const days = sign * (duration.weeks * 7 + duration.days)
    const elapsed = sign * (duration.hours * 3600 + duration.minutes * 60 + duration.seconds) * 1000
    const startOfLength = days ? (startTime.zone === ICAL.Timezone.utcTimezone ? at(start.at + days * DAY_MS, start) : resolve(plainOf(startTime).add({ days }), tzid ?? defaultZone)) : start
    return at(startOfLength.at + elapsed, startOfLength)
  }

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
  /**
   * One occurrence. `length` is a repeat's own length in elapsed time, from its
   * first DTSTART and DTEND: every occurrence lasts that long, on a day the
   * clocks change too.
   */
  const add = (e: ICAL.Event, startTime: ICAL.Time, endTime: ICAL.Time | null, id: string, repeats: boolean, length?: number) => {
    if (String(e.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED') return
    const allDay = startTime.isDate
    let s: string, en: string, first: number, eventZone: string | undefined
    if (allDay) {
      s = dateOf(startTime)
      // DTEND is exclusive; a DURATION counts from the start; with neither, or none after the start, the event is that one day.
      const duration = e.component.getFirstPropertyValue('duration') as ICAL.Duration | null
      let last = endTime
      if (!last && duration && !e.component.hasProperty('dtend')) {
        last = startTime.clone()
        last.addDuration(duration)
      }
      if (!last || last.compare(startTime) <= 0) {
        last = startTime.clone()
        last.adjust(1, 0, 0, 0)
      }
      en = dateOf(last)
      if (en <= from || s >= to) return
      first = Temporal.PlainDate.from(s).toZonedDateTime(zone).epochMilliseconds
    } else {
      const tzOf = (p: string) => (e.component.getFirstProperty(p)?.getParameter('tzid') as string | undefined) ?? undefined
      const a = point(startTime, tzOf('dtstart'))
      const duration = e.component.getFirstPropertyValue('duration') as ICAL.Duration | null
      const b = duration && !e.component.hasProperty('dtend')
        ? lasting(a, startTime, duration, tzOf('dtstart'))
        : length !== undefined
          ? at(a.at + length, a)
          : endTime ? point(endTime, tzOf('dtend') ?? tzOf('dtstart')) : a
      if (a.at >= rangeEnd || (b.at <= rangeStart && a.at < rangeStart)) return
      s = a.value
      en = b.value
      first = a.at
      eventZone = a.zone
    }
    const text = (p: string) => {
      const v = e.component.getFirstPropertyValue(p)
      return v == null || v === '' ? undefined : String(v)
    }
    events.push({
      id,
      at: first,
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
      add(e, e.startDate, e.component.hasProperty('dtend') ? e.endDate : null, `${uidOf(e)}@${(recurrenceId ?? e.startDate).toString()}`, false)
    } catch {
      // As above.
    }
  }

  for (const e of series.values()) {
    try {
      const tzid = e.component.getFirstProperty('dtstart')?.getParameter('tzid') as string | undefined
      // An event's own length in elapsed time, when it has a DTEND: the series', or a moved occurrence's.
      const lengthOf = (item: ICAL.Event) => {
        if (!item.component.hasProperty('dtend') || item.startDate.isDate) return undefined
        const zoneOf = (p: string) => item.component.getFirstProperty(p)?.getParameter('tzid') as string | undefined
        return point(item.endDate, zoneOf('dtend') ?? zoneOf('dtstart')).at - point(item.startDate, zoneOf('dtstart')).at
      }
      const length = lengthOf(e)
      // The rule walks clocks; the range is moments. Two days either side cover any two zones, plus the event's length.
      const stop = ICAL.Time.fromDateString(to)
      stop.adjust(2, 0, 0, 0)
      const earliest = ICAL.Time.fromDateString(from)
      earliest.adjust(-2 - Math.ceil(e.duration.toSeconds() / 86_400), 0, 0, 0)
      const done = new Set<string>()
      const it = e.iterator()
      let next: ICAL.Time | null
      while ((next = it.next())) {
        if (next.compare(stop) >= 0) break
        if (next.compare(earliest) < 0) continue
        const d = e.getOccurrenceDetails(next)
        const key = d.recurrenceId.toString()
        done.add(key)
        // A moved occurrence keeps its own length; the rest are the series' length long. One moved
        // with "this and future" (RANGE=THISANDFUTURE) moves later dates too, so its end is from each start.
        const moved = d.item !== e
        add(d.item, d.startDate, moved ? (d.item.component.hasProperty('dtend') ? d.endDate : null) : d.endDate, `${uidOf(e)}@${key}`, true, moved ? lengthOf(d.item) : length)
      }
      // An occurrence moved here from a date outside the walk is found by its new times.
      for (const [key, moved] of Object.entries(e.exceptions as unknown as Record<string, ICAL.Event>)) {
        if (done.has(key)) continue
        add(moved, moved.startDate, moved.component.hasProperty('dtend') ? moved.endDate : null, `${uidOf(e)}@${key}`, true)
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
