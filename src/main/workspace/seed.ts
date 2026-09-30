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
 * Copies the shipped files into the workspace, never over a file that's there.
 * Skills come in the language the app is in; Traditional Chinese is the base,
 * and other languages replace the files they have.
 */
export async function seedWorkspace(root: string, language: string) {
  await mkdir(root, { recursive: true })
  const overlay = join(resources(), `workspace.${language}`)
  if (await exists(overlay)) await copyMissing(overlay, root)
  await copyMissing(join(resources(), 'workspace'), root)
  await mkdir(join(root, 'sessions'), { recursive: true })
}

async function copyMissing(from: string, to: string) {
  for (const entry of await readdir(from, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue
    const source = join(entry.parentPath, entry.name)
    const target = join(to, source.slice(from.length))
    if (!(await exists(target))) await cp(source, target)
  }
}
