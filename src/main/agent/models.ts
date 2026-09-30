// Which model Jezo's agent talks to. A local one is any OpenAI-compatible
// server on this machine (LM Studio, Ollama); a cloud one needs a key, which is
// kept encrypted with the OS keychain (docs/design/backend.md, "Models").

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Model, Api } from '@earendil-works/pi-ai'
import { InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { app, safeStorage } from 'electron'
import type { ModelStatus } from '../../shared/bridge'
import type { Config } from '../config'
import { writeAtomic } from '../workspace/files'

/** The cloud providers 設定 offers. OpenRouter reaches most other models with one key. */
export const CLOUD_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'google', name: 'Google' },
  { id: 'openrouter', name: 'OpenRouter' },
] as const

/** Where local model servers listen by default: LM Studio, then Ollama. */
const LOCAL_SERVERS = [
  { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
]

const keysFile = () => join(app.getPath('userData'), 'keys.json')

function readKeys(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(keysFile(), 'utf8'))
  } catch {
    return {}
  }
}

export function getKey(provider: string) {
  const stored = readKeys()[provider]
  return stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : undefined
}

export async function setKey(provider: string, key: string | null) {
  const keys = readKeys()
  if (key) keys[provider] = safeStorage.encryptString(key).toString('base64')
  else delete keys[provider]
  await writeAtomic(keysFile(), JSON.stringify(keys))
}

interface LocalModel {
  id: string
  contextWindow: number
  loaded: boolean
}

/** Asks a local server which chat models it has. LM Studio says more about them than the OpenAI-style list. */
async function localModels(baseUrl: string): Promise<LocalModel[]> {
  const signal = AbortSignal.timeout(1500)
  try {
    const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/v0/models`, { signal })
    if (res.ok) {
      const { data } = (await res.json()) as { data: { id: string; type: string; state: string; loaded_context_length?: number; max_context_length?: number }[] }
      return data
        .filter((m) => m.type === 'llm' || m.type === 'vlm')
        .map((m) => ({ id: m.id, contextWindow: m.loaded_context_length ?? m.max_context_length ?? 32768, loaded: m.state === 'loaded' }))
    }
  } catch {
    // Not LM Studio; try the OpenAI-style list.
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(1500) })
    if (!res.ok) return []
    const { data } = (await res.json()) as { data: { id: string }[] }
    return data.filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id, contextWindow: 32768, loaded: false }))
  } catch {
    return []
  }
}

/** The local server to use: the one configured if it answers, otherwise the first default that does. */
async function findLocal(config: Config['model']['local']) {
  const candidates = [{ name: LOCAL_SERVERS.find((s) => s.baseUrl === config.baseUrl)?.name ?? config.baseUrl, baseUrl: config.baseUrl }, ...LOCAL_SERVERS]
  for (const server of candidates) {
    const models = await localModels(server.baseUrl)
    if (models.length) return { ...server, models }
  }
  return null
}

/** The one the user picked if it's still there; otherwise one that's loaded, so the first answer doesn't wait on loading. */
const chooseLocal = (models: LocalModel[], id?: string) => models.find((m) => m.id === id) ?? models.find((m) => m.loaded) ?? models[0]

/** What 設定 shows about models. */
export async function modelStatus(config: Config['model']): Promise<ModelStatus> {
  const local = await findLocal(config.local)
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })
  const provider = config.cloud.provider
  return {
    use: config.use,
    local: local
      ? { server: local.name, models: local.models.map((m) => ({ id: m.id, loaded: m.loaded })), id: chooseLocal(local.models, config.local.id).id }
      : null,
    cloud: {
      providers: CLOUD_PROVIDERS.map((p) => ({ ...p, hasKey: Boolean(readKeys()[p.id]) })),
      provider,
      models: runtime.getModels(provider).map((m) => m.id),
      id: config.cloud.id ?? runtime.getModels(provider)[0]?.id ?? null,
    },
  }
}

export interface Models {
  runtime: ModelRuntime
  /** The model to use, or null when none is reachable. */
  model: Model<Api> | null
}

export async function createModels(config: Config['model']): Promise<Models> {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })

  if (config.use === 'cloud') {
    const key = getKey(config.cloud.provider)
    if (!key) return { runtime, model: null }
    await runtime.setRuntimeApiKey(config.cloud.provider, key)
    const models = runtime.getModels(config.cloud.provider)
    const model = (config.cloud.id && runtime.getModel(config.cloud.provider, config.cloud.id)) || models[0] || null
    return { runtime, model }
  }

  const local = await findLocal(config.local)
  if (!local) return { runtime, model: null }
  const available = local.models
  runtime.registerProvider('local', {
    name: local.name,
    baseUrl: local.baseUrl,
    api: 'openai-completions',
    apiKey: 'local',
    models: available.map((m) => ({
      id: m.id,
      name: m.id,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      reasoning: true,
      contextWindow: m.contextWindow,
      maxTokens: 8192,
    })),
  })
  const chosen = chooseLocal(available, config.local.id)
  return { runtime, model: runtime.getModel('local', chosen.id) ?? null }
}
