import type { Todo } from '@/data/types'
import i18n from '@/i18n'
import { clock, weekday } from '@/lib/time'

/** "到公司倒完咖啡之後", or the time when there's no cue. */
export function whenLabel(todo: Todo) {
  if (todo.fromCalendar && todo.slot) return i18n.t('todo.fromCalendar', { time: clock(todo.slot.start) })
  if (todo.cue) return i18n.t('todo.after', { cue: todo.cue })
  return todo.slot ? clock(todo.slot.start) : i18n.t('todo.unscheduled')
}

/** "週二 09:10 – 10:20" */
export function slotLabel(todo: Todo) {
  if (!todo.slot) return i18n.t('todo.unscheduled')
  const { date, start } = todo.slot
  return `${weekday(date)} ${clock(start)} – ${clock(start + todo.estimateMinutes / 60)}`
}

/** True when anything about the todo is still the agent's proposal. */
export function isDraft(todo: Todo) {
  return todo.state === 'draft' || !!todo.slot?.proposed
}
