// Automations: sessions Jezo starts on its own at set times, like planning the
// morning (docs/design/backend.md, "Automations"). Each is a file in the
// workspace's automations/items/, with a cron schedule, and its body is what
// the agent is asked. The agent can add and change them like any other file.
//
// The computer is often asleep or off when one is due, so each check works out
// what was missed and runs it once, while that's still useful
// (docs/design/automations.md): one pending run per automation, a catch-up
// window in plain words, a history in the workspace, one run at a time.

import { Cron } from 'croner'
import { BrowserWindow, Notification, powerMonitor } from 'electron'
import { inBackground } from '../env'
import type { AutomationHistoryView, AutomationRow, Schedule as ScheduleTimes } from '../../shared/bridge'
import type { Trigger } from '../../shared/session'
import { now, stamp, type Zone } from '../../shared/time'
import type { Item } from '../../shared/workspace'
import { deviceZone } from '../clock'
import { newId } from '../workspace/files'
import type { Workspace } from '../workspace/workspace'
import { parseCatchUp, type CatchUp } from '../../shared/catch-up'
import { AutomationHistory, summarize, type HistoryEvent, type HistoryProblem, type Slot } from './history'
import type { AgentHost, Outcome } from './host'
import type { Providers } from './providers'

/** A run picked up this soon after it was due is on time, whatever its window says: the check runs every 30 seconds. */
const ON_TIME_MS = 2 * 60_000
/** When a model can't be reached, the next tries come after these many minutes, then every 15. */
const RETRY_MINUTES = [1, 5, 15]

interface AutomationData {
  name: string
  schedule: string
  state: string
  catch_up?: string
  zone?: string
  trigger?: Trigger
}

/** The schedule's runs, in its zone. A schedule that doesn't parse never runs; the manifest check shows it. */
function cron(schedule: string, zone: Zone) {
  try {
    return new Cron(schedule, { paused: true, timezone: zone })
  } catch {
    return null
  }
}

/** The latest moment a run due at `due` may start: the window, and never past the next run. */
export function latestStart(catchUp: CatchUp, due: Temporal.ZonedDateTime, next: Temporal.Instant | null): Temporal.Instant {
  const day = due.toPlainDate()
  const at = (() => {
    switch (catchUp.kind) {
      case 'no':
        return due.toInstant()
      case 'for':
        return due.toInstant().add({ minutes: catchUp.minutes })
      case 'until': {
        // That clock after the due time: on its date, or the next day's for an evening run "until 02:00".
        // The date moves, then the clock is placed, so a clock in a gap shifts the way every time does.
        const on = (date: Temporal.PlainDate) => date.toZonedDateTime({ timeZone: due.timeZoneId, plainTime: { hour: catchUp.hour, minute: catchUp.minute } }).toInstant()
        return Temporal.Instant.compare(on(day), due.toInstant()) > 0 ? on(day) : on(day.add({ days: 1 }))
      }
      case 'end-of-day':
        return day.add({ days: 1 }).toZonedDateTime(due.timeZoneId).toInstant()
      case 'next':
        return next ?? due.toInstant().add({ hours: 24 * 366 })
    }
  })()
  return next && Temporal.Instant.compare(next, at) < 0 ? next : at
}

/** At most this many earlier times are listed one by one; past it, the note says "more than". */
const MAX_MISSED = 500

/**
 * The schedule's latest run at or before `at`. Croner looks at whole seconds and
 * leaves out the reference itself, so a check at 08:00:00.000 is asked about 08:00:01.
 */
function latestRun(runs: Cron, at: Temporal.Instant): Date | undefined {
  const run = runs.previousRuns(1, new Date(at.epochMilliseconds + 1000))[0]
  return run && run.getTime() <= at.epochMilliseconds ? run : runs.previousRuns(1, new Date(at.epochMilliseconds))[0]
}

/** A due moment's slot: its date and clock in the schedule's zone. */
const slotOf = (due: Temporal.ZonedDateTime): Slot => due.toPlainDateTime().toString({ smallestUnit: 'minute' })

/** A run that's going or about to start. */
interface Run {
  /** Its conversation, once it exists. */
  session: Promise<string>
  id: string | null
  started(id: string): void
  cancel(error?: unknown): void
}

