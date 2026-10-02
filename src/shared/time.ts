// Jezo's time values (docs/design/time.md). Every time in a workspace file says
// which clock it's on, so it means one moment wherever the user is:
//
//   '2026-10-05T09:00[America/New_York]'  a time in a zone: what a todo is scheduled at
//   '2026-10-05T16:00:00+09:00'           a moment: when something happened
//
// Calendar events come in what their source gives, which can also be a day
// ('2026-10-08') or a floating clock that has no zone ('2026-10-08T09:00').
//
// This module is the only thing that reads or writes these strings. Every
// function that needs a zone takes one: nothing here reads the process's own.

/**
 * Now. Read through Date.now, the one clock the whole app uses, so a test that
 * moves the clock moves every part of Jezo with it.
 */
export const now = () => Temporal.Instant.fromEpochMilliseconds(Date.now())

/** An IANA zone name, like "Asia/Taipei". */
export type Zone = string

export type TimeValue =
  | { kind: 'day'; date: Temporal.PlainDate }
  /** `offset` is kept only to pick the second of a clock that happens twice. */
  | { kind: 'zoned'; wall: Temporal.PlainDateTime; zone: Zone; offset?: string }
  /** A calendar event with no zone: that clock wherever the user is. Jezo never writes one. */
  | { kind: 'floating'; wall: Temporal.PlainDateTime }
  /** The moment, in the offset it was recorded with. */
  | { kind: 'moment'; at: Temporal.ZonedDateTime }

/**
 * What a time is for, which decides what it may be: a todo's `scheduled` is a
 * time in a zone or a moment; a record (created, completed) is a moment; a
 * deadline (a todo's `due`) is a day or a time in a zone; a calendar event can
 * be anything its source sends.
 */
export type Role = 'plan' | 'record' | 'deadline' | 'event'

const DAY = /^\d{4}-\d{2}-\d{2}$/
const WALL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/
const ZONED = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?)([+-](?:[01]\d|2[0-3]):[0-5]\d)?\[([^\]=]+)\]$/
const MOMENT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** Why a string isn't a time, in words the agent and the problems page can show. */
export class TimeError extends Error {}

const forms: Record<Role, string> = {
  plan: "a time with its zone, like '2026-10-05T09:00[Asia/Taipei]': the zone the time note names, or the one the user named",
  record: "a moment with its offset, like '2026-10-05T16:00:00+09:00'",
  deadline: "a day, like '2026-10-09', or a time with its zone, like '2026-10-09T17:00[Asia/Taipei]'",
  event: "a day, a time with its zone, a clock, or a moment",
}

/**
 * Reads a time string for a role. Throws a TimeError that says what's wrong and
 * what to write: a form the role doesn't take (a clock with no zone for a todo),
 * a date or clock that doesn't exist (Feb 30, 25:00), or an unknown zone.
 */
export function parseTime(text: string, role: Role = 'plan'): TimeValue {
  let value: TimeValue | null = null
  try {
    if (DAY.test(text)) value = { kind: 'day', date: Temporal.PlainDate.from(text) }
    else if (WALL.test(text)) value = { kind: 'floating', wall: Temporal.PlainDateTime.from(text) }
    else if (ZONED.exec(text)) {
      const [, clock, offset, zone] = ZONED.exec(text)!
      const wall = Temporal.PlainDateTime.from(clock)
      // Throws on a zone Temporal doesn't know, or an offset that can't be one (+25:00).
      const canonical = Temporal.ZonedDateTime.from(text, { offset: 'prefer' }).timeZoneId
      value = { kind: 'zoned', wall, zone: canonical, ...(offset && { offset }) }
    } else if (MOMENT.test(text)) {
      const instant = Temporal.Instant.from(text)
      value = { kind: 'moment', at: instant.toZonedDateTimeISO(text.endsWith('Z') ? 'UTC' : text.slice(-6)) }
    }
  } catch (error) {
    throw new TimeError(`"${text}" isn't a real time: ${(error as Error).message}`)
  }
  const kinds: Record<Role, TimeValue['kind'][]> = { plan: ['zoned', 'moment'], record: ['moment'], deadline: ['day', 'zoned', 'moment'], event: ['day', 'zoned', 'floating', 'moment'] }
  if (!value || !kinds[role].includes(value.kind)) {
    throw new TimeError(`"${text}" isn't ${(role === 'plan' || role === 'deadline') && value?.kind === 'floating' ? 'a time Jezo can place: it has no zone' : 'a time Jezo reads here'}. Write ${forms[role]}.`)
  }
  return value
}

