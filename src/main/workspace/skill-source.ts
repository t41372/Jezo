// Reading skill sources without writing anything. Keep archive paths as they
// were stored: nanotar normalizes names, which would hide a traversal entry.

import { Gunzip, unzipSync } from 'fflate'
import { parseTar } from 'nanotar'
import { parse } from './frontmatter'

export const MAX_DOWNLOAD = 50 * 1024 * 1024
export const MAX_FILES = 2000
/** A small download can unpack to far more. */
export const MAX_UNPACKED = 200 * 1024 * 1024

export interface SourceAddress {
  kind: 'github' | 'archive'
  owner?: string
  repo?: string
  ref?: string
  path?: string
}

export interface SkillFile {
  path: string
  data: Uint8Array
  type: string
  executable?: boolean
}

export interface Skipped {
  count: number
  reason: string
}

export interface FoundSkill {
  path: string
  name: string
  title: string
  description: string
  programs: boolean
  files: SkillFile[]
}

export function parseSource(source: string): SourceAddress {
  let url: URL
  try { url = new URL(source) } catch { throw new Error('Enter a GitHub URL or a link to a .zip, .skill, .tar.gz or .tgz archive.') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('The URL must use HTTP or HTTPS.')
  const archive = /\.(zip|skill|tar\.gz|tgz)$/i.test(url.pathname)
  if (url.hostname === 'github.com') {
    const parts = url.pathname.replace(/\/$/, '').split('/').slice(1).map(decodeURIComponent)
    const [owner, repo, kind, ref, ...rest] = parts
    const githubError = () => new Error('Use a GitHub repository, tree/REF/PATH, or blob/REF/PATH/SKILL.md address.')
    if (url.protocol !== 'https:' || !owner || !repo || /[\\/]/.test(owner + repo)) throw githubError()
    if (!kind && parts.length === 2) return { kind: 'github', owner, repo }
    if (!ref || !['tree', 'blob'].includes(kind)) {
      if (archive) return { kind: 'archive' }
      throw githubError()
    }
    if (kind === 'blob' && rest.pop() !== 'SKILL.md') throw githubError()
    const path = rest.join('/')
    if (unsafePath(path)) throw githubError()
    return { kind: 'github', owner, repo, ref, ...(kind === 'blob' || rest.length ? { path } : {}) }
  }
  if (!archive) throw new Error('The address must link to a .zip, .skill, .tar.gz or .tgz archive.')
  return { kind: 'archive' }
}

export function normalizeName(name: string) {
  const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64).replace(/-$/, '')
  if (!normalized) throw new Error(`The name "${name}" has no usable letters or digits. Use a name with ASCII letters or digits.`)
  return normalized
}

export function checkDownloadSize(size: number) {
  if (size > MAX_DOWNLOAD) throw new Error(`The source is ${size} bytes; the download limit is ${MAX_DOWNLOAD} bytes (50 MB).`)
}

export function checkUnpackedSize(size: number) {
  if (size > MAX_UNPACKED) throw new Error(`The source unpacks to more than ${MAX_UNPACKED} bytes (200 MB).`)
}

/** Stops as soon as the unpacked size passes the limit, rather than after it's all in memory. */
function gunzip(bytes: Uint8Array) {
  const chunks: Uint8Array[] = []
  let size = 0
  new Gunzip((chunk) => {
    size += chunk.length
    checkUnpackedSize(size)
    chunks.push(chunk)
  }).push(bytes, true)
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.length }
  return out
}

export function checkFileCount(count: number, name: string) {
  if (count > MAX_FILES) throw new Error(`The skill "${name}" has ${count} files; the limit is ${MAX_FILES} files per skill.`)
}

/** Null means binary. Preserve the BOM so recording a text file doesn't change its bytes. */
export function textOf(data: Uint8Array): string | null {
  if (data.includes(0)) return null
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) } catch { return null }
}

function unsafePath(path: string) {
  return path.startsWith('/') || path.startsWith('\\') || /^[a-z]:/i.test(path) || path.includes('\0') || path.replaceAll('\\', '/').split('/').includes('..')
}

function hiddenPath(path: string) {
  return path.split('/').slice(0, -1).some((p) => p.startsWith('.') || p === 'node_modules')
}

export function usableEntries(files: SkillFile[]) {
  const entries: SkillFile[] = []
  const counts = new Map<string, number>()
  const skip = (reason: string) => counts.set(reason, (counts.get(reason) ?? 0) + 1)
  for (const file of files) {
    if (unsafePath(file.path)) { skip('path leaves the skill directory'); continue }
    if (['symlink', 'symbolicLink', 'link', 'hardLink'].includes(file.type)) { skip('links are not copied'); continue }
    if (file.type === 'directory') continue
    if (!['file', 'contiguousFile'].includes(file.type)) { skip(`unsupported archive entry (${file.type})`); continue }
    const path = file.path.replaceAll('\\', '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '')
    if (hiddenPath(path)) continue
    if (path) entries.push({ ...file, path })
  }
  return { entries, skipped: [...counts].map(([reason, count]) => ({ count, reason })) }
}

export const looksLikeProgram = (file: Pick<SkillFile, 'path' | 'executable'>) => file.path !== 'SKILL.md' && (
  file.path.split('/').includes('scripts') || /\.(sh|py|js|ts|rb|ps1)$/i.test(file.path) || !!file.executable
)

export function discoverSkills(entries: SkillFile[]): FoundSkill[] {
  return entries.filter((f) => f.path.split('/').at(-1) === 'SKILL.md').map((manifest) => {
    const path = manifest.path.slice(0, -'SKILL.md'.length).replace(/\/$/, '')
    try {
      const text = textOf(manifest.data)
      if (text === null) throw new Error('SKILL.md must be UTF-8 text without NUL bytes.')
      const { data } = parse(text)
      for (const field of ['name', 'description']) {
        if (typeof data[field] !== 'string' || !(data[field] as string).trim()) throw new Error(`SKILL.md needs a ${field}.`)
      }
      const name = normalizeName(data.name as string)
      const prefix = path ? `${path}/` : ''
      const files = entries.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) }))
      checkFileCount(files.length, name)
      const metadata = data.metadata as { title?: unknown } | undefined
      return { path, name, title: String(metadata?.title ?? data.name), description: data.description as string, files, programs: files.some(looksLikeProgram) }
    } catch (error) {
      throw new Error(`${manifest.path}: ${(error as Error).message}`)
    }
  })
}

