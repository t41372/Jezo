// The workspace: reads every item into memory, keeps that up to date as files
// change, and is the one place writes go through (docs/design/backend.md).

import { watch, type FSWatcher } from 'node:fs'
import { readdir, rm } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Fields, Item, ItemChanges } from '../../shared/workspace'
import { type Content, hashOf, newId, readContent, readIfExists, TEMP_SUFFIX, writeAtomic } from './files'
import { FrontmatterError, parse, patch } from './frontmatter'
import { compileSchema, type Check } from './schema'

/** Who is writing. An explicit user history action may carry a run too (docs/design/undo.md). */
export type Actor = { by: 'user'; run?: string } | { by: 'agent'; run: string }

/** A file about to change. `before` or `after` is null when the file is created or deleted; bytes when it isn't text. */
export interface Write {
  path: string
  before: Content | null
  after: Content | null
  actor: Actor
}

export interface Kind {
  name: string
  /** The plugin directory, relative to the workspace. */
  dir: string
  prefix: string
  check: Check
}

/** A file changed since the caller read it. The caller should reload and try again. */
export class StaleError extends Error {}

const ITEM = /^([^/]+)\/items\/[^/]+\.md$/
const MANIFEST = /^([^/]+)\/manifest\.yaml$/

const toPosix = (path: string) => path.split(sep).join('/')

export class Workspace {
  private kinds = new Map<string, Kind>()
  private items = new Map<string, Item>()
  private byPath = new Map<string, string>()
  private listeners = new Set<(changes: ItemChanges) => void>()
  private fileListeners = new Set<(path: string) => void>()
  private writeListeners = new Set<(write: Write) => void>()
  private watcher: FSWatcher | null = null
  private pending = new Set<string>()
  private flushTimer: NodeJS.Timeout | null = null
  /** Writes to one file run one after another. */
  private queues = new Map<string, Promise<unknown>>()

  constructor(readonly root: string) {}

  async open() {
    await this.loadKinds()
    await this.rescan()
    this.watcher = watch(this.root, { recursive: true }, (_, name) => name && this.hint(toPosix(name)))
  }

  close() {
    this.watcher?.close()
    if (this.flushTimer) clearTimeout(this.flushTimer)
  }

  list(): Item[] {
    return [...this.items.values()].map((item) => this.withLinks(item))
  }

  get(id: string): Item | undefined {
    const item = this.items.get(id)
    return item && this.withLinks(item)
  }

  /** The item read from this file, if it's an item file. */
  at(path: string): Item | undefined {
    const id = this.byPath.get(path)
    return id === undefined ? undefined : this.get(id)
  }

  /** Items that link to this one. */
  backlinks(id: string): Item[] {
    return this.list().filter((item) => item.links?.includes(id))
  }

