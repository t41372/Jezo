// A new workspace starts as a copy of the files Jezo ships in resources/workspace:
// what each directory is for, its manifest, and the built-in skills. From then
// on they're the user's (docs/design/backend.md).

import { cp, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'

/** Where the shipped files are: in Resources when packaged, in the repo (two up from out/main) in development. */
const resources = () => (app.isPackaged ? process.resourcesPath : join(import.meta.dirname, '../../resources'))

const exists = (path: string) => stat(path).then(() => true, () => false)

/**
 * Copies the shipped files into the workspace. A plugin's directory is copied
 * only when the workspace doesn't have it yet: after that it's the user's, and
 * what they deleted from it (a built-in automation, a skill) stays deleted.
 * Files at the top level are copied when missing. Skills and automations come
 * in the language the app is in; Traditional Chinese is the base, and other
 * languages replace the files they have.
 */
export async function seedWorkspace(root: string, language: string) {
  await mkdir(root, { recursive: true })
  const base = join(resources(), 'workspace')
  const overlay = join(resources(), `workspace.${language}`)
  const hasOverlay = await exists(overlay)
  for (const entry of await readdir(base, { withFileTypes: true })) {
    const target = join(root, entry.name)
    if (await exists(target)) continue
    if (entry.isDirectory()) await mkdir(target, { recursive: true })
    await copyInto(join(base, entry.name), target, entry.isDirectory())
    if (hasOverlay && (await exists(join(overlay, entry.name)))) await copyInto(join(overlay, entry.name), target, entry.isDirectory(), true)
  }
  await mkdir(join(root, 'sessions'), { recursive: true })
}

async function copyInto(from: string, to: string, directory: boolean, replace = false) {
  if (!directory) return cp(from, to, { force: replace })
  for (const entry of await readdir(from, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const source = join(entry.parentPath, entry.name)
    await cp(source, join(to, source.slice(from.length)), { force: replace })
  }
}