/** Reads a time, or null when it's missing or unreadable. */
export function readTime(text: unknown, role: Role = 'plan'): TimeValue | null {
  if (typeof text !== 'string') return null
  try {
    return parseTime(text, role)
  } catch {
    return null
  }
}

/** A clock without seconds when it has none: "2026-10-05T09:00". */
function wallText(wall: Temporal.PlainDateTime) {
  return wall.toString({ smallestUnit: wall.second || wall.millisecond ? 'second' : 'minute' })
}

/** The string a value is written as. */
export function formatTime(value: TimeValue): string {
  switch (value.kind) {
    case 'day':
      return value.date.toString()
    case 'zoned':
      return `${wallText(value.wall)}${value.offset ?? ''}[${value.zone}]`
    case 'floating':
      return wallText(value.wall)
    case 'moment':
      return value.at.toString({ smallestUnit: 'second', timeZoneName: 'never' }).replace(/\+00:00$/, value.at.timeZoneId === 'UTC' ? 'Z' : '+00:00')
  }
}

export interface Resolved {
  /** The moment, shown in the zone that was asked for. */
  at: Temporal.ZonedDateTime
  /** The clock didn't exist that day (clocks went forward) and was moved by the gap. */
  shifted?: boolean
}

/** Where a value falls, seen from `zone`. A day has no moment and gives null. */
export function resolve(value: TimeValue, zone: Zone): Resolved | null {
  switch (value.kind) {
    case 'day':
      return null
    case 'zoned': {
      // A matching offset picks the second of a repeated clock; one that no longer fits the zone's rules is ignored.
      const at = Temporal.ZonedDateTime.from(formatTime(value), { offset: 'prefer', disambiguation: 'compatible' })
      return { at: at.withTimeZone(zone), ...(!at.toPlainDateTime().equals(value.wall) && { shifted: true }) }
    }
    case 'floating': {
      const at = value.wall.toZonedDateTime(zone, { disambiguation: 'compatible' })
      return { at, ...(!at.toPlainDateTime().equals(value.wall) && { shifted: true }) }
    }
    case 'moment':
      return { at: value.at.withTimeZone(zone) }
  }
}

/** The date a value belongs to, seen from `zone`. A day keeps its date. */
export function dateOf(value: TimeValue, zone: Zone): Temporal.PlainDate {
  if (value.kind === 'day') return value.date
  return resolve(value, zone)!.at.toPlainDate()
}

/** Milliseconds since the epoch, seen from `zone` (which matters only for a floating event); undefined for a day. */
export function epochOf(value: TimeValue | null, zone: Zone): number | undefined {
  if (!value) return undefined
  return resolve(value, zone)?.at.epochMilliseconds
}

/**
 * When a deadline is past, in milliseconds since the epoch: a day's when that
 * day ends in `zone`, where the user is; a time's at its moment.
 */
export function deadlineEnd(value: TimeValue, zone: Zone): number {
  if (value.kind === 'day') return value.date.add({ days: 1 }).toZonedDateTime({ timeZone: zone }).epochMilliseconds
  return resolve(value, zone)!.at.epochMilliseconds
}

/** A moment, written with the offset of `zone` at that moment: what records are stamped with. */
export function stamp(zone: Zone, at: Temporal.Instant | number = now()): string {
  const instant = typeof at === 'number' ? Temporal.Instant.fromEpochMilliseconds(at) : at
  return instant.toZonedDateTimeISO(zone).toString({ smallestUnit: 'second', timeZoneName: 'never' })
}

/** Today's date in `zone`. */
export const todayIn = (zone: Zone, at: Temporal.Instant = now()) => at.toZonedDateTimeISO(zone).toPlainDate()

/**
 * A repeating series made from a todo (docs/design/frontend.md, "Repeating
 * todos"): its `start`, the `date` of the todo as its first time, and its deadline
 * as `dueAfter`. The start is the planned time, a clock in a zone, or else a day:
 * the deadline's, or today. A length of days alone (P2D) is a day deadline that
 * many days after; one with a time part (PT8H, P1DT0S) is a time that long after
 * the planned time, or, for a series on a day, after that day begins in
 * `dueZone`, the deadline's own zone.
 */
