// Settings that belong to this machine rather than to the workspace: where the
// workspace is, and which model to use. Kept as JSON in the app's data directory.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { writeAtomic } from './workspace/files'

export interface Config {
  workspace: string
  model: {
    use: 'local' | 'cloud'
    /** An OpenAI-compatible server on this machine, like LM Studio or Ollama. */
    local: { baseUrl: string; id?: string }
    cloud: { provider: string; id?: string }
  }
}

const defaults = (): Config => ({
  workspace: join(homedir(), 'Jezo'),
  model: { use: 'local', local: { baseUrl: 'http://localhost:1234/v1' }, cloud: { provider: 'anthropic' } },
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
  config = { ...base, ...stored, model: { ...base.model, ...stored.model } }
  // Tests and development point at a workspace of their own.
  if (process.env.JEZO_WORKSPACE) config.workspace = process.env.JEZO_WORKSPACE
  return config
}

export async function setConfig(change: Partial<Config>) {
  config = { ...getConfig(), ...change }
  await writeAtomic(file(), JSON.stringify(config, null, 2))
}
