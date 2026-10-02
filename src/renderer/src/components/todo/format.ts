import type { Todo } from '@/data/types'
import i18n from '@/i18n'
import { cityOf } from '@/lib/zones'
import { clock, dayLabel, inZone, weekday } from '@/lib/time'

/** "到公司倒完咖啡之後", or the time when there's no cue. */
export function whenLabel(todo: Todo) {
  if (todo.fromCalendar && todo.slot) return i18n.t('todo.fromCalendar', { time: clock(todo.slot.start) })
  if (todo.cue) return i18n.t('todo.after', { cue: todo.cue })
  return todo.slot ? clock(todo.slot.start) : i18n.t('todo.unscheduled')
}

/** "週二 09:10 – 10:20", seen from `zone` (the device's unless given), ending at the moment it ends. */
export function slotLabel(todo: Todo, zone?: string) {
  if (!todo.slot) return i18n.t('todo.unscheduled')
  const { date, start } = zone ? inZone(todo.slot.at, zone) : todo.slot
  const end = zone ? inZone(todo.slot.at + todo.estimateMinutes * 60_000, zone).start : start + todo.estimateMinutes / 60
  return `${weekday(date)} ${clock(start)} – ${clock(end % 24)}`
}

/**
 * Which zone a todo's time is fixed to, in words (docs/design/time.md):
 * "東京時間 09:00" for another zone, "鳳凰城時間" for this one. Null for a todo
 * with no time.
 */
export function meaningLabel(todo: Todo, device: string) {
  if (!todo.slot) return null
  // A moment written with an offset or Z is the same instant everywhere, tied to no zone's rules.
  if (todo.slot.kind === 'moment' || !todo.slot.zone) return i18n.t('todo.meaning.moment')
  const city = cityOf(todo.slot.zone)
  if (todo.slot.zone === device) return i18n.t('todo.meaning.here', { city })
  const own = inZone(todo.slot.at, todo.slot.zone)
  const day = own.date === todo.slot.date ? '' : `${weekday(own.date)} `
  return i18n.t('todo.meaning.there', { city, time: `${day}${clock(own.start)}` })
}

/** True when anything about the todo is still the agent's proposal. */
export function isDraft(todo: Todo) {
  return todo.state === 'draft' || !!todo.slot?.proposed
}

/** 「週五截止」, 「今天 17:00 截止」, or 「截止日已過 · 週三」 when it's past and not done; null without a deadline. */
export function dueLabel(todo: Todo, today: string, now = Date.now()) {
  if (!todo.due) return null
  const day = dayLabel(todo.due.date, today)
  if (todo.due.at <= now && (todo.state === 'open' || todo.state === 'draft')) return i18n.t('todo.duePassed', { day })
  return todo.due.time === undefined ? i18n.t('todo.dueOn', { day }) : i18n.t('todo.dueAt', { day, time: clock(todo.due.time) })
}

/** Whether its planned time ends after its deadline. */
export function endsPastDue(todo: Todo) {
  return !!(todo.slot && todo.due && todo.slot.at + todo.estimateMinutes * 60_000 > todo.due.at)
}

const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** The two-letter RRULE code of a date's weekday, like MO. */
export const dayCode = (date: string) => DAYS[Temporal.PlainDate.from(date).dayOfWeek - 1]

/** A weekday code in the app's language: 週一, Mon. (2024-01-01 was a Monday.) */
const dayName = (code: string) => weekday(Temporal.PlainDate.from('2024-01-01').add({ days: DAYS.indexOf(code) }).toString())

/**
 * A repeat rule in words: 每天, 每週一, 每兩週的週四, 每月 1 號, 做完後 7 天; any other
 * rule as written. Null for none.
 */
export function repeatLabel(rule: string | undefined, from: 'schedule' | 'done' = 'schedule') {
  if (!rule) return null
  const parts = Object.fromEntries(rule.split(';').map((p) => p.split('=')))
  const n = Number(parts.INTERVAL ?? 1)
  const keys = Object.keys(parts).filter((k) => k !== 'INTERVAL')
  if (from === 'done' && parts.FREQ === 'DAILY' && keys.length === 1) return i18n.t('todo.repeat.afterDone', { count: n })
  if (parts.FREQ === 'DAILY' && keys.length === 1) return n === 1 ? i18n.t('todo.repeat.daily') : i18n.t('todo.repeat.everyDays', { count: n })
  if (parts.FREQ === 'WEEKLY' && keys.length === 2 && parts.BYDAY && parts.BYDAY.split(',').every((d: string) => DAYS.includes(d))) {
    const days = parts.BYDAY.split(',').map(dayName).join('、')
    return n === 1 ? i18n.t('todo.repeat.weekly', { days }) : i18n.t('todo.repeat.everyWeeks', { count: n, days })
  }
  if (parts.FREQ === 'MONTHLY' && n === 1 && keys.length === 2 && /^\d+$/.test(parts.BYMONTHDAY ?? '')) return i18n.t('todo.repeat.monthly', { day: parts.BYMONTHDAY })
  if (parts.FREQ === 'YEARLY' && n === 1 && keys.length === 1) return i18n.t('todo.repeat.yearly')
  return i18n.t('todo.repeat.rule', { rule })
}