/** Raw names, including ustar prefixes and PAX paths, in nanotar's file order. */
function tarNames(tar: Uint8Array): string[] {
  const names: string[] = []
  const stringAt = (offset: number, length: number) => {
    const bytes = tar.subarray(offset, offset + length)
    const end = bytes.indexOf(0)
    return new TextDecoder().decode(end < 0 ? bytes : bytes.subarray(0, end))
  }
  let nextPath: string | undefined
  for (let offset = 0; offset + 512 <= tar.length;) {
    const name = stringAt(offset, 100)
    if (!name) break
    const size = parseInt(stringAt(offset + 124, 12).trim(), 8)
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw new Error('The tar archive has a truncated or invalid entry.')
    const type = stringAt(offset + 156, 1)
    if (type === 'x' || type === 'g') {
      const body = tar.subarray(offset + 512, offset + 512 + size)
      // PAX records are byte-counted; paths can contain spaces and newlines.
      for (let at = 0; at < body.length;) {
        const space = body.indexOf(32, at)
        const length = Number(new TextDecoder().decode(body.subarray(at, space)))
        if (space < at || !Number.isSafeInteger(length) || length <= space - at + 1 || at + length > body.length) throw new Error('The tar archive has an invalid PAX header.')
        const record = new TextDecoder().decode(body.subarray(space + 1, at + length - 1))
        if (type === 'x' && record.startsWith('path=')) nextPath = record.slice(5)
        at += length
      }
    } else if (['L', 'N', 'K'].includes(type)) {
      nextPath = stringAt(offset + 512, size)
    } else {
      const prefix = stringAt(offset + 345, 155)
      names.push(nextPath ?? (prefix ? `${prefix}/${name}` : name))
      nextPath = undefined
    }
    offset += 512 + Math.ceil(size / 512) * 512
  }
  return names
}

/** ZIP's Unix mode is in its central directory, rather than fflate's file result. */
function zipModes(zip: Uint8Array): Map<string, number> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  let end = zip.length - 22
  while (end >= Math.max(0, zip.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--
  if (end < 0 || end < zip.length - 65557) throw new Error('The ZIP archive has no central directory.')
  const count = view.getUint16(end + 10, true)
  let at = view.getUint32(end + 16, true)
  const modes = new Map<string, number>()
  for (let i = 0; i < count; i++) {
    if (at + 46 > zip.length || view.getUint32(at, true) !== 0x02014b50) throw new Error('The ZIP archive has an invalid central directory.')
    const nameLength = view.getUint16(at + 28, true)
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength))
    modes.set(name, view.getUint32(at + 38, true) >>> 16)
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true)
  }
  return modes
}

export function archiveEntries(bytes: Uint8Array, format: string, github = false) {
  checkDownloadSize(bytes.length)
  let files: SkillFile[]
  if (/\.(zip|skill)$/i.test(format) || ['zip', 'skill'].includes(format)) {
    const modes = zipModes(bytes)
    let unpacked = 0
    const filter = (file: { originalSize: number }) => { unpacked += file.originalSize; checkUnpackedSize(unpacked); return true }
    files = Object.entries(unzipSync(bytes, { filter })).map(([path, data]) => {
      const mode = modes.get(path) ?? 0
      return { path, data, type: (mode & 0xf000) === 0xa000 ? 'symlink' : path.endsWith('/') ? 'directory' : 'file', executable: !!(mode & 0o111) }
    })
  } else {
    const tar = gunzip(bytes)
    const names = tarNames(tar)
    files = parseTar(tar).map((file, i) => ({
      path: names[i], data: file.data ?? new Uint8Array(), type: file.type ?? 'file', executable: !!(parseInt(file.attrs?.mode ?? '0', 8) & 0o111),
    }))
  }
  // GitHub wraps the repository in one directory. Check original paths first,
  // before removing it, so an unsafe entry cannot become an ordinary filename.
  const result = usableEntries(files.filter((f) => !github || f.path !== 'pax_global_header'))
  if (github) {
    const top = result.entries[0]?.path.split('/')[0]
    result.entries = result.entries.filter((f) => f.path.startsWith(`${top}/`)).map((f) => ({ ...f, path: f.path.slice(top!.length + 1) }))
  }
  return result
}
