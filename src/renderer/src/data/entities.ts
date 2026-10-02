// Turns workspace items into the entities the UI draws, and UI changes back into
// fields to write. The file formats are in docs/design/backend.md.

import { dateOf, deadlineEnd, epochOf, formatTime, moveTo, place, readTime, resolve, stamp, todayIn, type TimeValue, type Zone } from '../../../shared/time'
import type { Fields, Item } from '../../../shared/workspace'
import type { Experiment, Goal, ISODate, Memory, Note, Repeat, SlotInput, Todo } from './types'

// ─── Times ───
// On disk a time is one string of the kinds in docs/design/time.md, read and
// written only through the time module. The UI keeps a date and hours from
// midnight, as seen from the device's zone.

const pad = (n: number) => String(n).padStart(2, '0')

/** A date and hours from midnight → "2026-09-29T09:30", a local time. */
export function writeLocal(date: ISODate, hours: number) {
  const minutes = Math.round(hours * 60)
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

/** A value as the UI draws it: its date and hours from midnight in `zone`. */
function where(value: TimeValue | null, zone: Zone): { date: ISODate; hours: number } | null {
  if (!value || value.kind === 'day') return null
  const at = resolve(value, zone)!.at
  return { date: at.toPlainDate().toString(), hours: at.hour + at.minute / 60 }
}

/** Today's date in `zone`. */
export const localDate = (zone: Zone) => todayIn(zone).toString()

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

// ─── Todos ───

/** A deadline, seen from `zone`. A day is past once it ends there; a time, at its moment. */
export function toDue(text: unknown, zone: Zone): Todo['due'] {
  const value = readTime(text, 'deadline')
  if (!value) return undefined
  const at = deadlineEnd(value, zone)
  if (value.kind === 'day') return { date: value.date.toString(), at }
  const here = Temporal.Instant.fromEpochMilliseconds(at).toZonedDateTimeISO(zone)
  return { date: here.toPlainDate().toString(), time: here.hour + here.minute / 60, at, ...(value.kind === 'zoned' && { zone: value.zone }) }
}

export function toTodo(item: Item, zone: Zone): Todo {
  const d = item.data
  const started = readTime(d.started, 'record')
  const completed = readTime(d.completed, 'record')
  const startedAt = epochOf(started, zone)
  const completedAt = epochOf(completed, zone)
  const dropped = readTime(d.dropped, 'record')
  return {
    id: item.id,
    title: str(d.title) ?? '',
    notes: item.body,
    path: item.path,
    goalId: str(d.goal) ?? null,
    state: d.state === 'draft' || d.state === 'done' || d.state === 'dropped' ? d.state : 'open',
    cue: str(d.cue),
    estimateMinutes: typeof d.estimate === 'number' ? d.estimate : 30,
    slot: toSlot(d.scheduled, zone, d.proposed === true),
    subtasks: Array.isArray(d.steps) ? (d.steps as { text: string; done: boolean }[]) : undefined,
    why: str(d.why),
    startedAt,
    rank: str(d.rank),
    amount: typeof d.amount === 'number' ? d.amount : undefined,
    completedAt,
    droppedAt: epochOf(dropped, zone),
    due: toDue(d.due, zone),
    series: str(d.series),
    occurrence: str(d.occurrence),
    elapsedMinutes: startedAt !== undefined && completedAt !== undefined ? Math.round((completedAt - startedAt) / 60_000) : undefined,
    times: { scheduled: str(d.scheduled), started: str(d.started), completed: str(d.completed), dropped: str(d.dropped), due: str(d.due) },
    links: item.links,
  }
}

/** A todo's `scheduled` as the UI draws it: its moment, and its date and hours in `zone`. */
export function toSlot(scheduled: unknown, zone: Zone, proposed = false): Todo['slot'] {
  const value = readTime(scheduled)
  const shown = where(value, zone)
  if (!shown || (value?.kind !== 'zoned' && value?.kind !== 'moment')) return null
  return {
    date: shown.date,
    start: shown.hours,
    at: epochOf(value, zone)!,
    kind: value.kind,
    ...(value.kind === 'zoned' && { zone: value.zone }),
    ...(proposed && { proposed: true }),
  }
}

/**
 * Where a change in the GUI happens: the zone its clock is read in (the
 * calendar's, which may be showing another zone), and the device's zone, which
 * records are stamped in (docs/design/time.md).
 */
export interface TimeContext {
  zone: Zone
  device: Zone
}

/**
 * The fields to write for a change to a todo. Fields a change clears are null.
 * A moved time keeps its kind: a time fixed to New York stays in New York.
 */
export function todoFields(change: Partial<Omit<Todo, 'slot'>> & { slot?: SlotInput | null }, context: TimeContext, before?: Todo): Fields {
  const zone = context.device
  const f: Fields = {}
  if ('title' in change) f.title = change.title
  if ('goalId' in change) f.goal = change.goalId ?? null
  if ('state' in change) f.state = change.state
  if ('cue' in change) f.cue = change.cue ?? null
  if ('estimateMinutes' in change) f.estimate = change.estimateMinutes
  if ('slot' in change) {
    f.scheduled = change.slot ? slotText(change.slot, context, before?.times?.scheduled) : null
    f.proposed = change.slot?.proposed ? true : null
  }
  if ('subtasks' in change) f.steps = change.subtasks?.length ? change.subtasks : null
  if ('why' in change) f.why = change.why ?? null
  if ('startedAt' in change) f.started = change.startedAt ? recordText(change.startedAt, zone, before?.startedAt, before?.times?.started) : null
  if ('rank' in change) f.rank = change.rank ?? null
  if ('amount' in change) f.amount = change.amount ?? null
  if ('completedAt' in change) f.completed = change.completedAt ? recordText(change.completedAt, zone, before?.completedAt, before?.times?.completed) : null
  if ('droppedAt' in change) f.dropped = change.droppedAt ? recordText(change.droppedAt, zone, before?.droppedAt, before?.times?.dropped) : null
  return f
}

/** A deadline as written: the day alone, or the day and a clock fixed to `zone`. Null when the clock doesn't exist that day. */
export function dueTextFor(date: ISODate, time: number | undefined, zone: Zone): string | null {
  if (time === undefined) return date
  const placed = place(date, writeLocal(date, time).slice(11), zone)
  return placed.gap ? null : formatTime(placed.value)
}

/**
 * A slot as written. One that didn't move is written as it was, so accepting a
 * proposal changes nothing about its time. A moved time keeps its zone. A new
 * one is fixed to the zone it was placed in: the device's, or the one the
 * calendar shows, since placing it there is planning for being there.
 */
function slotText(slot: SlotInput, context: TimeContext, previous?: string) {
  const value = readTime(previous)
  const was = where(value, context.zone)
  if (value && was && was.date === slot.date && Math.round(was.hours * 60) === Math.round(slot.start * 60)) return previous!
  const clock = writeLocal(slot.date, slot.start).slice(11)
  return formatTime((value ? moveTo(value, slot.date, clock, context.zone) : place(slot.date, clock, context.zone)).value)
}

/** A record as written: unchanged when it's the same moment, so rewriting a todo doesn't restamp it in another zone. */
function recordText(at: number, zone: Zone, previousAt?: number, previous?: string) {
  return previous && previousAt === at ? previous : stamp(zone, at)
}

// ─── Goals ───

/**
 * A goal from its file and the todos that serve it. Done todos add their
 * amount to the progress, to this week's when they were done this week; a rule
 * was tried when a todo with its cue was done or scheduled before today, and it
 * worked when that todo got done.
 */
export function toGoal(item: Item, todos: Todo[], today: ISODate, zone: Zone): Goal {
  const d = item.data
  const measure = (d.measure ?? {}) as { unit?: string; total?: number; start?: number }
  // A todo the user dropped is neither progress nor a try of a rule.
  const mine = todos.filter((t) => t.goalId === item.id && t.state !== 'draft' && t.state !== 'dropped')
  const amount = (t: Todo) => t.amount ?? 1
  const done = mine.filter((t) => t.state === 'done')
  const [monday, sunday] = weekOf(today)
  const inWeek = (date: ISODate) => date >= monday && date <= sunday
  const thisWeek = (t: Todo) => !!t.slot && inWeek(t.slot.date)
  // Done this week, scheduled or not; one marked done by hand, with no time, by its slot.
  const doneThisWeek = (t: Todo) => (t.completedAt !== undefined ? inWeek(Temporal.Instant.fromEpochMilliseconds(t.completedAt).toZonedDateTimeISO(zone).toPlainDate().toString()) : thisWeek(t))
  const rules = Array.isArray(d.rules) ? (d.rules as { cue: string; action: string }[]) : []
  const proposal = d.rule_proposal as { rule: number; cue: string; action: string; why: string } | undefined
  return {
    id: item.id,
    name: str(d.name) ?? '',
    hue: typeof d.hue === 'number' ? d.hue : 255,
    state: d.state === 'paused' || d.state === 'done' ? d.state : 'active',
    why: item.body.trim() || undefined,
    due: str(d.due),
    dueNote: str(d.due_note),
    progress: { done: (measure.start ?? 0) + done.reduce((sum, t) => sum + amount(t), 0), total: measure.total ?? 1, unit: measure.unit ?? '' },
    week: {
      done: done.filter(doneThisWeek).reduce((sum, t) => sum + amount(t), 0),
      planned: mine.filter((t) => t.state === 'open' && thisWeek(t)).reduce((sum, t) => sum + amount(t), 0),
    },
    agentNote: str(d.note),
    rules: rules.map((r) => {
      const tried = mine.filter((t) => t.cue === r.cue && (t.state === 'done' || (t.slot && t.slot.date < today)))
      return { cue: r.cue, action: r.action, tries: tried.length, hits: tried.filter((t) => t.state === 'done').length }
    }),
    samples: done
      .filter((t) => t.elapsedMinutes !== undefined)
      .sort((a, b) => a.completedAt! - b.completedAt!)
      .slice(-8)
      .map((t) => ({ estimated: t.estimateMinutes, actual: t.elapsedMinutes! })),
    report: d.report as Goal['report'],
    ruleProposal: proposal && { ruleIndex: proposal.rule, cue: proposal.cue, action: proposal.action, why: proposal.why },
    links: item.links,
  }
}

/** Monday and Sunday of the week a date is in. */
export function weekOf(date: ISODate): [ISODate, ISODate] {
  const d = Temporal.PlainDate.from(date)
  const monday = d.subtract({ days: d.dayOfWeek - 1 })
  return [monday.toString(), monday.add({ days: 6 }).toString()]
}

// ─── Memory ───

/** A memory in use: replaced ones keep their files but aren't shown or used. */
export function toMemory(item: Item, zone: Zone): Memory | null {
  const d = item.data
  if (d.status === 'superseded') return null
  const evidence = Array.isArray(d.evidence) ? (d.evidence as string[]) : []
  return {
    id: item.id,
    text: item.body.trim(),
    kind: d.epistemic === 'inferred' ? 'inferred' : 'stated',
    date: (() => {
      const recorded = readTime(d.recorded, 'record')
      return recorded ? dateOf(recorded, zone).toString() : ''
    })(),
    ...(evidence.some((e) => e.startsWith('notes/')) && { via: 'notes' as const }),
    ...(d.epistemic === 'inferred' && { evidence: evidence.length, confidence: d.confidence as Memory['confidence'] }),
    record: { ...d, text: item.body.trim() },
  }
}

// ─── Notes ───

export function toNote(item: Item, zone: Zone): Note {
  const d = item.data
  const value = readTime(d.created, 'record')
  const created = where(value, zone)
  return {
    id: item.id,
    text: item.body.replace(/\n$/, ''),
    date: created?.date ?? '',
    time: created?.hours ?? 0,
    at: epochOf(value, zone) ?? 0,
    created: str(d.created),
    source: d.source === 'hotkey' ? 'hotkey' : 'page',
    state: d.state === 'sorting' || d.state === 'sorted' ? d.state : 'new',
    proposal: d.proposal as Note['proposal'],
    became: d.became as Note['became'],
    links: item.links,
  }
}

/** Items of one kind, as the UI's entities. */
// ─── Experiments ───

export function toRepeat(item: Item): Repeat {
  const d = item.data
  return {
    id: item.id,
    title: str(d.title) ?? '',
    state: d.state === 'draft' || d.state === 'ended' ? d.state : 'on',
    rule: str(d.rule) ?? '',
    from: d.from === 'done' ? 'done' : 'schedule',
    start: str(d.start),
  }
}

export function toExperiment(item: Item): Experiment {
  const d = item.data
  const arms = Array.isArray(d.arms) ? (d.arms as Experiment['arms']) : []
  return {
    id: item.id,
    title: str(d.title) ?? '',
    question: item.body.trim(),
    state: d.state === 'finished' ? 'finished' : 'running',
    measure: str(d.measure) ?? '',
    arms: arms.map((a) => ({ ...a, periods: Array.isArray(a.periods) ? a.periods : [] })),
    conclusion: str(d.conclusion),
    decision: d.decision === 'adopt' || d.decision === 'rerun' || d.decision === 'drop' ? d.decision : undefined,
  }
}

export function entities<T>(items: Iterable<Item>, kind: string, convert: (item: Item) => T): T[] {
  const out: T[] = []
  for (const item of items) if (item.kind === kind && !item.id.startsWith('?')) out.push(convert(item))
  return out
}
