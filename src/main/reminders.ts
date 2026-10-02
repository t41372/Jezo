// A reminder before a deadline (docs/design/frontend.md, "Deadlines"). It comes
// from a todo's `due` itself, so editing, finishing or dropping the todo changes
// or cancels it: a day deadline at 18:00 the day before, a time deadline three
// hours before, or at 21:00 the evening before when that would be in the night.
// One reminder, not a countdown.

import { readFileSync } from 'node:fs'
import { Notification, powerMonitor } from 'electron'
import type { Item } from '../shared/workspace'
import { deadlineEnd, readTime, type Zone } from '../shared/time'
import { writeAtomic } from './workspace/files'
import type { Workspace } from './workspace/workspace'

/** How long before a time deadline it comes. */
const BEFORE_TIME_MS = 3 * 60 * 60_000
/** The clock, the day before, a day deadline's reminder comes at. */
const DAY_BEFORE_HOUR = 18
/** A reminder that would come in the night (22:00 to 08:00) comes at 21:00 the evening before. */
const NIGHT_FROM = 22
const NIGHT_UNTIL = 8
const EVENING = 21

/**
 * What's known about each todo's deadline: the deadline as written, when Jezo
 * first saw it, and whether that one was reminded. A moved deadline is a new
 * one, which reminds again.
 */
type Seen = Record<string, { due: string; seen: number; sent?: number; said?: string }>

export interface ReminderHost {
  zone(): Zone
  language(): string
  enabled(): boolean
  /** Brings the todo forward in 待辦; null opens 待辦 itself. */
  open(todo: string | null): void
  /** Whether to put the notification on the screen; the E2E tests' background mode only records it. */
  show: boolean
}

export class Reminders {
  private seen: Seen = {}
  private timer: NodeJS.Timeout | undefined

  constructor(
    private workspace: Workspace,
    private file: string,
    private host: ReminderHost,
  ) {}

  start() {
    try {
      this.seen = JSON.parse(readFileSync(this.file, 'utf8'))
    } catch {
      // Nothing yet, or unreadable: deadlines are seen from now.
    }
    void this.check()
    this.timer = setInterval(() => void this.check(), 60_000)
    // Coming back from sleep, files may have changed meanwhile: read them again first.
    powerMonitor.on('resume', () => void this.workspace.rescan().then(() => this.check()))
    this.workspace.onChange(() => void this.check())
  }

  stop() {
    clearInterval(this.timer)
  }

  /**
   * When a deadline's reminder is due: 18:00 the day before for a day, three
   * hours before for a time, in the device's zone. Null when it isn't one.
   */
  static remindAt(due: unknown, zone: Zone): { at: number; end: number; day: boolean } | null {
    const value = readTime(due, 'deadline')
    if (!value) return null
    const end = deadlineEnd(value, zone)
    if (value.kind === 'day') {
      const at = value.date.subtract({ days: 1 }).toZonedDateTime({ timeZone: zone, plainTime: { hour: DAY_BEFORE_HOUR } }).epochMilliseconds
      return { at, end, day: true }
    }
    let at = Temporal.Instant.fromEpochMilliseconds(end - BEFORE_TIME_MS).toZonedDateTimeISO(zone)
    if (at.hour >= NIGHT_FROM || at.hour < NIGHT_UNTIL) {
      const evening = at.hour < NIGHT_UNTIL ? at.toPlainDate().subtract({ days: 1 }) : at.toPlainDate()
      at = evening.toZonedDateTime({ timeZone: zone, plainTime: { hour: EVENING } })
    }
    return { at: at.epochMilliseconds, end, day: false }
  }

  /**
   * Sends what's due: a reminder whose time has come for a deadline still
   * ahead, open or a draft, and seen before its reminder time. A deadline set
   * after that (due tomorrow, set at 20:00) isn't reminded: the user just said
   * it. A repeating todo's time is different, since the app wrote it and nobody
   * said anything: a daily one is written on its own day, after 18:00 the day
   * before, and is reminded when it's first seen, or at 08:00 if that's in the
   * night. Missed while the computer slept, a reminder comes now; once the
   * deadline is past it doesn't come at all, since the list shows that.
   */
  async check(now = Date.now()) {
    const zone = this.host.zone()
    const todos = this.workspace.list().filter((i) => i.kind === 'todo' && !i.problems?.length)
    let changed = false
    const next: Seen = {}
    const ready: { item: Item; end: number; day: boolean }[] = []
    for (const item of todos) {
      const due = typeof item.data.due === 'string' ? item.data.due : null
      if (!due) continue
      const known = this.seen[item.id]
      const entry = known?.due === due ? known : { due, seen: now }
      if (entry !== known) changed = true
      next[item.id] = entry
      const open = item.data.state === 'open' || item.data.state === 'draft'
      const when = Reminders.remindAt(due, zone)
      if (!open || !when || entry.sent || !this.host.enabled()) continue
      if (now < when.at || now >= when.end) continue
      if (entry.seen > when.at) {
        if (typeof item.data.series !== 'string') continue
        const hour = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).hour
        if (hour >= NIGHT_FROM || hour < NIGHT_UNTIL) continue
      }
      entry.sent = now
      changed = true
      ready.push({ item, end: when.end, day: when.day })
    }
    if (ready.length) {
      const said = this.notify(ready, zone, now)
      for (const { item } of ready) next[item.id].said = said
    }
    if (Object.keys(this.seen).some((id) => !next[id])) changed = true
    this.seen = next
    if (changed) await writeAtomic(this.file, JSON.stringify(this.seen, null, 2))
  }

  /**
   * One notification: for one deadline, what and when, said from now (waking on
   * the day itself, 「今天截止」, not 「明天」); for several, one line for all of
   * them, like the automations' catch-up. Clicking opens the todo, or 待辦.
   */
  private notify(due: { item: Item; end: number; day: boolean }[], zone: Zone, now: number) {
    const zh = this.host.language().startsWith('zh')
    const today = Temporal.Instant.fromEpochMilliseconds(now).toZonedDateTimeISO(zone).toPlainDate()
    const when = ({ end, day }: { end: number; day: boolean }) => {
      // A day deadline ends at the next midnight; its own date is the day before that.
      const at = Temporal.Instant.fromEpochMilliseconds(day ? end - 1 : end).toZonedDateTimeISO(zone)
      const which = Temporal.PlainDate.compare(at.toPlainDate(), today) === 0 ? (zh ? '今天' : 'today') : zh ? '明天' : 'tomorrow'
      const clock = at.toPlainTime().toString({ smallestUnit: 'minute' })
      if (zh) return day ? `${which}截止` : `${which} ${clock} 截止`
      return day ? `Due ${which}` : `Due ${which} at ${clock}`
    }
    const titles = due.map((d) => String(d.item.data.title))
    const body = due.length === 1
      ? `${when(due[0])}：${titles[0]}`.replace('：', zh ? '：' : ': ')
      : zh ? `${due.length} 件快截止了：${titles.join('、')}` : `${due.length} deadlines coming up: ${titles.join(', ')}`
    if (this.host.show && Notification.isSupported()) {
      const notification = new Notification({ title: 'Jezo', body })
      notification.on('click', () => this.host.open(due.length === 1 ? due[0].item.id : null))
      notification.show()
    }
    return body
  }
}
