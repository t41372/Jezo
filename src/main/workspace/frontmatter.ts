// Markdown files with YAML frontmatter: reading them, and changing them without
// disturbing what wasn't changed (docs/design/backend.md, "Why key by key").

import { Document, isMap, parseDocument, type Pair } from 'yaml'

export class FrontmatterError extends Error {}

export interface Parsed {
  data: Record<string, unknown>
  body: string
}

/** Where the frontmatter is in a file. `yaml` is the text between the fences. */
interface Split {
  yaml: string
  /** Offset of the YAML text in the file. */
  start: number
  /** Offset just past the closing fence's line. */
  bodyStart: number
  eol: string
}

const OPEN = /^---\r?\n/
const CLOSE = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m

function split(text: string): Split | null {
  const open = OPEN.exec(text)
  if (!open) return null
  const eol = open[0].endsWith('\r\n') ? '\r\n' : '\n'
  const rest = text.slice(open[0].length)
  const close = CLOSE.exec(rest)
  if (!close) return null
  const start = open[0].length
  return { yaml: rest.slice(0, close.index), start, bodyStart: start + close.index + close[0].length, eol }
}

function parseYaml(yaml: string) {
  const doc = parseDocument(yaml)
  if (doc.errors.length) throw new FrontmatterError(doc.errors[0].message)
  if (doc.contents !== null && !isMap(doc.contents)) throw new FrontmatterError('The frontmatter is not a set of fields.')
  return doc
}

export function parse(text: string): Parsed {
  const s = split(text)
  if (!s) return { data: {}, body: text }
  const data = (parseYaml(s.yaml).toJS() ?? {}) as Record<string, unknown>
  return { data, body: text.slice(s.bodyStart) }
}

/** One field as YAML text, ending in a newline. */
function render(key: string, value: unknown, eol: string) {
  const text = new Document({ [key]: value }).toString({ lineWidth: 0 })
  return eol === '\n' ? text : text.replace(/\n/g, eol)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * Changes frontmatter fields, and the body if one is given. A field set to
 * `undefined` is removed. Only the changed top-level fields are rewritten; a
 * changed nested value replaces its whole field. Every other byte stays.
 */
export function patch(text: string, changes: Record<string, unknown>, body?: string): string {
  const s = split(text)
  if (!s) {
    const fields = Object.entries(changes).filter(([, v]) => v !== undefined)
    if (!fields.length) return body ?? text
    return `---\n${fields.map(([k, v]) => render(k, v, '\n')).join('')}---\n${body ?? text}`
  }

  const doc = parseYaml(s.yaml)
  const pairs = isMap(doc.contents) ? (doc.contents.items as Pair[]) : []
  const current = (doc.toJS() ?? {}) as Record<string, unknown>
  let yaml = s.yaml
  const edits: { from: number; to: number; text: string }[] = []
  const added: string[] = []

  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined ? !(key in current) : same(current[key], value)) continue
    const pair = pairs.find((p) => (p.key as { value?: unknown })?.value === key)
    if (!pair) {
      added.push(render(key, value, s.eol))
      continue
    }
    const from = (pair.key as { range: [number, number, number] }).range[0]
    let to = ((pair.value ?? pair.key) as { range: [number, number, number] }).range[2]
    // Take the rest of the line (a trailing comment and the newline) with it.
    const lineEnd = yaml.indexOf('\n', to - 1 < from ? from : to - 1)
    to = Math.max(to, lineEnd === -1 ? yaml.length : lineEnd + 1)
    edits.push({ from, to, text: value === undefined ? '' : render(key, value, s.eol) })
  }

  for (const { from, to, text: replacement } of edits.sort((a, b) => b.from - a.from)) {
    // The last field may have no newline after it; what replaces it shouldn't add one mid-file.
    const tail = to === yaml.length && !/\r?\n$/.test(yaml.slice(from, to)) ? replacement.replace(/\r?\n$/, '') : replacement
    yaml = yaml.slice(0, from) + tail + yaml.slice(to)
  }
  if (added.length) {
    if (yaml && !yaml.endsWith('\n')) yaml += s.eol
    yaml += added.join('')
  }

  return text.slice(0, s.start) + yaml + text.slice(s.start + s.yaml.length, s.bodyStart) + (body ?? text.slice(s.bodyStart))
}
