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
  /** What the run's last finished write left. Null when the agent deleted it. */
  after: Kept | null
  /**
   * A write saved here before it happens, until it's done. One that never finished
   * (it failed, or Jezo stopped first) stays, so undo knows the file can hold
   * either this or `after`.
   */
  pending?: { content: Kept | null }
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
  /** It never finished: Jezo quit or crashed while it ran. */
  interrupted?: boolean
  /**
   * Shell commands going right now, each with the workspace's text files as they
   * were before it started, as blobs. One still here at launch was cut off.
   */
  commands?: { id: string; baseline: Record<string, string> }[]
  /** Changes found at launch, after a command was cut off: they may include edits made elsewhere while Jezo was closed. */
  found?: boolean
}

/**
 * A shell command's changes are found by comparing the workspace before and after
 * it. The before is saved first, so a command cut off by a quit or a crash still
 * leaves what it changed in 修改紀錄 (docs/design/undo.md).
 */
export interface CommandCheckpoints {
  begin(run: string, files: Map<string, string>): Promise<string | null>
  end(run: string, id: string): Promise<void>
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
    // A run still open from before was cut off; what it changed was saved as it went, and can be undone.
    for (const run of this.runs) if (!run.finished) run.interrupted = true
    workspace.onWrite({ before: (write) => this.record(write), after: (write) => this.done(write) })
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

  /** Saves the workspace as it is before a shell command, and returns the command's id. */
  async beginCommand(runId: string, files: Map<string, string>): Promise<string | null> {
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return null
    const baseline: Record<string, string> = {}
    for (const [path, text] of files) baseline[path] = this.blob(text)
    const id = newId('c')
    ;(run.commands ??= []).push({ id, baseline })
    await this.save()
    return id
  }

  /** The command finished, and its changes were recorded as the run's. */
  async endCommand(runId: string, id: string) {
    const run = this.runs.find((r) => r.id === runId)
    if (!run?.commands) return
    run.commands = run.commands.filter((c) => c.id !== id)
    if (!run.commands.length) delete run.commands
    await this.save()
  }

  /**
   * At launch: commands that were cut off. What differs from before each one is
   * listed as an interrupted change, never put back on its own. It can include
   * edits made elsewhere while Jezo was closed, so the history says it was found.
   */
  async recover(read: () => Promise<Map<string, string>>) {
    const cut = this.runs.filter((r) => r.commands?.length)
    if (!cut.length) return
    const current = await read()
    for (const run of cut) {
      for (const command of run.commands!) {
        const files: FileChange[] = []
        for (const path of new Set([...Object.keys(command.baseline), ...current.keys()])) {
          const was = command.baseline[path] ? textOfBlob(this.content({ blob: command.baseline[path] })) : null
          const now = current.get(path) ?? null
          if (was !== now) files.push({ path, before: was, after: now })
        }
        if (files.length) this.runs.unshift({ id: newId('r'), session: run.session, trigger: run.trigger, at: run.at, summary: '', files, retries: 0, finished: false, interrupted: true, found: true })
      }
      delete run.commands
    }
    await this.save()
  }

  /** Text into a blob named by its hash; the same text is kept once. */
  private blob(text: string) {
    const blob = hashOf(text)
    const path = join(this.blobs, blob)
    if (!existsSync(path)) {
      mkdirSync(this.blobs, { recursive: true })
      writeFileSync(path, text)
    }
    return blob
  }

  /** Skill removal is an explicit GUI action the user can undo in history. */
  /** Resolves to the change's id in 修改紀錄, to undo it from a toast. */
  async userChange(summary: string, work: () => Promise<void>): Promise<string> {
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
    return id
  }

  private change(write: Write) {
    const runId = write.actor.run
    return runId ? this.runs.find((r) => r.id === runId)?.files.find((f) => f.path === write.path) : undefined
  }

  /**
   * Before a write: saved as pending, before the file itself changes (the workspace
   * waits, and a failed save stops the write), so a run cut off by a quit or a
   * crash can still be undone (docs/design/undo.md).
   */
  private record(write: Write) {
    const runId = write.actor.run
    if (!runId) return
    const run = this.runs.find((r) => r.id === runId)
    if (!run) return
    const pending = { content: this.keep(write.after) }
    const existing = this.change(write)
    // Written twice in one run: what was there before the run is still the first `before`.
    if (existing) existing.pending = pending
    else run.files.push({ path: write.path, before: this.keep(write.before), after: this.keep(write.before), pending })
    return this.save()
  }

  /** After a write: what it wrote is what the file holds now. */
  private done(write: Write) {
    const change = this.change(write)
    if (!change?.pending) return
    change.after = change.pending.content
    delete change.pending
    this.save().catch(console.error)
  }

  /** Restores what the run changed, file by file, skipping files changed since. */
  async undo(runId: string): Promise<UndoResult> {
    const run = this.runs.find((r) => r.id === runId)
    if (!run || run.undone) return { kept: [] }
    const kept: string[] = []
    for (const change of [...run.files].reverse()) {
      const current = await readContent(this.workspace.abs(change.path))
      // Still what the run left: its last finished write, or one that may have happened before Jezo stopped.
      const holds = (kept: Kept | null) => (current === null ? kept === null : kept !== null && hashOf(current) === (typeof kept === 'string' ? hashOf(kept) : kept.blob))
      const untouched = holds(change.after) || (!!change.pending && holds(change.pending.content))
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
      .filter((r) => (r.finished || r.interrupted) && r.files.length)
      .map((r) => ({
        id: r.id,
        date: r.at.slice(0, 10),
        time: Number(r.at.slice(11, 13)) + Number(r.at.slice(14, 16)) / 60,
        source: r.trigger,
        session: r.session,
        summary: r.summary,
        ...(r.retries > 0 && { check: { retries: r.retries } }),
        // A write that may or may not have happened is shown as if it did: undo handles either.
        files: r.files.map((f) => ({ path: f.path, lines: diff(f.before, f.pending ? f.pending.content : f.after) })),
        ...(r.undone && { undone: true }),
        ...(r.interrupted && { interrupted: true }),
        ...(r.found && { found: true }),
      }))
  }

  /** Saves one after another, so an earlier save finishing late can't put back an older history. */
  private saving: Promise<void> = Promise.resolve()
  private save() {
    this.saving = this.saving.then(() => this.write(), () => this.write())
    return this.saving
  }

  private async write() {
    await writeAtomic(this.file, JSON.stringify(this.runs))
    // Blobs no run refers to any more, once old runs are dropped.
    const used = new Set([
      ...this.runs.flatMap((r) => r.files.flatMap((f) => [f.before, f.after, f.pending?.content ?? null])).flatMap((k) => (k && typeof k !== 'string' ? [k.blob] : [])),
      ...this.runs.flatMap((r) => r.commands ?? []).flatMap((c) => Object.values(c.baseline)),
    ])
    if (existsSync(this.blobs)) for (const blob of readdirSync(this.blobs)) if (!used.has(blob)) rmSync(join(this.blobs, blob), { force: true })
    for (const listener of this.listeners) listener()
  }
}

const textOfBlob = (content: Content) => (typeof content === 'string' ? content : new TextDecoder().decode(content))

/** The changed lines of a file, with a line of context around each change. A file that isn't text is one line. */
export function diff(before: Kept | null, after: Kept | null): DiffLine[] {
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
