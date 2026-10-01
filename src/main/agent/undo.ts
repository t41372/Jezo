// What the agent changed, run by run, so the user can take it back
// (docs/design/undo.md). For every file the agent writes it keeps the content
// from before and a hash of what the agent wrote. Undo restores a file only if
// it still holds what the agent wrote; a file someone changed since is left alone.
// Files that aren't text, like a method's image, are kept beside the history as
// blobs named by their hash, so undo covers them too.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { diffLines } from 'diff'
import type { DiffLine, HistoryEntry, Trigger, UndoResult } from '../../shared/session'
import { type Content, hashOf, newId, readContent, writeAtomic } from '../workspace/files'
import type { Workspace, Write } from '../workspace/workspace'
import { acting } from './acting'

/** A file's content in the history: its text, or the blob its bytes are kept in. */
type Kept = string | { blob: string }

interface FileChange {
  path: string
  /** Null when the agent created the file. */
  before: Kept | null
  /** Null when the agent deleted it. */
  after: Kept | null
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

  private get blobs() {
    return join(dirname(this.file), 'history-blobs')
  }

  /** Text as it is; bytes into a blob named by their hash. */
  private keep(content: Content | null): Kept | null {
    if (content === null || typeof content === 'string') return content
    const blob = hashOf(content)
    const path = join(this.blobs, blob)
    if (!existsSync(path)) {
      mkdirSync(this.blobs, { recursive: true })
      writeFileSync(path, content)
    }
    return { blob }
  }

  private content(kept: Kept): Content {
    return typeof kept === 'string' ? kept : new Uint8Array(readFileSync(join(this.blobs, kept.blob)))
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
    if (existing) existing.after = this.keep(write.after)
    else run.files.push({ path: write.path, before: this.keep(write.before), after: this.keep(write.after) })
  }

  /** Restores what the run changed, file by file, skipping files changed since. */
  async undo(runId: string): Promise<UndoResult> {
    const run = this.runs.find((r) => r.id === runId)
    if (!run || run.undone) return { kept: [] }
    const kept: string[] = []
    for (const change of [...run.files].reverse()) {
      const current = await readContent(this.workspace.abs(change.path))
      const untouched = current === null ? change.after === null : change.after !== null && hashOf(current) === (typeof change.after === 'string' ? hashOf(change.after) : change.after.blob)
      if (!untouched) {
        kept.push(change.path)
        continue
      }
      // Through the workspace, so an undo is an ordinary change by the user: indexed, and seen by whatever follows writes.
      if (change.before === null) await this.workspace.removeFile(change.path, { by: 'user' })
      else await this.workspace.writeFile(change.path, this.content(change.before), { by: 'user' }, current)
    }
    run.undone = true
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
        ...(r.retries > 0 && { check: { retries: r.retries } }),
        files: r.files.map((f) => ({ path: f.path, lines: diff(f.before, f.after) })),
        ...(r.undone && { undone: true }),
      }))
  }

  private async save() {
    await writeAtomic(this.file, JSON.stringify(this.runs))
    // Blobs no run refers to any more, once old runs are dropped.
    const used = new Set(this.runs.flatMap((r) => r.files.flatMap((f) => [f.before, f.after])).flatMap((k) => (k && typeof k !== 'string' ? [k.blob] : [])))
    if (existsSync(this.blobs)) for (const blob of readdirSync(this.blobs)) if (!used.has(blob)) rmSync(join(this.blobs, blob), { force: true })
    for (const listener of this.listeners) listener()
  }
}

/** The changed lines of a file, with a line of context around each change. A file that isn't text is one line. */
function diff(before: Kept | null, after: Kept | null): DiffLine[] {
  if ((before && typeof before !== 'string') || (after && typeof after !== 'string')) {
    return [{ kind: after === null ? 'remove' : before === null ? 'add' : 'context', text: '(binary)' }]
  }
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
