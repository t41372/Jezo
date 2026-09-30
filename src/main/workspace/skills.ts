// Skills are the agent's methods, one SKILL.md per directory, in the workspace's
// skills/ and each plugin's skills/ (AGENTS.md, principle 5). Turning one off
// sets pi's own `disable-model-invocation`, so the agent no longer sees it.

import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { SkillInfo } from '../../shared/bridge'
import { readIfExists } from './files'
import { parse, patch } from './frontmatter'
import type { Workspace } from './workspace'

const OFF = 'disable-model-invocation'

/** The directories skills live in, relative to the workspace. */
export async function skillRoots(root: string) {
  const roots: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'sessions') continue
    if (entry.name === 'skills') roots.push('skills')
    else if (await readdir(join(root, entry.name, 'skills')).then(() => true, () => false)) roots.push(`${entry.name}/skills`)
  }
  return roots
}

export async function listSkills(root: string): Promise<SkillInfo[]> {
  const skills: SkillInfo[] = []
  for (const dir of await skillRoots(root)) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const id = `${dir}/${entry.name}`
      const text = await readIfExists(join(root, id, 'SKILL.md'))
      if (text === null) continue
      try {
        const { data, body } = parse(text)
        const metadata = (data.metadata ?? {}) as Record<string, unknown>
        skills.push({
          id,
          name: String(data.name ?? entry.name),
          title: String(metadata.title ?? data.name ?? entry.name),
          description: String(data.description ?? ''),
          enabled: data[OFF] !== true,
          instructions: body.trim(),
        })
      } catch {
        skills.push({ id, name: entry.name, title: entry.name, description: '', enabled: false, instructions: text, broken: true })
      }
    }
  }
  return skills
}

export async function setSkillEnabled(workspace: Workspace, id: string, enabled: boolean) {
  const path = `${id}/SKILL.md`
  const text = await readIfExists(workspace.abs(path))
  if (text === null) throw new Error(`There is no skill ${id}.`)
  await workspace.writeFile(path, patch(text, { [OFF]: enabled ? undefined : true }), { by: 'user' }, text)
}
