// What happened to each automation's scheduled times, one line per event, in
// automations/history/<id>.jsonl (docs/design/automations.md, "History"). It's
// in the workspace because the scheduler acts on it, and Jezo writes it as
// itself, so undo never takes it back.

import type { Workspace } from '../workspace/workspace'
import { readIfExists } from '../workspace/files'
import type { Outcome } from './host'

/** An occurrence's slot: the date and clock in the schedule's zone, like "2026-10-01T08:00". */
export type Slot = string

export type HistoryEvent =
  /** Jezo started watching this automation: when it's first seen on, or turned on again. Times before this aren't missed. */
  | { type: 'watching'; at: string; zone: string }
  /** The zone checks use moved here. The time between wasn't worked out. */
  | { type: 'zone'; zone: string; at: string }
  /** Times that passed without a run, and why. */
  | { type: 'skipped'; slots: Slot[]; count: number; reason: 'expired' | 'replaced' | 'zone-changed'; at: string }
  /** A run was claimed before it started, so a crash can't run it twice. A manual run has no slot unless it took one. */
  | { type: 'claimed'; attempt: string; slot?: Slot; due?: string; origin: 'scheduled' | 'manual'; late?: boolean; session?: string; at: string }
  | { type: 'ended'; attempt: string; outcome: Outcome | 'interrupted'; at: string }
  /** The model couldn't be reached before anything happened; the time is tried again while its window is open. */
  | { type: 'retry'; slot: Slot; at: string }
  /** One notification went out for a batch of late runs. Best effort: one cut off by a crash isn't sent later. */
  | { type: 'notified'; attempts: string[]; at: string }

const pathOf = (id: string) => `automations/history/${id}.jsonl`

export class AutomationHistory {
  /** `changed` is told after each event is written, so the automation's page can follow. */
  constructor(private workspace: Workspace, private changed: (id: string) => void = () => {}) {}

  /** Every event, oldest first. A last line cut off by a crash is left out; any other broken line too, and said. */
  async read(id: string): Promise<HistoryEvent[]> {
    const text = await readIfExists(this.workspace.abs(pathOf(id)))
    if (!text) return []
    const events: HistoryEvent[] = []
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        events.push(JSON.parse(line) as HistoryEvent)
      } catch {
        console.error(`An unreadable line in ${pathOf(id)} was left out.`)
      }
    }
    return events
  }

  private appending = new Map<string, Promise<void>>()

  /** Adds an event. Appends to one file go one after another, so two at once can't both build on the same old file and lose one. */
  append(id: string, event: HistoryEvent) {
    const next = (this.appending.get(id) ?? Promise.resolve()).then(async () => {
      const path = pathOf(id)
      const text = (await readIfExists(this.workspace.abs(path))) ?? ''
      // A torn last line from a crash is finished off, so the new event starts on a line of its own.
      const before = text && !text.endsWith('\n') ? `${text}\n` : text
      await this.workspace.writeFile(path, `${before}${JSON.stringify(event)}\n`, { by: 'jezo' })
      this.changed(id)
    })
    this.appending.set(id, next.catch(() => undefined))
    return next
  }
}

/** What the history says about a slot, and about the automation as a whole. */
export function summarize(events: HistoryEvent[]) {
  // An attempt can end more than once: unreachable, then the user retried its conversation. The last end counts.
  const ended = new Map(events.filter((e) => e.type === 'ended').map((e) => [e.attempt, e]))
  const claims = events.filter((e) => e.type === 'claimed')
  /** Claims of a slot that hold. One that couldn't reach the model can be tried again. */
  const holding = claims.filter((c) => c.slot && ended.get(c.attempt)?.outcome !== 'unreachable')
  const claimed = new Set(holding.map((c) => c.slot!))
  const watching = events.filter((e) => e.type === 'watching').at(-1)
  const lastFinished = [...claims].reverse().find((c) => ended.get(c.attempt)?.outcome === 'completed' || ended.get(c.attempt)?.outcome === 'waiting')
  const lastClaim = holding.at(-1)
  const zone = events.filter((e) => e.type === 'zone' || e.type === 'watching').at(-1)
  return {
    claimed,
    /** The zone the last check used. */
    zone: zone?.type === 'zone' || zone?.type === 'watching' ? zone.zone : undefined,
    skipped: new Set(events.flatMap((e) => (e.type === 'skipped' ? e.slots : []))),
    watching,
    lastFinished,
    lastClaim,
    /** Runs that were claimed and never ended: Jezo quit or crashed while they ran. */
    unfinished: claims.filter((c) => !ended.has(c.attempt)),
    interrupted: claims.filter((c) => ended.get(c.attempt)?.outcome === 'interrupted'),
    retries: (slot: Slot) => events.filter((e) => e.type === 'retry' && e.slot === slot).length,
  }
}
