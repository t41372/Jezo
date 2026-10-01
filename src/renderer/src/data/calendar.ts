// The user's calendars, from the main process (docs/design/calendar.md). The
// store holds the events around the date the calendar shows, and reads them
// again when that moves to another week or a calendar changes.

import type { CalendarEvent as SourceEvent, CalendarInfo } from '../../../shared/calendar'
import { readTime, resolve, type Zone } from '../../../shared/time'
import { addDays, mondayOf, parseDate } from '@/lib/time'
import { useStore } from './store'
import type { CalendarEvent, ISODate } from './types'

const daysBetween = (a: ISODate, b: ISODate) => Math.round((+parseDate(b) - +parseDate(a)) / 86_400_000)

/**
 * An event as the calendar draws it, seen from `zone`: its day, hours from
 * midnight, and its real length in hours, which a day with a clock change
 * doesn't stretch or squeeze (docs/design/time.md).
 */
export function toEvent(e: SourceEvent, calendars: Map<string, CalendarInfo>, zone: Zone): CalendarEvent {
  const calendar = calendars.get(e.calendar)
  const common = {
    id: e.id,
    title: e.title,
    source: calendar?.name ?? '',
    ...(calendar?.color && { color: calendar.color }),
    ...(e.location && { location: e.location }),
    ...(e.notes && { notes: e.notes }),
    ...(e.url && { url: e.url }),
  }
  if (e.allDay) return { ...common, date: e.start, start: 0, hours: 24 * Math.max(1, daysBetween(e.start, e.end)), allDay: true }
  const from = resolve(readTime(e.start, 'event')!, zone)!.at
  const to = resolve(readTime(e.end, 'event')!, zone)!.at
  return {
    ...common,
    date: from.toPlainDate().toString(),
    start: from.hour + from.minute / 60,
    hours: (to.epochMilliseconds - from.epochMilliseconds) / 3_600_000,
    ends: { date: to.toPlainDate().toString(), hour: to.hour + to.minute / 60 },
  }
}

/** Two weeks back and seven ahead of the shown week: enough for any month the date is in. */
const windowFor = (date: ISODate) => {
  const monday = mondayOf(date)
  return { from: addDays(monday, -14), to: addDays(monday, 49) }
}

let asked = 0

export async function loadCalendar(date = useStore.getState().calendarDate) {
  const ask = ++asked
  const { from, to } = windowFor(date)
  // Shown in the calendar's zone, which is the device's unless it shows another; the days asked for are its days.
  const { zone, calendarZone } = useStore.getState()
  const shown = calendarZone ?? zone
  const [status, events] = await Promise.all([window.jezo.calendar.status(), window.jezo.calendar.events(from, to, shown)])
  // A later request for another week may have answered first.
  if (ask !== asked) return
  const calendars = new Map(status.calendars.map((c) => [c.id, c]))
  useStore.setState({ calendarStatus: status, events: events.map((e) => toEvent(e, calendars, shown)) })
}

/** Reads the calendars and follows them. Called once, when the window opens. */
export function connectCalendar() {
  window.jezo.calendar.onChange(() => void loadCalendar())
  useStore.subscribe((s, before) => {
    // Another week, or the device moved and every event sits somewhere else on the grid.
    if (mondayOf(s.calendarDate) !== mondayOf(before.calendarDate) || s.zone !== before.zone || s.calendarZone !== before.calendarZone) void loadCalendar(s.calendarDate)
  })
  return loadCalendar()
}
