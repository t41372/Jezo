// Repeating todos (docs/design/frontend.md, "Repeating todos"): a series in
// repeats/ holds the rule and its start; each time is a todo, written here. What
// to write is worked out from the files each time, so running this twice, on
// two devices, or after a crash writes the same todo once.

import { powerMonitor } from 'electron'
import type { Fields, Item } from '../shared/workspace'
import { formatTime, place, readTime, stamp, todayIn, type TimeValue, type Zone } from '../shared/time'
import type { Workspace } from './workspace/workspace'
import { nextDate, occurrenceId } from './workspace/rrule'

/** The app writes the times; they aren't anyone's change, so they're not in 修改紀錄. */
const APP = { by: 'user' } as const
/** A deadline `length` after a time on `date`: a day for a series that starts on a day, a time for one at a time. */
function dueOn(date: Temporal.PlainDate, start: TimeValue, after: string | undefined, scheduled: TimeValue | null): string | null {
  if (!after) return start.kind === 'day' ? date.toString() : null
  const length = Temporal.Duration.from(after)
  if (start.kind === 'day' || !scheduled || scheduled.kind !== 'zoned') return date.add({ days: length.days, weeks: length.weeks, months: length.months, years: length.years }).toString()
  const at = scheduled.wall.toZonedDateTime(scheduled.zone).add(length)
  return formatTime({ kind: 'zoned', wall: at.toPlainDateTime(), zone: scheduled.zone })
}

export class Repeats {
  private running: Promise<void> = Promise.resolve()

  constructor(
    private workspace: Workspace,
    private zone: () => Zone,
  ) {}

  start() {
    void this.check()
    // A new day can bring a series' next time.
    setInterval(() => void this.check(), 15 * 60_000)
    powerMonitor.on('resume', () => void this.check())
    this.workspace.onChange(() => void this.check())
  }

  /** One check at a time; each reads the files as they are when it starts. */
  check(): Promise<void> {
    this.running = this.running.then(() => this.reconcile()).catch((error) => console.error('Writing repeating todos failed:', error))
    return this.running
  }

  private async reconcile() {
    const items = this.workspace.list()
    const todos = items.filter((i) => i.kind === 'todo')
    const today = todayIn(this.zone())
    for (const series of items.filter((i) => i.kind === 'repeat' && !i.problems?.length)) {
      const times = todos.filter((t) => t.data.series === series.id)
      // A proposed series starts once its first time is accepted.
      if (series.data.state === 'draft') {
        if (times.some((t) => t.data.state === 'open' || t.data.state === 'done')) await this.workspace.update(series.id, { state: 'on' }, APP)
        continue
      }
      if (series.data.state !== 'on') continue
      const date = this.next(series, times, today)
      const last = typeof series.data.last === 'string' ? series.data.last : null
      if (!date || (last && date.toString() <= last) || times.some((t) => t.data.occurrence === date.toString())) continue
      await this.write(series, date)
    }
  }

  /** The date of the time to write next, or null when there isn't one yet. */
  private next(series: Item, times: Item[], today: Temporal.PlainDate) {
    const rule = String(series.data.rule)
    const start = readTime(series.data.start, 'deadline')
    // A series repeats a day or a clock in a zone; a bare moment has no clock to repeat.
    if (!start || (start.kind !== 'day' && start.kind !== 'zoned')) return null
    const last = typeof series.data.last === 'string' ? Temporal.PlainDate.from(series.data.last) : null
    if (series.data.from === 'done') {
      // The next comes once the last is done or dropped, counted from that day.
      if (times.some((t) => t.data.state === 'open' || t.data.state === 'draft')) return null
      const latest = [...times].sort((a, b) => String(b.data.occurrence).localeCompare(String(a.data.occurrence)))[0]
      if (!latest) return last ? null : nextDate(rule, start, start.kind === 'day' ? start.date : start.wall.toPlainDate())
      const closed = readTime(latest.data.completed ?? latest.data.dropped, 'record')
      const on = closed ? Temporal.Instant.from(formatTime(closed)).toZonedDateTimeISO(this.zone()).toPlainDate() : today
      const from: TimeValue = start.kind === 'day' ? { kind: 'day', date: on } : { ...start, wall: on.toPlainDateTime(start.wall.toPlainTime()) }
      return nextDate(rule, from, on.add({ days: 1 }))
    }
    // On schedule, one time ahead: while the last one written is today or later, it's the one ahead.
    // Once its day has passed, the next is the rule's first date from today on, done or not.
    if (last && Temporal.PlainDate.compare(last, today) >= 0) return null
    return nextDate(rule, start, today)
  }

  private async write(series: Item, date: Temporal.PlainDate) {
    const start = readTime(series.data.start, 'deadline')!
    const scheduled = start.kind === 'zoned' ? place(date.toString(), start.wall.toPlainTime().toString({ smallestUnit: 'minute' }), start.zone).value : null
    const due = dueOn(date, start, typeof series.data.due_after === 'string' ? series.data.due_after : undefined, scheduled)
    const steps = Array.isArray(series.data.steps) ? (series.data.steps as { text: string }[]).map((s) => ({ text: s.text, done: false })) : undefined
    const fields: Fields = {
      id: occurrenceId(series.id, date.toString()),
      title: series.data.title,
      state: 'open',
      estimate: series.data.estimate ?? 30,
      ...(scheduled && { scheduled: formatTime(scheduled) }),
      ...(due && { due }),
      ...(series.data.goal !== undefined && { goal: series.data.goal }),
      ...(series.data.cue !== undefined && { cue: series.data.cue }),
      ...(series.data.amount !== undefined && { amount: series.data.amount }),
      ...(steps?.length && { steps }),
      series: series.id,
      occurrence: date.toString(),
      created: stamp(this.zone()),
    }
    // Written already, by another device or a check cut off before it recorded `last`.
    if (!this.workspace.get(String(fields.id))) await this.workspace.create('todo', fields, series.body, APP)
    await this.workspace.update(series.id, { last: date.toString() }, APP)
  }
}
