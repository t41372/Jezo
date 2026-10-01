import type { Todo } from '@/data/types'
import i18n from '@/i18n'
import { cityOf } from '@/components/ZonePicker'
import { clock, inZone, weekday } from '@/lib/time'

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