interface Due {
  item: Item
  data: AutomationData
  zone: Zone
  slot: Slot
  due: Temporal.ZonedDateTime
  latest: Temporal.Instant
  /** When a check found it: on time or late is decided then, however long it waits behind another run. */
  found: Temporal.Instant
  late: boolean
  /** Earlier times that weren't run, and their range, for the note before the request. */
  missed: { count: number; more: boolean; first?: Slot; last?: Slot }
  /** The zone the last check saw differs from this one: times in the gap weren't worked out. */
  moved?: Zone
}

export class Schedule {
  private timer: NodeJS.Timeout | null = null
  private launchTimer: NodeJS.Timeout | null = null
  private stopped = false
  private history: AutomationHistory
  /** One check at a time, whatever asked for it: launch, waking, unlocking, focus, the tick. A check never waits for a run. */
  private checking: Promise<void> = Promise.resolve()
  /** Times found due and not started yet, one per automation: the worker starts them one at a time. */
  private pending = new Map<string, Due>()
  /** The worker, while it's going. */
  private working: Promise<void> | null = null
  /**
   * Automations with a run going or about to start, and its conversation once there
   * is one. Taken before anything is awaited, so two starts can't both get through.
   */
  private running = new Map<string, Run>()
  /** Automations seen off, so turning one on again starts watching from then. */
  private seenOff = new Set<string>()
  /** The automations there when Jezo started: their latest time may still be due. One added since starts fresh. */
  private atLaunch = new Set<string>()
  private historyListeners = new Set<(id: string) => void>()

  constructor(
    private workspace: Workspace,
    private host: AgentHost,
    private providers: Providers,
    private openSession: (id: string) => void,
  ) {
    this.history = new AutomationHistory(workspace, (id) => {
      for (const listener of this.historyListeners) listener(id)
    })
  }

  /** Called when an automation's history gets an event. */
  onHistory(listener: (id: string) => void) {
    this.historyListeners.add(listener)
    return () => this.historyListeners.delete(listener)
  }

  async start() {
    this.atLaunch = new Set(this.automations().map((i) => i.id))
    // Turned off and on again between two checks is still a pause.
    this.workspace.onChange(({ changed }) => {
      for (const item of changed) if (item.kind === 'automation' && item.data.state !== 'on') this.seenOff.add(item.id)
    })
    // Retrying a run that couldn't reach its model, in its conversation, takes its time back first.
    this.host.beforeRetry((session) => this.resume(session))
    // A run ending frees the worker, and a chat ending lets waiting background work start.
    this.host.onFinished((session, automation, outcome) => {
      if (automation && outcome) void this.endResumed(automation.id, session, outcome)
      this.work()
    })
    await this.endInterrupted()
    this.timer = setInterval(() => void this.check(), 30_000)
    // File events can be missed while asleep, so waking up reads the workspace again first.
    powerMonitor.on('resume', () => void this.check({ rescan: true }))
    powerMonitor.on('unlock-screen', () => void this.check({ rescan: true }))
    // Right after launch, catch up on what was missed while Jezo was closed.
    this.launchTimer = setTimeout(() => void this.check(), 10_000)
  }