  /**
   * An item with the items it links to. Links are standard markdown links, so
   * any editor opens them: `[寫第五段](../../todos/items/t-01j8z4.md)`, relative
   * to the file. In frontmatter a plain id is a link (`goal: g-1`).
   */
  private withLinks(item: Item): Item {
    const links = new Set<string>()
    const dir = item.path.split('/').slice(0, -1)
    for (const match of item.body.matchAll(/\[[^\]]*\]\(<?([^)\s>]+\.md)>?(?:#[^)]*)?\)/g)) {
      const target = resolvePath(dir, decodeURI(match[1]))
      const id = target && this.byPath.get(target)
      if (id && id !== item.id) links.add(id)
    }
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        if (value !== item.id && this.items.has(value)) links.add(value)
      } else if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, v]) => key !== 'id' && visit(v))
    }
    visit(item.data)
    return links.size ? { ...item, links: [...links] } : item
  }

  kindOf(name: string) {
    return this.kinds.get(name)
  }

  /** The kind whose items live at this path, if it's an item file. */
  kindAt(path: string) {
    const dir = /^([^/]+)\/items\/[^/]+\.md$/.exec(path)?.[1]
    return dir === undefined ? undefined : this.kindForDir(dir)
  }

  /** Called with the items that changed, whoever changed them. */
  onChange(listener: (changes: ItemChanges) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Called before any file is written through the workspace. */
  onWrite(listener: (write: Write) => void) {
    this.writeListeners.add(listener)
    return () => this.writeListeners.delete(listener)
  }

  /** File changes, including skills, which aren't indexed as items. */
  onFileChange(listener: (path: string) => void) {
    this.fileListeners.add(listener)
    return () => this.fileListeners.delete(listener)
  }

  abs(path: string) {
    return join(this.root, path)
  }

  // ─── Writes ───

  async create(kind: string, data: Fields, body: string, actor: Actor): Promise<Item> {
    const k = this.kinds.get(kind)
    if (!k) throw new Error(`There is no kind "${kind}" in this workspace.`)
    const id = typeof data.id === 'string' ? data.id : newId(k.prefix)
    const fields = { id, ...withoutNulls(data) }
    const problems = k.check(fields)
    if (problems.length) throw new Error(problems.join('\n'))
    const path = `${k.dir}/items/${id}.md`
    if (this.items.has(id) || this.byPath.has(path)) throw new Error(`An item with id ${id} already exists.`)
    await this.writeFile(path, patch('', fields, body), actor, null)
    return this.items.get(id)!
  }

  /**
   * Changes an item's fields, and its body if given. With `hash`, the write
   * fails if the file changed since the caller saw it.
   */
  async update(id: string, fields: Fields, actor: Actor, options: { body?: string; hash?: string } = {}): Promise<Item> {
    const item = this.items.get(id)
    if (!item) throw new Error(`There is no item ${id}.`)
    // An id names the item everywhere, links and other devices included (AGENTS.md in the workspace, docs/design/sync.md).
    if ('id' in fields && fields.id !== id) throw new Error(`An item's id never changes; ${id} stays ${id}.`)
    const k = this.kinds.get(item.kind)!
    return this.serial(item.path, async () => {
      const text = await readIfExists(this.abs(item.path))
      if (text === null) throw new StaleError(`${item.path} was deleted.`)
      if (options.hash && hashOf(text) !== options.hash) throw new StaleError(`${item.path} changed since it was read.`)
      const changes = Object.fromEntries(Object.entries(fields).map(([key, v]) => [key, v === null ? undefined : v]))
      const next = patch(text, changes, options.body)
      const problems = k.check(parse(next).data)
      if (problems.length) throw new Error(problems.join('\n'))
      if (next !== text) await this.writeNow(item.path, next, actor, text)
      return this.items.get(id)!
    })
  }

  async remove(id: string, actor: Actor) {
    const item = this.items.get(id)
    if (!item) return
    await this.serial(item.path, async () => {
      const text = await readIfExists(this.abs(item.path))
      for (const listener of this.writeListeners) listener({ path: item.path, before: text, after: null, actor })
      await rm(this.abs(item.path), { force: true })
      this.drop(item.path)
    })
    this.emit({ changed: [], removed: [id] })
  }

  /** Deletes any file in the workspace, recorded like a write. */
  async removeFile(path: string, actor: Actor) {
    await this.serial(path, async () => {
      const text = await readContent(this.abs(path))
      if (text === null) return
      for (const listener of this.writeListeners) listener({ path, before: text, after: null, actor })
      await rm(this.abs(path), { force: true })
      for (const listener of this.fileListeners) listener(path)
      const id = this.drop(path)
      if (id) this.emit({ changed: [], removed: [id] })
    })
  }

  /**
   * Writes any file in the workspace. The agent's `write` and `edit` tools come
   * through here, so their changes are recorded and indexed like any other.
   * `before` is what the caller read; pass undefined to read it here.
   */
  async writeFile(path: string, text: Content, actor: Actor, before?: Content | null) {
    await this.serial(path, async () => {
      const current = before === undefined ? await readContent(this.abs(path)) : before
      await this.writeNow(path, text, actor, current)
    })
  }

  /**
   * A file that changed without coming through here, because a shell command the
   * agent ran changed it. It's recorded and indexed like a write; the file on
   * disk already says `after`.
   */
  async changedOutside(path: string, before: string | null, after: string | null, actor: Actor) {
    await this.serial(path, async () => {
      for (const listener of this.writeListeners) listener({ path, before, after, actor })
      for (const listener of this.fileListeners) listener(path)
      const changes = await this.reread(path, after ?? undefined)
      if (changes) this.emit(changes)
    })
  }

  private async writeNow(path: string, text: Content, actor: Actor, before: Content | null) {
    for (const listener of this.writeListeners) listener({ path, before, after: text, actor })
    await writeAtomic(this.abs(path), text)
    for (const listener of this.fileListeners) listener(path)
    const changes = await this.reread(path, typeof text === 'string' ? text : undefined)
    if (changes) this.emit(changes)
  }

  private serial<T>(path: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(path) ?? Promise.resolve()
    const next = previous.then(work, work)
    this.queues.set(path, next.catch(() => undefined))
    return next
  }

  // ─── Reading ───

  private async loadKinds() {
    this.kinds.clear()
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const text = await readIfExists(join(this.root, entry.name, 'manifest.yaml'))
      if (text === null) continue
      try {
        const manifest = parseYaml(text) as { kind: string; prefix: string; schema: object }
        this.kinds.set(manifest.kind, { name: manifest.kind, dir: entry.name, prefix: manifest.prefix, check: compileSchema(manifest.schema) })
      } catch (error) {
        console.error(`Can't read ${entry.name}/manifest.yaml:`, error)
      }
    }
  }

  private kindForDir(dir: string) {
    for (const kind of this.kinds.values()) if (kind.dir === dir) return kind
    return undefined
  }

  /** Reads every item again. Catches changes the watcher missed. */
  async rescan() {
    const seen = new Set<string>()
    const changes: ItemChanges = { changed: [], removed: [] }
    for (const kind of this.kinds.values()) {
      let names: string[] = []
      try {
        names = await readdir(join(this.root, kind.dir, 'items'))
      } catch {
        continue
      }
      for (const name of names) {
        if (!name.endsWith('.md')) continue
        const path = `${kind.dir}/items/${name}`
        seen.add(path)
        const change = await this.reread(path)
        if (change) merge(changes, change)
      }
    }
    for (const path of [...this.byPath.keys()]) {
      if (seen.has(path)) continue
      const id = this.drop(path)
      if (id) changes.removed.push(id)
    }
    if (changes.changed.length || changes.removed.length) this.emit(changes)
  }

  /** Reads one item file into the index. Returns what changed, or null if nothing did. */
  private async reread(path: string, known?: string): Promise<ItemChanges | null> {
    const kind = this.kindForDir(path.split('/')[0])
    if (!kind) return null
    const text = known ?? (await readIfExists(this.abs(path)))
    if (text === null) {
      const id = this.drop(path)
      return id ? { changed: [], removed: [id] } : null
    }
    const hash = hashOf(text)
    const existing = this.byPath.get(path)
    if (existing && this.items.get(existing)?.hash === hash) return null

    const removed: string[] = []
    let item: Item
    try {
      const { data, body } = parse(text)
      const id = typeof data.id === 'string' ? data.id : `?${path}`
      const problems = kind.check(data)
      const owner = this.items.get(id)
      if (owner && owner.path !== path) problems.push(`The id ${id} is also used by ${owner.path}.`)
      item = { kind: kind.name, id, path, data, body, hash, ...(problems.length && { problems }) }
    } catch (error) {
      const message = error instanceof FrontmatterError ? `The frontmatter doesn't parse: ${error.message}` : String(error)
      item = { kind: kind.name, id: `?${path}`, path, data: {}, body: text, hash, problems: [message] }
    }
    // An id changed in the file keeps the item it was, so links and undo still
    // find it; the change is a problem until the id is put back (docs/design/sync.md).
    if (existing && !existing.startsWith('?') && !item.id.startsWith('?') && existing !== item.id) {
      item = { ...item, id: existing, problems: [...(item.problems ?? []), `Its id was ${existing} and was changed to ${item.id}. An id never changes; put ${existing} back.`] }
    }
    // The file was new, or couldn't be read before.
    if (existing && existing !== item.id) {
      this.items.delete(existing)
      removed.push(existing)
    }
    // A second file claiming an id keeps its own entry, so neither disappears.
    if (this.items.has(item.id) && this.items.get(item.id)!.path !== path) item = { ...item, id: `?${path}` }
    this.items.set(item.id, item)
    this.byPath.set(path, item.id)
    return { changed: [item], removed }
  }

  private drop(path: string) {
    const id = this.byPath.get(path)
    this.byPath.delete(path)
    if (id) this.items.delete(id)
    return id
  }

  /** A file changed on disk. Batches events, since one save can fire several. */
  private hint(path: string) {
    if (path.endsWith(TEMP_SUFFIX) || path.startsWith('sessions/') || path.startsWith('.')) return
    for (const listener of this.fileListeners) listener(path)
    if (MANIFEST.test(path)) {
      void this.loadKinds().then(() => this.rescan())
      return
    }
    if (!ITEM.test(path)) return
    this.pending.add(path)
    this.flushTimer ??= setTimeout(() => void this.flush(), 30)
  }

  private async flush() {
    this.flushTimer = null
    const paths = [...this.pending]
    this.pending.clear()
    const changes: ItemChanges = { changed: [], removed: [] }
    for (const path of paths) {
      const change = await this.serial(path, () => this.reread(path))
      if (change) merge(changes, change)
    }
    if (changes.changed.length || changes.removed.length) this.emit(changes)
  }

  private emit(changes: ItemChanges) {
    const withLinks = { ...changes, changed: changes.changed.map((item) => this.withLinks(item)) }
    for (const listener of this.listeners) listener(withLinks)
  }
}

function merge(into: ItemChanges, from: ItemChanges) {
  into.changed.push(...from.changed)
  into.removed.push(...from.removed)
}

function withoutNulls(fields: Fields) {
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined))
}

/** A relative link from a file in `dir`, as a workspace path, or null if it leaves the workspace. */
function resolvePath(dir: string[], link: string) {
  if (/^[a-z]+:/i.test(link) || link.startsWith('/')) return null
  const parts = [...dir]
  for (const part of link.split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** A path inside the workspace, or null if it points outside. */
export function insideWorkspace(root: string, path: string) {
  const rel = toPosix(relative(root, path))
  return rel.startsWith('..') || rel.startsWith('/') ? null : rel
}
