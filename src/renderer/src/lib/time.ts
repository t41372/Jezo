import type { ISODate } from '@/data/types'
import i18n from '@/i18n'

/** 9.5 → "09:30". Jezo shows 24-hour times in every language for now. */
export function clock(hours: number) {
  const minutes = Math.round(hours * 60)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

/** 70 → "70 分", 125 → "2 小時 5 分" */
export function duration(minutes: number) {
  if (minutes < 90) return i18n.t('time.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? i18n.t('time.hoursMinutes', { hours, minutes: rest }) : i18n.t('time.hours', { hours })
}

export function parseDate(date: ISODate) {
  return new Date(`${date}T00:00:00`)
}

/** A local Date back to the day it falls on. */
export function toISODate(date: Date): ISODate {
  return date.toLocaleDateString('sv-SE')
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = parseDate(date)
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('sv-SE')
}

const format = (date: ISODate, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(i18n.language, options).format(parseDate(date))

/** "週二" / "Tue" */
export function weekday(date: ISODate) {
  return format(date, { weekday: 'short' })
}

/** "9/29" */
export function monthDay(date: ISODate) {
  return format(date, { month: 'numeric', day: 'numeric' })
}

/** "9月29日 週二" / "Tue, September 29" */
export function longDate(date: ISODate) {
  return format(date, { month: 'long', day: 'numeric', weekday: 'short' })
}

/** "今天", "昨天", or "9/26 週六" relative to `today`. */
export function dayLabel(date: ISODate, today: ISODate) {
  if (date === today) return i18n.t('time.today')
  if (date === addDays(today, -1)) return i18n.t('time.yesterday')
  if (date === addDays(today, 1)) return i18n.t('time.tomorrow')
  return format(date, { month: 'numeric', day: 'numeric', weekday: 'short' })
}

/** "今天 08:02" */
export function dayTime(date: ISODate, time: number, today: ISODate) {
  return i18n.t('time.dayTime', { day: dayLabel(date, today), time: clock(time) })
}

/** A moment as "今天 08:02", seen in `zone`. */
export function momentTime(at: number, zone: string, today: ISODate) {
  const { date, start } = inZone(at, zone)
  return dayTime(date, start, today)
}

/** The Monday of the week that contains `date`. */
export function mondayOf(date: ISODate): ISODate {
  const d = parseDate(date)
  return addDays(date, -((d.getDay() + 6) % 7))
}

/** How long ago an ISO instant was, in words: "2 minutes ago", "剛剛". */
export function ago(instant: string, language: string, now = Date.now()) {
  const seconds = (Date.parse(instant) - now) / 1000
  const format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' })
  if (seconds > -60) return format.format(0, 'second')
  if (seconds > -3600) return format.format(Math.round(seconds / 60), 'minute')
  if (seconds > -86_400) return format.format(Math.round(seconds / 3600), 'hour')
  return format.format(Math.round(seconds / 86_400), 'day')
}

/** A moment's day and hours from midnight in a zone. */
export function inZone(at: number, zone: string): { date: ISODate; start: number } {
  const here = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(zone)
  return { date: here.toPlainDate().toString(), start: here.hour + here.minute / 60 }
}
