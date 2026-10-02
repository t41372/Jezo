// Repeating todos (docs/design/frontend.md, "Repeating todos"): a series in
// repeats/ holds the rule and its start; each time is a todo, written here. What
// to write is worked out from the files each time, so running this twice, on
// two devices, or after a crash writes the same todo once.

import { powerMonitor } from 'electron'
import type { Fields, Item } from '../shared/workspace'
import { formatTime, place, readTime, stamp, todayIn, type TimeValue, type Zone } from '../shared/time'
import type { Workspace } from './workspace/workspace'
import { nextDate, occurrenceId, ruleCount, withoutCount } from './workspace/rrule'

/** The app writes the times; they aren't anyone's change, so they're not in 修改紀錄. */
const APP = { by: 'user' } as const
/**
 * Each time's deadline, from the series' `due_after`: days alone are a day that
 * many days after its date; a time part makes it a time that long after its
 * planned time, or after its day begins (in `zone`: the series' `due_zone`, or
 * where the user is) for a series on a day.
 */
function dueOn(date: Temporal.PlainDate, start: TimeValue, after: string | undefined, scheduled: TimeValue | null, zone: Zone): string | null {
  if (!after) return start.kind === 'day' ? date.toString() : null
  const length = Temporal.Duration.from(after)
  if (!after.includes('T')) return date.add(length).toString()
  const at = scheduled?.kind === 'zoned' ? scheduled.wall.toZonedDateTime(scheduled.zone).add(length) : date.toPlainDateTime().add(length).toZonedDateTime(zone)
  return formatTime({ kind: 'zoned', wall: at.toPlainDateTime(), zone: at.timeZoneId })
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
      // One series that can't be worked out doesn't hold up the others.
      await this.reconcileOne(series, todos, today).catch((error) => console.error(`Writing the next time of ${series.id} failed:`, error))
    }
  }

  private async reconcileOne(series: Item, todos: Item[], today: Temporal.PlainDate) {
    const times = todos.filter((t) => t.data.series === series.id)
    // A proposed series starts once its first time is accepted.
    if (series.data.state === 'draft') {
      if (times.some((t) => t.data.state === 'open' || t.data.state === 'done')) await this.workspace.update(series.id, { state: 'on' }, APP)
      return
    }
    if (series.data.state !== 'on') return
    const date = this.next(series, times, today)
    if (date) await this.write(series, date)
  }

  /** The date of the time to write next, or null when there isn't one yet. */
  private next(series: Item, times: Item[], deviceToday: Temporal.PlainDate) {
    const rule = String(series.data.rule)
    const start = readTime(series.data.start, 'deadline')
    // A series repeats a day or a clock in a zone; a bare moment has no clock to repeat.
    if (!start || (start.kind !== 'day' && start.kind !== 'zoned')) return null
    // A day floats with the user; a clock in a zone has its dates in that zone.
    const zone = start.kind === 'zoned' ? start.zone : this.zone()
    const today = start.kind === 'zoned' ? todayIn(zone) : deviceToday
    const last = typeof series.data.last === 'string' ? Temporal.PlainDate.from(series.data.last) : null
    if (series.data.from === 'done') {
      // The next comes once the last one written is done or dropped, counted from that day.
      if (times.some((t) => t.data.state === 'open' || t.data.state === 'draft')) return null
      if (!last && !times.length) return nextDate(rule, start, start.kind === 'day' ? start.date : start.wall.toPlainDate())
      // The last one written, or the latest when none was recorded. Deleted, it isn't replaced: the user took it away.
      const latest = last ? times.find((t) => t.data.occurrence === last.toString()) : [...times].sort((a, b) => String(b.data.occurrence).localeCompare(String(a.data.occurrence)))[0]
      if (!latest) return null
      // Each time is one of a COUNT, which a rule walked afresh from each done day wouldn't see.
      if (times.length >= (ruleCount(rule) ?? Infinity)) return null
      const closed = readTime(latest.data.completed ?? latest.data.dropped, 'record')
      const on = closed ? Temporal.Instant.from(formatTime(closed)).toZonedDateTimeISO(zone).toPlainDate() : today
      const from: TimeValue = start.kind === 'day' ? { kind: 'day', date: on } : { ...start, wall: on.toPlainDateTime(start.wall.toPlainTime()) }
      // Walked afresh from the day it was done, the rule's COUNT would count that day and the dates
      // skipped; the times written are what's counted, above. Done early, the next can land on a date
      // that already has a time; it's the one after.
      const walk = withoutCount(rule)
      let date = nextDate(walk, from, on.add({ days: 1 }))
      while (date && times.some((t) => t.data.occurrence === date!.toString())) date = nextDate(walk, from, date.add({ days: 1 }))
      return date
    }
    // On schedule, one time ahead: while the last one written is today or later, it's the one ahead.
    // Once its day has passed, the next is the rule's first date from today on, done or not.
    if (last && Temporal.PlainDate.compare(last, today) >= 0) return null
    const date = nextDate(rule, start, today)
    // A date written before, then deleted, isn't written again.
    if (!date || (last && Temporal.PlainDate.compare(date, last) <= 0) || times.some((t) => t.data.occurrence === date.toString())) return null
    return date
  }

  private async write(series: Item, date: Temporal.PlainDate) {
    const start = readTime(series.data.start, 'deadline')!
    const scheduled = start.kind === 'zoned' ? place(date.toString(), start.wall.toPlainTime().toString({ smallestUnit: 'minute' }), start.zone).value : null
    const due = dueOn(date, start, typeof series.data.due_after === 'string' ? series.data.due_after : undefined, scheduled, typeof series.data.due_zone === 'string' ? series.data.due_zone : this.zone())
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