export function seriesFrom(scheduled: string | undefined, due: string | undefined, zone: Zone): { start: string; date: Temporal.PlainDate; dueAfter?: string; dueZone?: Zone } {
  const read = readTime(scheduled)
  const deadline = readTime(due, 'deadline')
  // A moment, or a clock with no zone, repeats as the clock it is where the user is.
  const plan: TimeValue | null = read && read.kind !== 'day' && read.kind !== 'zoned' ? { kind: 'zoned', wall: resolve(read, zone)!.at.toPlainDateTime(), zone } : read
  if (plan?.kind === 'zoned') {
    const start = formatTime(plan)
    const date = plan.wall.toPlainDate()
    if (!deadline) return { start, date }
    if (deadline.kind === 'day') return { start, date, dueAfter: `P${Math.max(0, date.until(deadline.date).days)}D` }
    // From the planned moment itself, so a clock that happens twice keeps the one it was.
    const length = resolve(plan, plan.zone)!.at.until(resolve(deadline, plan.zone)!.at, { largestUnit: 'day' })
    return { start, date, dueAfter: timeLength(length.sign < 0 ? new Temporal.Duration() : length) }
  }
  if (!deadline) return { start: todayIn(zone).toString(), date: todayIn(zone) }
  if (deadline.kind === 'day') return { start: deadline.date.toString(), date: deadline.date }
  // A clock on the deadline's day, as it reads where the deadline is.
  const at = deadline.kind === 'zoned' ? { wall: deadline.wall, zone: deadline.zone } : { wall: resolve(deadline, zone)!.at.toPlainDateTime(), zone }
  const date = at.wall.toPlainDate()
  return { start: date.toString(), date, dueAfter: timeLength(date.toPlainDateTime().until(at.wall)), dueZone: at.zone }
}

/** A length written with its time part even when it has none (P1DT0S), so it reads as a time deadline, not a day one. */
const timeLength = (length: Temporal.Duration) => {
  const text = length.toString()
  return text.includes('T') ? text : `${text}T0S`
}

/** What placing a clock on a date gives, and whether that clock was real. */
export interface Placed {
  value: TimeValue
  /** The clock doesn't exist that day; `value` is it moved by the gap, to offer instead. */
  gap?: boolean
  /** The clock happens twice that day; `value` is the first. */
  twice?: boolean
}

/**
 * A new time from a date and a clock read in `zone`, fixed to that zone. Gaps
 * and repeats are reported, not hidden: new input in a gap is refused by the
 * caller, with `value` offered instead.
 */
export function place(date: string, clock: string, zone: Zone): Placed {
  const wall = Temporal.PlainDateTime.from(`${date}T${clock}`)
  const first = wall.toZonedDateTime(zone, { disambiguation: 'earlier' })
  const last = wall.toZonedDateTime(zone, { disambiguation: 'later' })
  const real = first.toPlainDateTime().equals(wall)
  const kept = real ? wall : wall.toZonedDateTime(zone, { disambiguation: 'compatible' }).toPlainDateTime()
  return { value: { kind: 'zoned', wall: kept, zone: first.timeZoneId }, ...(!real && { gap: true }), ...(real && first.offset !== last.offset && { twice: true }) }
}

/**
 * Moves a value to the moment a clock names in `zone`, keeping its zone: a time
 * fixed to New York stays in New York, converted. Moved in Tokyo to 23:00, it
 * becomes 10:00 New York. A clock in a gap is reported, with the shifted moment
 * in the value's own zone.
 */
export function moveTo(value: TimeValue, date: string, clock: string, zone: Zone): Placed {
  const target = place(date, clock, zone)
  if (value.kind !== 'zoned' && value.kind !== 'moment') return target
  return { ...target, value: kept(value, resolve(target.value, zone)!.at) }
}

/** A moment, written the way `value` is: in its zone, with the offset when that clock happens twice there and it's the second. */
function kept(value: TimeValue & { kind: 'zoned' | 'moment' }, at: Temporal.ZonedDateTime): TimeValue {
  if (value.kind === 'moment') return { kind: 'moment', at: at.withTimeZone(value.at.timeZoneId) }
  const there = at.withTimeZone(value.zone)
  const wall = there.toPlainDateTime()
  const second = wall.toZonedDateTime(value.zone, { disambiguation: 'earlier' }).offset !== there.offset
  return { kind: 'zoned', wall, zone: value.zone, ...(second && { offset: there.offset }) }
}
