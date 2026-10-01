// Installs the user's methods into skills/. Text goes through the workspace,
// so an agent's installs can be undone (docs/design/skills.md).

import { chmod, lstat, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import type { SkillInstallResult, SkillOrigin, SkillPreview } from '../../shared/skills'
import { currentActing } from '../agent/acting'
import { hashOf, newId, readIfExists } from './files'
import { patch } from './frontmatter'
import { archiveEntries, checkDownloadSize, discoverSkills, normalizeName, parseSource, textOf, usableEntries, type FoundSkill, type SkillFile, type Skipped } from './skill-source'
import type { Workspace } from './workspace'

// Tests point these at a local server that answers the way GitHub does.
const GITHUB_API = process.env.JEZO_GITHUB_API ?? 'https://api.github.com'
const GITHUB_CODELOAD = process.env.JEZO_GITHUB_CODELOAD ?? 'https://codeload.github.com'
const RECORD = 'skills/installed.yaml'

interface Prepared {
  source: string
  ref?: string
  skills: FoundSkill[]
  skipped: Skipped[]
  /** Updating keeps its directory, even if its title changed. */
  update?: { name: string; hash?: string }
}

export async function installedSkills(workspace: Pick<Workspace, 'abs'>): Promise<SkillOrigin[]> {
  const text = await readIfExists(workspace.abs(RECORD))
  if (text === null) return []
  const doc = parseYaml(text) as { skills?: SkillOrigin[] } | null
  if (!Array.isArray(doc?.skills)) throw new Error('skills/installed.yaml needs a skills list.')
  return doc.skills
}

async function saveOrigins(workspace: Workspace, skills: SkillOrigin[]) {
  const header = '# Methods installed in this workspace, where they came from, and who installed them.\n\n'
  await workspace.writeFile(RECORD, header + stringifyYaml({ skills }), currentActing().actor)
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`Can't read ${url}: ${response.status} ${response.statusText}`.trim())
  const reader = response.body?.getReader()
  if (!reader) throw new Error(`The address returned no files: ${url}`)
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    checkDownloadSize(Number(response.headers.get('content-length') ?? 0))
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.length
      checkDownloadSize(size)
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel()
    throw error
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
  return bytes
}

/** The unified installer inspects this same download for a pi manifest. */
export async function remoteFiles(source: string, refOverride?: string) {
  source = source.trim()
  const address = parseSource(source)
  let ref = refOverride ?? address.ref
  let bytes: Uint8Array
  if (address.kind === 'github') {
    if (!ref) {
      const url = `${GITHUB_API}/repos/${address.owner}/${address.repo}`
      const data = JSON.parse(new TextDecoder().decode(await download(url))) as { default_branch?: string }
      if (!data.default_branch) throw new Error('GitHub did not report a default branch for this repository.')
      ref = data.default_branch
    }
    bytes = await download(`${GITHUB_CODELOAD}/${address.owner}/${address.repo}/tar.gz/${encodeURIComponent(ref)}`)
  } else bytes = await download(source)
  const tree = archiveEntries(bytes, address.kind === 'github' ? 'tar.gz' : new URL(source).pathname, address.kind === 'github')
  return { ...tree, ref, address }
}

export async function prepareRemote(source: string, refOverride?: string, selectedPath?: string, downloaded?: Awaited<ReturnType<typeof remoteFiles>>): Promise<Prepared> {
  source = source.trim()
  const tree = downloaded ?? await remoteFiles(source, refOverride)
  const { address, ref } = tree
  const path = address.path ?? selectedPath
  const entries = path === undefined ? tree.entries : tree.entries.filter((f) => !path || f.path.startsWith(`${path}/`))
  let skills = discoverSkills(entries)
  if (path !== undefined) skills = skills.filter((s) => s.path === path)
  if (!skills.length) throw new Error(path !== undefined ? `There is no SKILL.md at "${path || '.'}" in this source.` : 'No methods found: the source has no SKILL.md.')
  return { source, ...(ref ? { ref } : {}), skills, skipped: tree.skipped }
}

/** Reads a real folder without following links. Also used when removing an installed skill. */
export async function folderFiles(root: string, includeHidden = false): Promise<SkillFile[]> {
  const files: SkillFile[] = []
  const visit = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = prefix + entry.name
      const absolute = join(dir, entry.name)
      if (entry.isSymbolicLink()) files.push({ path, type: 'symlink', data: new Uint8Array() })
      else if (entry.isDirectory()) {
        if (includeHidden || (!entry.name.startsWith('.') && entry.name !== 'node_modules')) await visit(absolute, `${path}/`)
      } else if (entry.isFile()) {
        const info = await lstat(absolute)
        files.push({ path, type: 'file', data: await readFile(absolute), executable: !!(info.mode & 0o111) })
      }
    }
  }
  await visit(root, '')
  return files
}

