import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export const hashOf = (content: string | Uint8Array) => createHash('sha256').update(content).digest('hex')

/** What a file holds: text, or bytes when it isn't UTF-8 text. */
export type Content = string | Uint8Array

/** The bytes as text, or null when they aren't UTF-8 text. */
export function textOf(data: Uint8Array): string | null {
  if (data.includes(0)) return null
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data) } catch { return null }
}

/** A file's content, as text when it is text; null when there's no file. */
export async function readContent(path: string): Promise<Content | null> {
  try {
    const bytes = new Uint8Array(await readFile(path))
    return textOf(bytes) ?? bytes
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/** Temporary files end in this, so the watcher can skip them. */
export const TEMP_SUFFIX = '.jezo-tmp'

/** Writes a temporary file next to the target and renames it over, so a crash never leaves half a file. */
export async function writeAtomic(path: string, text: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomBytes(4).toString('hex')}${TEMP_SUFFIX}`
  try {
    await writeFile(temp, text)
    await rename(temp, path)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

export async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

/**
 * A new id: the kind's prefix, then time and randomness, short enough to read.
 * 48 random bits, so ids made on two devices in the same millisecond, once
 * they sync, don't collide (docs/design/sync.md). Older, shorter ids stay valid.
 */
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${randomBytes(6).readUIntBE(0, 6).toString(36).padStart(10, '0')}`
