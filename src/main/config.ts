// Settings that belong to this machine rather than to the workspace: where the
// workspace is, and the model providers. Kept as JSON in the app's data
// directory; keys are elsewhere, encrypted (agent/providers.ts).

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { writeAtomic } from './workspace/files'

export interface Config {
  workspace: string
  models: {
    /** The model the agent uses. Null lets Jezo pick one that works. */
    main: { provider: string; id: string } | null
    /** For work Jezo starts on its own, like sorting notes. Null uses the main model. */
    background: { provider: string; id: string } | null
    /** How hard the model thinks before answering, where the model supports it. */
    thinking: string
    /** Per provider: a different address, and models turned off in the pickers. */
    providers: Record<string, { baseUrl?: string; disabledModels?: string[] }>
    /** OpenAI-compatible servers the user added. */
    custom: { id: string; name: string; baseUrl: string }[]
  }
}

const defaults = (): Config => ({
  workspace: join(homedir(), 'Jezo'),
  models: { main: null, background: null, thinking: 'medium', providers: {}, custom: [] },
})

const file = () => join(app.getPath('userData'), 'config.json')

let config: Config | null = null

export function getConfig(): Config {
  if (config) return config
  let stored: Partial<Config> = {}
  try {
    stored = JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    // No config yet, or an unreadable one: start from the defaults.
  }
  const base = defaults()
  const { model: _older, ...rest } = stored as Partial<Config> & { model?: unknown }
  config = { ...base, ...rest, models: { ...base.models, ...rest.models } }
  // Tests and development point at a workspace of their own.
  if (process.env.JEZO_WORKSPACE) config.workspace = process.env.JEZO_WORKSPACE
  return config
}

export async function setConfig(change: Partial<Config>) {
  config = { ...getConfig(), ...change }
  await writeAtomic(file(), JSON.stringify(config, null, 2))
}