async function exists(path: string) {
  try { await lstat(path); return true } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

export class SkillInstaller {
  private previews = new Map<string, Prepared>()
  /** Mutations share installed.yaml; keep them in order so no entry gets lost. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private workspace: Workspace) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }

  private async preview(prepared: Prepared): Promise<SkillPreview> {
    const token = newId('skill')
    this.previews.set(token, prepared)
    return {
      token,
      skills: prepared.skills.map(({ files, ...skill }) => ({ ...skill, files: files.length })),
      skipped: prepared.skipped,
      ...(prepared.update ? { modified: await this.modified(prepared) } : {}),
    }
  }

  async remote(source: string, downloaded?: Awaited<ReturnType<typeof remoteFiles>>) { return this.preview(await prepareRemote(source, undefined, undefined, downloaded)) }

  async local(path: string) {
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error('Choose a folder or archive, rather than a symbolic link.')
    let tree: { entries: SkillFile[]; skipped: Skipped[] }
    if (info.isDirectory()) tree = usableEntries(await folderFiles(path))
    else {
      if (!/\.(zip|skill|tar\.gz|tgz)$/i.test(path)) throw new Error('Choose a .zip, .skill, .tar.gz or .tgz archive.')
      checkDownloadSize(info.size)
      tree = archiveEntries(await readFile(path), path)
    }
    const skills = discoverSkills(tree.entries)
    if (!skills.length) throw new Error('No methods found: the source has no SKILL.md.')
    return this.preview({ source: 'this computer', skills, skipped: tree.skipped })
  }

  async update(id: string) {
    const name = topLevelName(id)
    const origin = (await installedSkills(this.workspace)).find((s) => s.name === name)
    if (!origin || !/^https?:\/\//.test(origin.source)) throw new Error('This method has no address to update from.')
    const prepared = await prepareRemote(origin.source, origin.ref, origin.path ?? '')
    prepared.skills = prepared.skills.filter((s) => s.path === (origin.path ?? ''))
    if (prepared.skills.length !== 1) throw new Error(`The source no longer has the method at "${origin.path || '.'}".`)
    if (prepared.skills[0].name !== name) throw new Error(`The source renamed this method to "${prepared.skills[0].name}". Add it as a new method.`)
    prepared.update = { name, hash: origin.hash }
    return this.preview(prepared)
  }

  discard(token: string) { this.previews.delete(token) }

  async install(token: string, paths: string[], replace = false, overwriteModified = false) {
    return this.serial(async () => {
      const prepared = this.previews.get(token)
      if (!prepared) throw new Error('Read the source again before installing it.')
      const selected = prepared.skills.filter((s) => paths.includes(s.path))
      if (!selected.length || paths.some((p) => !selected.some((s) => s.path === p))) throw new Error('Choose at least one method from the source.')
      if (prepared.update && await this.modified(prepared) && !overwriteModified) {
        return { installed: [], skipped: prepared.skipped, conflicts: [], modified: true }
      }
      const result = await this.installNow(prepared, selected, replace)
      if (!result.conflicts.length) this.discard(token)
      return result
    })
  }

  async write(input: { name: string; description: string; instructions: string }, replace = false) {
    if (!input.name.trim() || !input.description.trim() || !input.instructions.trim()) throw new Error('A name, description and instructions are needed.')
    if (input.description.trim().includes('\n')) throw new Error('Keep the description to one line.')
    const name = normalizeName(input.name)
    const text = patch('', { name, description: input.description.trim(), metadata: { title: input.name.trim() } }, input.instructions + '\n')
    const skills = discoverSkills([{ path: 'SKILL.md', type: 'file', data: new TextEncoder().encode(text) }])
    return this.serial(() => this.installNow({ source: 'written', skills, skipped: [] }, skills, replace))
  }

  private async modified(prepared: Prepared) {
    const update = prepared.update
    if (!update?.hash) return false
    const text = await readIfExists(this.workspace.abs(`skills/${update.name}/SKILL.md`))
    return text !== null && hashOf(text) !== update.hash
  }

  /** The tool can inspect a multi-skill source without installing any of it. */
  async agentInstall(source: string, path?: string, replace = false) {
    const prepared = await prepareRemote(source, undefined, path)
    if (path === undefined && prepared.skills.length > 1) {
      return { choices: prepared.skills.map(({ path, name, description }) => ({ path, name, description })), skipped: prepared.skipped }
    }
    const selected = path === undefined ? prepared.skills : prepared.skills.filter((s) => s.path === path)
    if (!selected.length) throw new Error(`There is no method at "${path}". Available paths: ${prepared.skills.map((s) => s.path || '.').join(', ')}.`)
    const result = await this.serial(() => this.installNow(prepared, selected, replace))
    if (result.conflicts.length) throw new Error(`Already installed: ${result.conflicts.join(', ')}. Call again with replace: true only if the user asked to replace it.`)
    return { result }
  }

  private async installNow(prepared: Prepared, selected: FoundSkill[], replace: boolean): Promise<SkillInstallResult> {
    const names = new Set<string>()
    const conflicts: string[] = []
    for (const skill of selected) {
      if (names.has(skill.name)) throw new Error(`Two methods in this source normalize to "${skill.name}". Choose one at a time.`)
      names.add(skill.name)
      if (!replace && await exists(this.workspace.abs(`skills/${skill.name}`))) conflicts.push(skill.title)
    }
    const result: SkillInstallResult = { installed: [], skipped: prepared.skipped, conflicts }
    if (conflicts.length) return result
    const origins = await installedSkills(this.workspace)
    const actor = currentActing().actor
    for (const skill of selected) {
      const dir = `skills/${skill.name}`
      if (await exists(this.workspace.abs(dir))) await this.removeFiles(dir)
      const binary: string[] = []
      let installedText = ''
      for (const file of skill.files) {
        let text = textOf(file.data)
        if (file.path === 'SKILL.md') {
          text = patch(text!, { name: skill.name, 'disable-model-invocation': undefined })
          installedText = text
        }
        // Everything goes through the workspace, so undo takes back bytes as well as text.
        await this.workspace.writeFile(`${dir}/${file.path}`, text ?? file.data, actor)
        if (text === null) binary.push(file.path)
        if (file.executable) await chmod(this.workspace.abs(`${dir}/${file.path}`), 0o755)
      }
      const origin: SkillOrigin = {
        name: skill.name, source: prepared.source, installed: new Date().toISOString(), by: actor.by === 'agent' ? 'agent' : 'user',
        ...(prepared.source !== 'written' ? { hash: hashOf(installedText), path: skill.path } : {}),
        ...(prepared.ref ? { ref: prepared.ref } : {}), ...(binary.length ? { binary } : {}),
      }
      const previous = origins.findIndex((o) => o.name === skill.name)
      if (previous < 0) origins.push(origin)
      else origins[previous] = origin
      result.installed.push({ name: skill.name, title: skill.title, directory: dir, files: skill.files.length, ...(binary.length ? { binary: binary.length } : {}) })
    }
    await saveOrigins(this.workspace, origins)
    return result
  }

  async remove(id: string) {
    const name = topLevelName(id)
    return this.serial(async () => {
      const origins = await installedSkills(this.workspace)
      await this.removeFiles(id)
      await saveOrigins(this.workspace, origins.filter((o) => o.name !== name))
    })
  }

  private async removeFiles(dir: string) {
    const absolute = this.workspace.abs(dir)
    if (!await exists(absolute)) return
    // A previous skill's links must not make replacement write outside its directory.
    if ((await lstat(absolute)).isSymbolicLink()) throw new Error(`The skill directory ${dir} is a symbolic link. Choose a regular directory.`)
    for (const file of await folderFiles(absolute, true)) {
      if (file.type !== 'file') await rm(this.workspace.abs(`${dir}/${file.path}`), { force: true })
      else await this.workspace.removeFile(`${dir}/${file.path}`, currentActing().actor)
    }
    await rm(absolute, { recursive: true, force: true })
  }
}

function topLevelName(id: string) {
  if (!/^skills\/[^/]+$/.test(id) || ['.', '..'].includes(id.slice(7))) throw new Error('Only methods in the workspace’s top-level skills directory can be removed or updated.')
  return id.slice(7)
}

const installers = new WeakMap<Workspace, SkillInstaller>()

export function skillInstaller(workspace: Workspace) {
  let installer = installers.get(workspace)
  if (!installer) { installer = new SkillInstaller(workspace); installers.set(workspace, installer) }
  return installer
}
