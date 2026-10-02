// The rules of repeating todos (docs/design/frontend.md, "Repeating todos"):
// RRULEs (RFC 5545), checked and walked with ical.js. Kept apart from
// repeats.ts so the workspace's checks can use it without Electron.

import ICAL from 'ical.js'
import type { TimeValue } from '../../shared/time'

/** A rule that never reaches today within this many dates is given up on (a typo like a far-past UNTIL). */
const MAX_STEPS = 5000

/** The id of a series' time on a date: the same wherever and however often it's worked out. */
export const occurrenceId = (series: string, date: string) => `t-${series.slice(2)}-${date.replaceAll('-', '')}`

/**
 * The rule's dates from `start`, as plain dates, in order: the first that's on
 * or after `from`, or null when the rule ends first. The rule walks clocks, so a
 * series at 19:00 is at 19:00 on each date whatever the zone's offset.
 */
export function nextDate(rule: string, start: TimeValue, from: Temporal.PlainDate): Temporal.PlainDate | null {
  if (start.kind !== 'day' && start.kind !== 'zoned') return null
  const wall = start.kind === 'day' ? start.date.toPlainDateTime() : start.wall
  const dtstart = ICAL.Time.fromData({ year: wall.year, month: wall.month, day: wall.day, hour: wall.hour, minute: wall.minute, isDate: start.kind === 'day' })
  const it = ICAL.Recur.fromString(rule).iterator(dtstart)
  for (let i = 0, next = it.next(); next && i < MAX_STEPS; i++, next = it.next()) {
    const date = Temporal.PlainDate.from({ year: next.year, month: next.month, day: next.day })
    if (Temporal.PlainDate.compare(date, from) >= 0) return date
  }
  return null
}

/** The rule without its COUNT, for walking it afresh from a day that isn't its start; the count is kept by who walks it. */
export const withoutCount = (rule: string) => rule.split(';').filter((part) => !part.startsWith('COUNT=')).join(';')

/** How many times the rule has in all, or null when it doesn't say. */
export const ruleCount = (rule: string) => ICAL.Recur.fromString(rule).count ?? null

/** Why an RRULE won't do, in words the agent can act on; '' when it's fine. The workspace's check uses it too. */
export function ruleProblem(text: string) {
  if (!/^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(;[A-Z]+=[^;]+)*$/.test(text)) return `"${text}" isn't a repeat rule: write an RRULE like FREQ=WEEKLY;BYDAY=MO.`
  try {
    // Some rules only fail once walked, like BYMONTHDAY in a weekly one.
    ICAL.Recur.fromString(text).iterator(ICAL.Time.fromData({ year: 2026, month: 1, day: 1, isDate: true })).next()
    return ''
  } catch (error) {
    return `"${text}" isn't a repeat rule: ${(error as Error).message}`
  }
}

/** The rule's first `count` dates on or after `from`, for reading a rule back in words. */
export function upcoming(rule: string, start: TimeValue, from: Temporal.PlainDate, count = 3): Temporal.PlainDate[] {
  const dates: Temporal.PlainDate[] = []
  for (let at = nextDate(rule, start, from); at && dates.length < count; at = nextDate(rule, start, at.add({ days: 1 }))) dates.push(at)
  return dates
}

