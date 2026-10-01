// What happened to each automation's scheduled times, one line per event, in
// automations/history/<id>.jsonl (docs/design/automations.md, "History"). It's
// in the workspace because the scheduler acts on it, and Jezo writes it as
// itself, so undo never takes it back.

import { stat, truncate } from 'node:fs/promises'
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
  | { type: 'skipped'; slots: Slot[]; count: number; reason: 'expired' | 'replaced' | 'zone-changed' | 'skipped'; at: string }
  /** A run was claimed before it started, so a crash can't run it twice. A manual run has no slot unless it took one. */
  | { type: 'claimed'; attempt: string; slot?: Slot; due?: string; origin: 'scheduled' | 'manual'; late?: boolean; session?: string; at: string }
  | { type: 'ended'; attempt: string; outcome: Outcome; at: string }
  /** The user retried a run that couldn't reach its model, in its conversation: the claim holds again until it ends again. */
  | { type: 'resumed'; attempt: string; at: string }
  /** The model couldn't be reached before anything happened; the time is tried again while its window is open. */
  | { type: 'retry'; slot: Slot; at: string }
  /** One notification went out for a batch of late runs. Best effort: one cut off by a crash isn't sent later. */
  | { type: 'notified'; attempts: string[]; at: string }

/** A line of the history that can't be read. While there is one, the history doesn't say for sure what ran. */
export interface HistoryProblem {
  path: string
  line: number
  message: string
}

export interface HistoryRead {
  events: HistoryEvent[]
  problems: HistoryProblem[]
}

export const historyPath = (id: string) => `automations/history/${id}.jsonl`

const isText = (v: unknown) => typeof v === 'string'
const OUTCOMES = ['completed', 'waiting', 'failed', 'unreachable', 'stopped', 'interrupted']
const REASONS = ['expired', 'replaced', 'zone-changed', 'skipped']

/** Whether a parsed line is an event the scheduler knows, with the fields it relies on. */
function valid(e: Record<string, unknown>): boolean {
  if (!isText(e.at)) return false
  switch (e.type) {
    case 'watching':
    case 'zone':
      return isText(e.zone)
    case 'skipped':
      return Array.isArray(e.slots) && e.slots.every(isText) && typeof e.count === 'number' && REASONS.includes(e.reason as string)
    case 'claimed':
      return isText(e.attempt) && (e.origin === 'scheduled' || e.origin === 'manual') && (e.slot === undefined || isText(e.slot))
    case 'ended':
      return isText(e.attempt) && OUTCOMES.includes(e.outcome as string)
    case 'resumed':
      return isText(e.attempt)
    case 'retry':
      return isText(e.slot)
    case 'notified':
      return Array.isArray(e.attempts)
    default:
      return false
  }
}

/**
 * Reads a history file's text. A last line without its newline is an append a
 * crash cut off: it never happened, and is left out. Any other line that isn't
 * an event is a problem.
 */
export function parseHistory(text: string, path: string): HistoryRead & { torn: boolean } {
  const lines = text.split('\n')
  const torn = lines.at(-1) !== ''
  const events: HistoryEvent[] = []
  const problems: HistoryProblem[] = []
  lines.forEach((line, i) => {
    if (!line.trim() || (torn && i === lines.length - 1)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      problems.push({ path, line: i + 1, message: "This line isn't JSON." })
      return
    }
    if (parsed && typeof parsed === 'object' && valid(parsed as Record<string, unknown>)) events.push(parsed as HistoryEvent)
    else problems.push({ path, line: i + 1, message: "This line isn't an event the scheduler knows." })
  })
  return { events, problems, torn }
}

export class AutomationHistory {
  /** Parsed files, kept until the file changes: the scheduler reads them every 30 seconds. */
  private cache = new Map<string, { key: string; read: HistoryRead & { torn: boolean } }>()
  private appending = new Map<string, Promise<void>>()

  /** `changed` is told after each event is written, so the automation's page can follow. */
  constructor(private workspace: Workspace, private changed: (id: string) => void = () => {}) {}

  /** Every event, oldest first, and the lines that couldn't be read. */
  async read(id: string): Promise<HistoryRead> {
    const { events, problems } = await this.load(id)
    return { events, problems }
  }

  private async load(id: string) {
    const path = this.workspace.abs(historyPath(id))
    const info = await stat(path).catch(() => null)
    if (!info) return { events: [], problems: [], torn: false }
    const key = `${info.mtimeMs}:${info.size}`
    const cached = this.cache.get(id)
    if (cached?.key === key) return cached.read
    const read = parseHistory((await readIfExists(path)) ?? '', historyPath(id))
    this.cache.set(id, { key, read })
    return read
  }

  /** Adds an event to the end of the file. Appends to one file go one after another. */
  append(id: string, event: HistoryEvent) {
    const next = (this.appending.get(id) ?? Promise.resolve()).then(async () => {
      // A torn last line is cut off first, so it can't become a broken line in the middle.
      const { torn } = await this.load(id)
      if (torn) {
        const text = (await readIfExists(this.workspace.abs(historyPath(id)))) ?? ''
        await truncate(this.workspace.abs(historyPath(id)), Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)))
      }
      await this.workspace.appendFile(historyPath(id), `${JSON.stringify(event)}\n`, { by: 'jezo' })
      this.changed(id)
    })
    this.appending.set(id, next.catch(() => undefined))
    return next
  }
}

/** What the history says about a slot, and about the automation as a whole. */
export function summarize(events: HistoryEvent[]) {
  // An attempt can end more than once: unreachable, then retried by the user and ended again. A resume
  // makes it unfinished until its next end. The last of these counts.
  const ended = new Map<string, Extract<HistoryEvent, { type: 'ended' }>>()
  for (const e of events) {
    if (e.type === 'ended') ended.set(e.attempt, e)
    if (e.type === 'resumed') ended.delete(e.attempt)
  }
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
    /** How each attempt ended, as of now. */
    ended,
    /** The zone the last check used. */
    zone: zone?.type === 'zone' || zone?.type === 'watching' ? zone.zone : undefined,
    skipped: new Set(events.flatMap((e) => (e.type === 'skipped' ? e.slots : []))),
    /** Times the user chose to skip. Unlike a time that expired, one never becomes due again. */
    skippedByUser: new Set(events.flatMap((e) => (e.type === 'skipped' && e.reason === 'skipped' ? e.slots : []))),
    watching,
    lastFinished,
    lastClaim,
    /** Runs that were claimed and never ended: Jezo quit or crashed while they ran. */
    unfinished: claims.filter((c) => !ended.has(c.attempt)),
    interrupted: claims.filter((c) => ended.get(c.attempt)?.outcome === 'interrupted'),
    retries: (slot: Slot) => events.filter((e) => e.type === 'retry' && e.slot === slot).length,
  }
}
