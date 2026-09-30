// What the agent changed, run by run, so the user can take it back
// (docs/design/undo.md). For every file the agent writes it keeps the content
// from before and a hash of what the agent wrote. Undo restores a file only if
// it still holds what the agent wrote; a file someone changed since is left alone.

import { readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { diffLines } from 'diff'
import type { DiffLine, HistoryEntry, Trigger, UndoResult } from '../../shared/session'
import { hashOf, newId, readIfExists, writeAtomic } from '../workspace/files'
import type { Workspace, Write } from '../workspace/workspace'
import { acting } from './acting'

interface FileChange {
  path: string
  /** Null when the agent created the file. */
  before: string | null
  /** Null when the agent deleted it. */
  after: string | null
}

interface Run {
  id: string
  session: string
  trigger: Trigger | 'you'
  /** Local time the run started, "2026-09-29T09:30". */
  at: string
  summary: string
  files: FileChange[]
  /** Writes a check refused before the agent got them right. */
  retries: number
  /** The agent said it changed something and hadn't; it was sent back to do it. */
  claimed?: boolean
  finished: boolean
  undone?: boolean
}

/** How many runs are kept. Older ones are dropped; losing them is fine. */
const KEEP = 100

export class UndoLog {
  private runs: Run[] = []
  private listeners = new Set<() => void>()

  constructor(
    private workspace: Workspace,
    private file: string,
  ) {
    try {
      this.runs = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      // No history yet, or an unreadable one. History is safe to lose.
    }
    workspace.onWrite((write) => this.record(write))
  }

  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(run: Omit<Run, 'files' | 'retries' | 'finished' | 'summary'>) {
    this.runs.unshift({ ...run, summary: '', files: [], retries: 0, finished: false })
    this.runs.length = Math.min(this.runs.length, KEEP)
  }

  /** Whether the run has changed any file so far. */
  changed(runId: string) {
    return Boolean(this.runs.find((r) => r.id === runId)?.files.length)
  }

  claimedWithoutChange(runId: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (run) run.claimed = true
  }

  /** A check refused one of the agent's writes. */
  refused(runId: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (run) run.retries++
  }

  async finish(runId: string, summary: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return
    run.summary = summary
    run.finished = true
    await this.save()
  }

  /** Skill removal is an explicit GUI action the user can undo in history. */
  async userChange(summary: string, work: () => Promise<void>) {
    const id = newId('r')
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const at = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
    this.start({ id, session: '', trigger: 'you', at })
    try {
      await acting.run({ actor: { by: 'user', run: id }, source: 'user' }, work)
    } finally {
      await this.finish(id, summary)
    }
  }

  private record(write: Write) {
    const runId = write.actor.run
    if (!runId) return
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return
    const existing = run.files.find((f) => f.path === write.path)
    // Written twice in one run: what was there before the run is still the first `before`.
    if (existing) existing.after = write.after
    else run.files.push({ path: write.path, before: write.before, after: write.after })
  }

  /** Restores what the run changed, file by file, skipping files changed since. */
  async undo(runId: string): Promise<UndoResult> {
    const run = this.runs.find((r) => r.id === runId)
    if (!run || run.undone) return { kept: [] }
    const kept: string[] = []
    for (const change of [...run.files].reverse()) {
      const current = await readIfExists(this.workspace.abs(change.path))
      const untouched = current === null ? change.after === null : change.after !== null && hashOf(current) === hashOf(change.after)
      if (!untouched) {
        kept.push(change.path)
        continue
      }
      if (change.before === null) {
        await rm(this.workspace.abs(change.path), { force: true })
      } else {
        await writeAtomic(this.workspace.abs(change.path), change.before)
      }
    }
    run.undone = true
    await this.workspace.rescan()
    await this.save()
    return { kept }
  }

  /** Finished runs that changed something, newest first, as the history shows them. */
  list(): HistoryEntry[] {
    return this.runs
      .filter((r) => r.finished && r.files.length)
      .map((r) => ({
        id: r.id,
        date: r.at.slice(0, 10),
        time: Number(r.at.slice(11, 13)) + Number(r.at.slice(14, 16)) / 60,
        source: r.trigger,
        session: r.session,
        summary: r.summary,
        ...(r.claimed
          ? { check: { level: 'error' as const, kind: 'claimed-without-change' as const } }
          : r.retries > 0 && { check: { level: 'warn' as const, retries: r.retries } }),
        files: r.files.map((f) => ({ path: f.path, lines: diff(f.before, f.after) })),
        ...(r.undone && { undone: true }),
      }))
  }

  private async save() {
    await writeAtomic(this.file, JSON.stringify(this.runs))
    for (const listener of this.listeners) listener()
  }
}

/** The changed lines of a file, with a line of context around each change. */
function diff(before: string | null, after: string | null): DiffLine[] {
  const lines: DiffLine[] = []
  for (const part of diffLines(before ?? '', after ?? '')) {
    const kind = part.added ? 'add' : part.removed ? 'remove' : 'context'
    const texts = part.value.replace(/\n$/, '').split('\n')
    const shown = kind === 'context' && texts.length > 2 ? [texts[0], '…', texts[texts.length - 1]] : texts
    for (const text of shown) lines.push({ kind, text })
  }
  return lines
}

export const historyFile = (userData: string) => join(userData, 'history.json')
