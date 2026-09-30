// Turns workspace items into the entities the UI draws, and UI changes back into
// fields to write. The file formats are in docs/design/backend.md.

import type { Fields, Item } from '../../../shared/workspace'
import type { ISODate, Note, Todo } from './types'

// ─── Local times ───
// On disk a time is local, with no zone: "2026-09-29T09:30". The UI keeps a
// date and hours from midnight.

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-09-29T09:30" → { date: "2026-09-29", hours: 9.5 } */
export function readLocal(text: unknown): { date: ISODate; hours: number } | null {
  if (typeof text !== 'string') return null
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/.exec(text)
  return m ? { date: m[1], hours: Number(m[2]) + Number(m[3]) / 60 } : null
}

export function writeLocal(date: ISODate, hours: number) {
  const minutes = Math.round(hours * 60)
  return `${date}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`
}

export function localDate(at: Date) {
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/** A moment as a local time, to the minute. */
export const stamp = (at = new Date()) => writeLocal(localDate(at), at.getHours() + at.getMinutes() / 60)

function toEpoch(text: unknown) {
  const local = readLocal(text)
  if (!local) return undefined
  const [y, m, d] = local.date.split('-').map(Number)
  return new Date(y, m - 1, d, 0, Math.round(local.hours * 60)).getTime()
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)

// ─── Todos ───

export function toTodo(item: Item): Todo {
  const d = item.data
  const scheduled = readLocal(d.scheduled)
  return {
    id: item.id,
    title: str(d.title) ?? '',
    goalId: str(d.goal) ?? null,
    state: d.state === 'draft' || d.state === 'done' ? d.state : 'open',
    cue: str(d.cue),
    estimateMinutes: typeof d.estimate === 'number' ? d.estimate : 30,
    slot: scheduled && { date: scheduled.date, start: scheduled.hours, ...(d.proposed === true && { proposed: true }) },
    subtasks: Array.isArray(d.steps) ? (d.steps as { text: string; done: boolean }[]) : undefined,
    why: str(d.why),
    startedAt: toEpoch(d.started),
    rank: str(d.rank),
  }
}

/** The fields to write for a change to a todo. Fields a change clears are null. */
export function todoFields(change: Partial<Todo>): Fields {
  const f: Fields = {}
  if ('title' in change) f.title = change.title
  if ('goalId' in change) f.goal = change.goalId ?? null
  if ('state' in change) f.state = change.state
  if ('cue' in change) f.cue = change.cue ?? null
  if ('estimateMinutes' in change) f.estimate = change.estimateMinutes
  if ('slot' in change) {
    f.scheduled = change.slot ? writeLocal(change.slot.date, change.slot.start) : null
    f.proposed = change.slot?.proposed ? true : null
  }
  if ('subtasks' in change) f.steps = change.subtasks?.length ? change.subtasks : null
  if ('why' in change) f.why = change.why ?? null
  if ('startedAt' in change) f.started = change.startedAt ? stamp(new Date(change.startedAt)) : null
  if ('rank' in change) f.rank = change.rank ?? null
  return f
}

// ─── Notes ───

export function toNote(item: Item): Note {
  const d = item.data
  const created = readLocal(d.created)
  return {
    id: item.id,
    text: item.body.replace(/\n$/, ''),
    date: created?.date ?? '',
    time: created?.hours ?? 0,
    source: d.source === 'hotkey' ? 'hotkey' : 'page',
    state: d.state === 'sorting' || d.state === 'sorted' ? d.state : 'new',
    proposal: d.proposal as Note['proposal'],
    became: d.became as Note['became'],
  }
}

/** Items of one kind, as the UI's entities. */
export function entities<T>(items: Iterable<Item>, kind: string, convert: (item: Item) => T): T[] {
  const out: T[] = []
  for (const item of items) if (item.kind === kind && !item.id.startsWith('?')) out.push(convert(item))
  return out
}
