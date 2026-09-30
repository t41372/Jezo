// The user's calendars, from the main process (docs/design/calendar.md). The
// store holds the events around the date the calendar shows, and reads them
// again when that moves to another week or a calendar changes.

import type { CalendarEvent as SourceEvent, CalendarInfo } from '../../../shared/calendar'
import { addDays, mondayOf, parseDate } from '@/lib/time'
import { useStore } from './store'
import type { CalendarEvent, ISODate } from './types'

const hoursOf = (time: string) => Number(time.slice(11, 13)) + Number(time.slice(14, 16)) / 60
const daysBetween = (a: ISODate, b: ISODate) => Math.round((+parseDate(b) - +parseDate(a)) / 86_400_000)

/** Local start and end times to a day, hours from midnight, and a length in hours. */
export function toEvent(e: SourceEvent, calendars: Map<string, CalendarInfo>): CalendarEvent {
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
  const date = e.start.slice(0, 10)
  const start = hoursOf(e.start)
  return { ...common, date, start, hours: daysBetween(date, e.end.slice(0, 10)) * 24 + hoursOf(e.end) - start }
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
  const [status, events] = await Promise.all([window.jezo.calendar.status(), window.jezo.calendar.events(from, to)])
  // A later request for another week may have answered first.
  if (ask !== asked) return
  const calendars = new Map(status.calendars.map((c) => [c.id, c]))
  useStore.setState({ calendarStatus: status, events: events.map((e) => toEvent(e, calendars)) })
}

/** Reads the calendars and follows them. Called once, when the window opens. */
export function connectCalendar() {
  window.jezo.calendar.onChange(() => void loadCalendar())
  useStore.subscribe((s, before) => {
    if (mondayOf(s.calendarDate) !== mondayOf(before.calendarDate)) void loadCalendar(s.calendarDate)
  })
  return loadCalendar()
}