  /** Quitting: nothing new starts. */
  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    if (this.launchTimer) clearTimeout(this.launchTimer)
  }

  private automations() {
    return this.workspace.list().filter((i) => i.kind === 'automation' && !i.problems?.length)
  }

  /** Runs that were going when Jezo quit or crashed. They aren't run again: they may already have changed files. */
  private async endInterrupted() {
    for (const item of this.automations()) {
      const { events, problems } = await this.history.read(item.id)
      if (problems.length) continue
      for (const claim of summarize(events).unfinished) {
        await this.history.append(item.id, { type: 'ended', attempt: claim.attempt, outcome: 'interrupted', at: stamp(deviceZone()) })
      }
    }
  }

  /**
   * Looks at every automation and notes what's due, then lets the worker start
   * it. `rescan` reads the workspace's files again first. A check is short: it
   * never waits for a run, so a time that comes due during one is seen on time.
   */
  check(options: { rescan?: boolean } = {}) {
    this.checking = this.checking.then(() => this.checkNow(options)).catch((error) => console.error('Checking automations failed:', error))
    return this.checking
  }

  private async checkNow({ rescan = false }: { rescan?: boolean }) {
    if (this.stopped) return
    if (rescan) await this.workspace.rescan()
    for (const item of this.automations()) {
      if (this.running.has(item.id)) continue
      try {
        const queued = this.pending.get(item.id)
        const found = await this.dueNow(item, { found: queued })
        if (found) this.pending.set(item.id, found)
        else this.pending.delete(item.id)
      } catch (error) {
        console.error(`Checking ${item.id} failed:`, error)
      }
    }
    this.work()
  }

  /**
   * Starts pending times one at a time, the oldest due first: Sunday's review
   * before Monday's morning plan, which can then use it. Background work waits
   * while the user is chatting. Late runs started together share one notification.
   */
  private work() {
    if (this.working || this.stopped) return
    this.working = (async () => {
      const batch: { attempt: string; name: string; session: string; outcome: Outcome; id: string }[] = []
      while (!this.stopped && this.pending.size && !this.host.userBusy()) {
        const next = [...this.pending.values()].sort((a, b) => Temporal.ZonedDateTime.compare(a.due, b.due) || Temporal.Instant.compare(a.latest, b.latest))[0]
        this.pending.delete(next.item.id)
        if (!this.reserve(next.item.id)) continue
        try {
          const ran = await this.runDue(next)
          if (ran?.late) batch.push({ ...ran, name: next.data.name, id: next.item.id })
        } catch (error) {
          console.error(`Running ${next.item.id} failed:`, error)
        } finally {
          this.release(next.item.id)
        }
      }
      // None when nothing is waiting for the user.
      const ready = batch.filter((b) => b.outcome === 'completed' || b.outcome === 'waiting')
      if (ready.length && this.notify(ready[0].session, ready.length === 1 ? ready[0].name : null, ready.length)) {
        await this.history.append(ready[0].id, { type: 'notified', attempts: ready.map((r) => r.attempt), at: stamp(deviceZone()) })
      }
    })().finally(() => {
      this.working = null
      // Found while the last one ran.
      if (this.pending.size && !this.host.userBusy()) this.work()
    })
  }

  /** Takes an automation for one run. False when one is going or starting. */
  private reserve(id: string) {
    if (this.running.has(id)) return false
    let started!: (session: string) => void
    let cancel!: (error?: unknown) => void
    const session = new Promise<string>((resolve, reject) => {
      started = resolve
      cancel = (error) => reject(error ?? new Error("It didn't start."))
    })
    session.catch(() => undefined)
    const run: Run = { session, id: null, started: (id) => ((run.id = id), started(id)), cancel }
    this.running.set(id, run)
    return true
  }

  /** Ends a reservation. A run that never got a conversation says why. */
  private release(id: string, error?: unknown) {
    this.running.get(id)?.cancel(error)
    this.running.delete(id)
  }

  /**
   * Before the user retries an automation's conversation: if its attempt couldn't
   * reach the model, its time was given back, so it's taken again first, or the
   * scheduler could start the same time beside it.
   */
  private async resume(session: string) {
    for (const item of this.automations()) {
      const { events } = await this.history.read(item.id)
      const claim = events.find((e) => e.type === 'claimed' && e.session === session)
      if (claim?.type !== 'claimed') continue
      if (summarize(events).ended.get(claim.attempt)?.outcome !== 'unreachable') return
      if (!this.reserve(item.id)) throw new Error(`${String(item.data.name)} is already running.`)
      this.running.get(item.id)!.started(session)
      this.pending.delete(item.id)
      await this.history.append(item.id, { type: 'resumed', attempt: claim.attempt, at: stamp(deviceZone()) })
      return
    }
  }

  /** A resumed attempt's conversation ended: so does the attempt. One the scheduler started ends in attempt(). */
  private async endResumed(id: string, session: string, outcome: Outcome) {
    if (this.attempts.has(session) || this.running.get(id)?.id !== session) return
    this.release(id)
    const { events } = await this.history.read(id)
    const claim = events.find((e) => e.type === 'claimed' && e.session === session)
    if (claim?.type === 'claimed' && !summarize(events).ended.has(claim.attempt)) {
      await this.history.append(id, { type: 'ended', attempt: claim.attempt, outcome, at: stamp(deviceZone()) })
    }
  }

  /** Conversations the scheduler started and is waiting on. */
  private attempts = new Set<string>()

  /**
   * The automation's most recent time, if it should run now; records times that
   * pass without a run. `manual` is Run now, which takes a time that's waiting
   * for a model whenever the user presses it, not when the next retry is due.
   * `found` is the same time as an earlier check found it: on time or late is
   * decided when it was first found, however long it then waits. A newer time
   * that replaced it is found now.
   */
  private async dueNow(item: Item, { manual = false, found }: { manual?: boolean; found?: Due } = {}): Promise<Due | null> {
    const data = item.data as unknown as AutomationData
    if (data.state !== 'on') {
      this.seenOff.add(item.id)
      return null
    }
    const zone = data.zone && data.zone !== 'local' ? data.zone : deviceZone()
    const at = now()
    const { events, problems } = await this.history.read(item.id)
    // A history that can't be fully read doesn't say what ran: no time starts on its own until it's fixed.
    if (problems.length) return null
    let summary = summarize(events)
    const runs = cron(data.schedule, zone)
    if (!runs) return null
    // Turned on again: the pause wasn't downtime, so nothing from it is caught up.
    // Added while Jezo runs: a schedule made at 15:00 for 08:00 hasn't missed today's 08:00.
    if (this.seenOff.has(item.id) || (!summary.watching && !this.atLaunch.has(item.id))) {
      this.seenOff.delete(item.id)
      await this.history.append(item.id, { type: 'watching', at: stamp(zone, at), zone })
      return null
    }
    // Never watched before, but there when Jezo started: its latest time may still be due, and nothing before it is counted.
    if (!summary.watching) {
      const latest = latestRun(runs, at)
      await this.history.append(item.id, { type: 'watching', at: stamp(zone, latest ? latest.getTime() : at), zone })
      summary = summarize((await this.history.read(item.id)).events)
    }
    const previous = latestRun(runs, at)
    if (!previous) return null
    const due = Temporal.Instant.fromEpochMilliseconds(previous.getTime()).toZonedDateTimeISO(zone)
    const watchingAt = Temporal.Instant.from(summary.watching!.at)
    if (Temporal.Instant.compare(due.toInstant(), watchingAt) < 0) return null
    const slot = slotOf(due)
    // The same slot never runs twice: crossing between Arizona and California, or flying west into the same date.
    if (summary.claimed.has(slot) || summary.skippedByUser.has(slot)) return null
    let catchUp: CatchUp
    try {
      catchUp = parseCatchUp(data)
    } catch {
      return null
    }
    const nextRun = runs.nextRun(new Date(due.epochMilliseconds))
    const latest = latestStart(catchUp, due, nextRun ? Temporal.Instant.fromEpochMilliseconds(nextRun.getTime()) : null)
    // Picked up within two minutes, it's on time whatever its window, even if it then waits behind another run.
    const pickedUp = found?.slot === slot ? found.found : at
    const late = pickedUp.epochMilliseconds - due.epochMilliseconds > ON_TIME_MS
    // A zone change is recorded, so a relaunch doesn't announce the same move again.
    const previousZone = summary.zone
    if (previousZone !== zone) await this.history.append(item.id, { type: 'zone', zone, at: stamp(zone, at) })

    // Earlier times since the last run (or since watching began, that one included) that weren't run.
    // Listed up to the time due now, never further; a claimed one isn't missed. A run from before
    // watching began again, after a pause, doesn't count the pause.
    const sinceRun = summary.lastClaim?.due && Temporal.Instant.compare(Temporal.Instant.from(summary.lastClaim.due), watchingAt) >= 0
    const from = sinceRun ? Temporal.Instant.from(summary.lastClaim!.due!) : watchingAt
    const missed: Slot[] = []
    let more = false
    for (let cursor = new Date(from.epochMilliseconds - (sinceRun ? 0 : 1000)); ; ) {
      const next = runs.nextRun(cursor)
      if (!next || next.getTime() >= due.epochMilliseconds) break
      cursor = next
      const s = slotOf(Temporal.Instant.fromEpochMilliseconds(next.getTime()).toZonedDateTimeISO(zone))
      if (summary.claimed.has(s)) continue
      if (missed.length === MAX_MISSED) {
        more = true
        break
      }
      missed.push(s)
    }
    const fresh = missed.filter((m) => !summary.skipped.has(m))
    if (fresh.length) {
      await this.history.append(item.id, { type: 'skipped', slots: fresh, count: fresh.length, reason: previousZone !== zone ? 'zone-changed' : 'replaced', at: stamp(zone, at) })
      summary = summarize((await this.history.read(item.id)).events)
    }

    if (late && Temporal.Instant.compare(at, latest) >= 0) {
      if (!summary.skipped.has(slot)) await this.history.append(item.id, { type: 'skipped', slots: [slot], count: 1, reason: 'expired', at: stamp(zone, at) })
      return null
    }
    // A model that couldn't be reached is tried again after a while, not every 30 seconds.
    const retries = summary.retries(slot)
    if (retries && !manual) {
      const last = [...events].reverse().find((e) => e.type === 'retry' && e.slot === slot)!
      const wait = RETRY_MINUTES[Math.min(retries - 1, RETRY_MINUTES.length - 1)]
      if (at.epochMilliseconds - Temporal.Instant.from(last.at).epochMilliseconds < wait * 60_000) return null
    }
    return {
      item, data, zone, slot, due, latest, late, found: pickedUp,
      missed: { count: missed.length, more, first: missed[0], last: missed.at(-1) },
      ...(previousZone !== zone && { moved: previousZone }),
    }
  }

  /**
   * Runs a pending time, with the automation already reserved. It's looked at
   * again right before starting, from the file as it is now: a late run queued at
   * 17:59 doesn't start at 18:02, and one turned off meanwhile doesn't start.
   */
  private async runDue(queued: Due) {
    const item = this.workspace.get(queued.item.id)
    const d = item?.kind === 'automation' && !item.problems?.length ? await this.dueNow(item, { found: queued }) : null
    if (!d) return null
    // Without a model it would only record a failure every time; it waits, and the window keeps it.
    // A local server that wasn't running a moment ago may be now.
    if (!this.providers.model('background')) await this.providers.refreshServers()
    if (!this.providers.model('background')) {
      await this.history.append(d.item.id, { type: 'retry', slot: d.slot, at: stamp(d.zone) })
      return null
    }
    const ran = await this.attempt(d.item, d.data, { slot: d.slot, due: d.due, late: d.late, note: await this.note(d) })
    return { ...ran, late: d.late }
  }

  /**
   * One run, claimed first and ended in the history however it goes. The caller
   * has reserved the automation. The claim names the conversation, which exists
   * before anything is asked of the model.
   */
  private async attempt(item: Item, data: AutomationData, scheduled?: { slot: Slot; due: Temporal.ZonedDateTime; late: boolean; note: string }) {
    const attempt = newId('at')
    const zone = deviceZone()
    const { id: session, done } = await this.host.startAutomation({
      id: item.id, name: data.name, trigger: data.trigger, request: item.body.trim(), note: scheduled?.note,
      claim: (session) => this.history.append(item.id, {
        type: 'claimed', attempt, origin: scheduled ? 'scheduled' : 'manual', session, at: stamp(zone),
        ...(scheduled && { slot: scheduled.slot, due: stamp(scheduled.due.timeZoneId, scheduled.due.toInstant()), late: scheduled.late }),
      }),
    })
    this.attempts.add(session)
    this.running.get(item.id)?.started(session)
    try {
      const outcome = await done
      await this.history.append(item.id, { type: 'ended', attempt, outcome, at: stamp(zone) })
      if (outcome === 'unreachable' && scheduled) await this.history.append(item.id, { type: 'retry', slot: scheduled.slot, at: stamp(zone) })
      // On time, it says so itself; late runs started together share one notification.
      if (scheduled && !scheduled.late && (outcome === 'completed' || outcome === 'waiting')) this.notify(session, data.name, 1)
      return { attempt, session, outcome }
    } finally {
      this.attempts.delete(session)
    }
  }

  /**
   * What the run is told before its request (docs/design/automations.md, "What the
   * run is told"). Every fact is worked out here, so the model never subtracts
   * times or converts zones.
   */
  private async note(d: Due) {
    const at = now().toZonedDateTimeISO(d.zone)
    const summary = summarize((await this.history.read(d.item.id)).events)
    const day = (z: Temporal.ZonedDateTime | Temporal.PlainDateTime) => `${z.toPlainDate().toLocaleString('en-US', { weekday: 'short' })} ${z.toPlainDate()}`
    const clock = (z: Temporal.ZonedDateTime | Temporal.PlainDateTime) => `${String(z.hour).padStart(2, '0')}:${String(z.minute).padStart(2, '0')}`
    const lateBy = Math.round((at.epochMilliseconds - d.due.epochMilliseconds) / 60_000)
    const lateText = lateBy >= 60 ? `${Math.floor(lateBy / 60)} hours${lateBy % 60 ? ` ${lateBy % 60} minutes` : ''}` : `${lateBy} minutes`
    const latest = d.latest.toZonedDateTimeISO(d.zone)
    const slot = (s: Slot) => Temporal.PlainDateTime.from(s)
    const lines = [
      `This run: ${d.data.name} for ${day(d.due)}, due at ${clock(d.due)}${d.data.zone ? ` ${d.zone}` : ''}. ${d.late ? `It started ${lateText} late; it could start until ${latest.toPlainDate().equals(d.due.toPlainDate()) ? clock(latest) : `${day(latest)} ${clock(latest)}`}.` : 'It started on time.'}`,
      ...(d.moved ? [`The device moved from ${d.moved} to ${d.zone} since the last check, so earlier times weren't worked out.`] : []),
      ...(d.missed.count ? [`Not run: ${d.missed.more ? 'more than ' : ''}${d.missed.count} earlier time${d.missed.count > 1 ? 's' : ''}, ${day(slot(d.missed.first!))}${d.missed.count > 1 ? ` to ${day(slot(d.missed.last!))}` : ''}. They won't be run; this one is for now.`] : []),
      summary.lastFinished ? `The last one that finished was claimed ${summary.lastFinished.at.replace('T', ' ').slice(0, 16)}.` : 'None has finished before.',
      summary.interrupted.length ? `Interrupted runs: ${summary.interrupted.map((c) => c.at.replace('T', ' ').slice(0, 16)).join(', ')}. They weren't run again; check what they changed before repeating it.` : 'Interrupted runs: none.',
      `History: automations/history/${d.item.id}.jsonl.`,
    ]
    return lines.join('\n')
  }

  /**
   * Runs an automation now, from its page in 更多, whatever its schedule. Takes a
   * time that's waiting, if one is; with a run going, gives that one's
   * conversation. Returns the conversation.
   */
  async run(id: string) {
    const item = this.workspace.get(id)
    if (!item || item.kind !== 'automation') throw new Error(`There is no automation ${id}.`)
    if (!this.reserve(id)) return this.running.get(id)!.session
    const { session } = this.running.get(id)!
    const data = item.data as unknown as AutomationData
    this.pending.delete(id)
    void (async () => {
      // A time that's due and not yet run is taken by this run; otherwise it's a run of its own, and 08:00 still comes.
      const found = await this.dueNow(item, { manual: true })
      await this.attempt(item, data, found ? { slot: found.slot, due: found.due, late: found.late, note: await this.note(found) } : undefined)
    })().then(() => this.release(id), (error) => {
      console.error(error)
      this.release(id, error)
    })
    // The conversation's id is known as soon as it starts; the run goes on after this returns.
    return session
  }

  /** Skips the time that's due or waiting for a model, from the automation's page. The next time comes as usual. */
  async skip(id: string) {
    const item = this.workspace.get(id)
    if (!item || item.kind !== 'automation' || this.running.has(id)) return
    const due = await this.dueNow(item, { manual: true })
    this.pending.delete(id)
    if (due) await this.history.append(id, { type: 'skipped', slots: [due.slot], count: 1, reason: 'skipped', at: stamp(due.zone) })
  }

  /** Every automation history that can't be fully read, for 有問題的檔案. */
  async problems(): Promise<HistoryProblem[]> {
    const all = await Promise.all(this.automations().map(async (i) => (await this.history.read(i.id)).problems))
    return all.flat()
  }

  /**
   * What happened to an automation's times, newest first, for its page in 更多
   * (docs/design/automations.md, "What the GUI shows"): one row per time or run.
   */
  async rows(id: string): Promise<AutomationHistoryView> {
    const { events, problems } = await this.history.read(id)
    const summary = summarize(events)
    const ended = summary.ended
    const rows: AutomationRow[] = []
    let zone: string | undefined
    for (const e of events) {
      if (e.type === 'watching' || e.type === 'zone') zone = e.zone
      if (e.type === 'claimed') {
        const end = ended.get(e.attempt)
        const running = !!e.session && this.running.get(id)?.id === e.session
        rows.push({
          kind: 'run', at: e.at, ...(e.slot && { slot: e.slot, zone }), late: !!e.late, manual: e.origin === 'manual',
          ...(e.session && { session: e.session }), outcome: end?.outcome ?? (running ? 'running' : 'interrupted'),
        })
      }
      if (e.type === 'skipped') rows.push({ kind: 'skipped', at: e.at, slots: e.slots, reason: e.reason })
      // Waiting for a model: only while that time can still run.
      if (e.type === 'retry' && !summary.claimed.has(e.slot) && !summary.skipped.has(e.slot) && !rows.some((r) => r.kind === 'waiting' && r.slot === e.slot)) rows.push({ kind: 'waiting', at: e.at, slot: e.slot })
    }
    return { rows: rows.reverse().slice(0, 20), problems }
  }

  /** Says the runs are ready. Clicking it opens the conversation. */
  private notify(session: string, name: string | null, count: number) {
    // In front, the results are in the app already.
    if (!Notification.isSupported() || BrowserWindow.getFocusedWindow()) return false
    // The E2E tests' background mode keeps it off the screen; it's still recorded as sent.
    if (inBackground) return true
    const body = language === 'zh-TW'
      ? (name ? `「${name}」好了，看一下再決定。` : `Jezo 補做了 ${count} 件事，看一下再決定。`)
      : language === 'zh-CN'
        ? (name ? `「${name}」好了，看一下再决定。` : `Jezo 补做了 ${count} 件事，看一下再决定。`)
        : (name ? `“${name}” is ready for you to look at.` : `Jezo caught up on ${count} things for you to look at.`)
    const notification = new Notification({ title: 'Jezo', body })
    notification.on('click', () => this.openSession(session))
    notification.show()
    return true
  }

  // ─── The morning and evening rows in 設定 ───
  // They edit the two built-in automations' times. Other automations are managed in their files.

  times(): ScheduleTimes {
    const time = (id: string) => {
      const item = this.workspace.get(id)
      if (!item || item.data.state !== 'on') return null
      const [minute, hour] = String(item.data.schedule).split(' ')
      return /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : null
    }
    return { morning: time('a-morning'), evening: time('a-evening') }
  }

  async setTimes(change: Partial<ScheduleTimes>) {
    for (const [kind, value] of Object.entries(change) as [keyof ScheduleTimes, string | null][]) {
      const item: Item | undefined = this.workspace.get(`a-${kind}`)
      if (!item) continue
      if (value === null) {
        await this.workspace.update(item.id, { state: 'off' }, { by: 'user' })
      } else {
        const [hour, minute] = value.split(':').map(Number)
        const rest = String(item.data.schedule).split(' ').slice(2).join(' ') || '* * *'
        await this.workspace.update(item.id, { state: 'on', schedule: `${minute} ${hour} ${rest}` }, { by: 'user' })
      }
    }
    return this.times()
  }
}

let language = 'en'
/** The windows tell the main process which language the app is in, for notifications. */
export const setLanguage = (value: string) => {
  language = value
}
export const appLanguage = () => language

export type { HistoryEvent }

