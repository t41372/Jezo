// Where Jezo's agent gets its models: one list of providers, with no split
// between local and cloud (docs/design/backend.md, "Models"). pi's catalog
// brings the providers that take an API key; LM Studio and Ollama are found on
// this machine; the user can add any OpenAI-compatible server. Keys are kept
// encrypted with the OS keychain and never go back to a window.

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Api, Model } from '@earendil-works/pi-ai'
import { getSupportedThinkingLevels, InMemoryCredentialStore } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { app } from 'electron'
import type { CustomProviderInput, ModelChoices, ModelRef, PiImport, ProviderDetail, ProviderModel, ProviderSummary } from '../../shared/bridge'
import { getConfig, setConfig } from '../config'
import { getSecret, secretNames, storeSecret } from '../secrets'
import { APPLE_PROVIDER, appleProvider, availability, type AppleAvailability } from './foundation-models/provider'

/** Servers that run models on this machine, found without setup. */
const LOCAL = [
  { id: 'lmstudio', name: 'LM Studio', baseUrl: 'http://localhost:1234/v1' },
  { id: 'ollama', name: 'Ollama', baseUrl: 'http://localhost:11434/v1' },
]

/** Shown first in the list of providers that aren't set up. */
const POPULAR = ['anthropic', 'openai', 'google', 'openrouter', 'deepseek', 'mistral', 'xai', 'groq']

/** Providers that need more than a key (cloud accounts, gateways, sign-in only). They aren't offered yet. */
const NEEDS_MORE = new Set(['amazon-bedrock', 'azure-openai-responses', 'google-vertex', 'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'openai-codex'])

/** Where to get a key, for the providers most people start with. */
const KEY_URLS: Record<string, string> = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  google: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  mistral: 'https://console.mistral.ai/api-keys',
  xai: 'https://console.x.ai',
  groq: 'https://console.groq.com/keys',
}

// ─── Servers that speak the OpenAI API ───

interface ServerModel {
  id: string
  contextWindow: number
  loaded: boolean
}

/** Asks a server which chat models it has. LM Studio says more about them than the OpenAI-style list. */
async function serverModels(baseUrl: string, key?: string): Promise<ServerModel[] | null> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/v1\/?$/, '')}/api/v0/models`, { signal: AbortSignal.timeout(1500) })
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
    const headers: Record<string, string> = key ? { Authorization: `Bearer ${key}` } : {}
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3000), headers })
    if (!res.ok) return null
    const { data } = (await res.json()) as { data: { id: string }[] }
    return data.filter((m) => !/embed/i.test(m.id)).map((m) => ({ id: m.id, contextWindow: 32768, loaded: false }))
  } catch {
    return null
  }
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'server'

// ─── The service ───

interface Check {
  ok: boolean
  message?: string
  ms?: number
}

export class Providers {
  runtime!: ModelRuntime
  /** What each local or custom server said it has, or null when it didn't answer. */
  private servers = new Map<string, ServerModel[] | null>()
  private checks = new Map<string, Check>()
  private listeners = new Set<() => void>()

  private apple: AppleAvailability | undefined
  private appleBinary() {
    return app.isPackaged
      ? join(process.resourcesPath, 'bin/jezo-foundation-models')
      : join(import.meta.dirname, '../../native/foundation-models/build/jezo-foundation-models')
  }

  private async refreshApple() {
    if (process.platform !== 'darwin') return
    this.apple = await availability(this.appleBinary())
    if (this.apple.reason === 'available') {
      this.runtime.registerProvider(APPLE_PROVIDER, appleProvider(this.appleBinary(), this.apple.contextWindow!))
    } else if (this.runtime.getProvider(APPLE_PROVIDER)) {
      this.runtime.unregisterProvider(APPLE_PROVIDER)
    }
  }

  async open() {
    this.runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })
    for (const provider of secretNames()) {
      const key = getSecret(provider)
      if (key && this.runtime.getProvider(provider)) await this.runtime.setRuntimeApiKey(provider, key)
    }
    await this.refreshServers()
  }

  /** Called when anything about providers or the chosen models changes, so sessions pick up the new model. */
  onChange(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed() {
    for (const listener of this.listeners) listener()
  }

  private settings(id: string) {
    return getConfig().models.providers[id] ?? {}
  }

  private async updateSettings(id: string, change: { baseUrl?: string; disabledModels?: string[] }) {
    const models = getConfig().models
    await setConfig({ models: { ...models, providers: { ...models.providers, [id]: { ...models.providers[id], ...change } } } })
  }

  private servedProviders() {
    return [
      ...LOCAL.map((p) => ({ ...p, baseUrl: this.settings(p.id).baseUrl ?? p.baseUrl, kind: 'local' as const })),
      ...getConfig().models.custom.map((p) => ({ ...p, kind: 'custom' as const })),
    ]
  }

  /** Asks LM Studio, Ollama and the user's own servers what they have, and registers what answers. */
  async refreshServers(only?: string) {
    await Promise.all([
      ...this.servedProviders()
        .filter((p) => !only || p.id === only)
        .map(async (p) => {
          const models = await serverModels(p.baseUrl, getSecret(p.id))
          this.servers.set(p.id, models)
          if (!models?.length) return this.runtime.getProvider(p.id) && this.runtime.unregisterProvider(p.id)
          this.runtime.registerProvider(p.id, {
            name: p.name,
            baseUrl: p.baseUrl,
            api: 'openai-completions',
            apiKey: getSecret(p.id) ?? 'none',
            models: models.map((m) => ({
              id: m.id,
              name: m.id,
              input: ['text'],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              reasoning: true,
              contextWindow: m.contextWindow,
              maxTokens: 8192,
            })),
          })
        }),
      ...(!only || only === APPLE_PROVIDER ? [this.refreshApple()] : []),
    ])
    this.changed()
  }

  private summary(id: string): ProviderSummary | null {
    if (id === APPLE_PROVIDER) {
      if (!this.apple) return null
      return { id, name: 'Apple Foundation Models', kind: 'local',
        state: this.apple.reason !== 'available' ? 'off' : this.checks.get(id)?.ok === false ? 'error' : 'ready' }
    }
    const served = this.servedProviders().find((p) => p.id === id)
    const check = this.checks.get(id)
    if (served) {
      const models = this.servers.get(id)
      return { id, name: served.name, kind: served.kind, state: check?.ok === false ? 'error' : models?.length ? 'ready' : 'off' }
    }
    const provider = this.runtime.getProvider(id)
    if (!provider || NEEDS_MORE.has(id) || !provider.auth.apiKey) return null
    const key = getSecret(id)
    return {
      id,
      name: provider.name,
      kind: 'cloud',
      state: !key ? 'off' : check?.ok === false ? 'error' : 'ready',
      ...(key && { keyHint: `…${key.slice(-4)}` }),
      ...(POPULAR.includes(id) && { popular: true }),
    }
  }

  list(): ProviderSummary[] {
    const cloud = this.runtime
      .getProviders()
      .map((p) => p.id)
      .filter((id) => id !== APPLE_PROVIDER && !this.servedProviders().some((p) => p.id === id))
    const all = [...this.servedProviders().map((p) => p.id), ...(this.apple ? [APPLE_PROVIDER] : []), ...cloud].flatMap((id) => this.summary(id) ?? [])
    const rank = (p: ProviderSummary) => (p.popular ? POPULAR.indexOf(p.id) : 100)
    return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  }

  private models(id: string): ProviderModel[] {
    const disabled = new Set(this.settings(id).disabledModels ?? [])
    const served = this.servers.get(id)
    const loaded = new Set((served ?? []).filter((m) => m.loaded).map((m) => m.id))
    return this.runtime.getModels(id).map((m) => ({
      id: m.id,
      name: m.name,
      // A server's models are registered as reasoning so thinking is passed through, but the server
      // never said they reason; only pi's catalog knows, so only its models say so (principle 7).
      image: m.input.includes('image'),
      reasoning: !served && m.reasoning,
      contextWindow: m.contextWindow,
      ...(m.cost.input || m.cost.output ? { cost: { input: m.cost.input, output: m.cost.output } } : {}),
      ...(loaded.has(m.id) && { loaded: true }),
      enabled: !disabled.has(m.id),
    }))
  }

  detail(id: string): ProviderDetail {
    const summary = this.summary(id)
    if (!summary) throw new Error(`There is no provider ${id}.`)
    if (id === APPLE_PROVIDER) return {
      ...summary, needsKey: false, canRefresh: true, models: this.models(id),
      appleAvailability: this.apple!.reason, lastCheck: this.checks.get(id),
    }
    const served = this.servedProviders().find((p) => p.id === id)
    return {
      ...summary,
      baseUrl: served?.baseUrl ?? this.runtime.getProvider(id)?.baseUrl,
      ...(served?.kind === 'local' && { defaultBaseUrl: LOCAL.find((p) => p.id === id)!.baseUrl }),
      needsKey: summary.kind === 'cloud',
      ...(KEY_URLS[id] && { keyUrl: KEY_URLS[id] }),
      canRefresh: summary.kind !== 'cloud',
      models: this.models(id),
      ...(this.checks.get(id) && { lastCheck: this.checks.get(id) }),
    }
  }

  async setKey(id: string, key: string | null) {
    if (id === APPLE_PROVIDER) throw new Error('Apple Foundation Models does not use an API key.')
    await storeSecret(id, key)
    this.checks.delete(id)
    if (this.servedProviders().some((p) => p.id === id)) await this.refreshServers(id)
    else if (key) await this.runtime.setRuntimeApiKey(id, key)
    else await this.runtime.removeRuntimeApiKey(id)
    this.changed()
    return this.detail(id)
  }

  async setBaseUrl(id: string, baseUrl: string) {
    if (id === APPLE_PROVIDER) throw new Error('Apple Foundation Models runs on this Mac and has no server address.')
    const custom = getConfig().models.custom.find((p) => p.id === id)
    if (custom) {
      const models = getConfig().models
      await setConfig({ models: { ...models, custom: models.custom.map((p) => (p.id === id ? { ...p, baseUrl } : p)) } })
    } else {
      await this.updateSettings(id, { baseUrl })
    }
    this.checks.delete(id)
    await this.refreshServers(id)
    return this.detail(id)
  }

  async refresh(id: string) {
    this.checks.delete(id)
    await this.refreshServers(id)
    return this.detail(id)
  }

  async setModelEnabled(id: string, model: string, enabled: boolean) {
    const disabled = new Set(this.settings(id).disabledModels ?? [])
    if (enabled) disabled.delete(model)
    else disabled.add(model)
    await this.updateSettings(id, { disabledModels: [...disabled] })
    this.changed()
    return this.detail(id)
  }

  /** Sends a one-word request, to see that the key, the address and the model work. */
  async check(id: string, modelId: string) {
    const model = this.runtime.getModel(id, modelId)
    if (!model) throw new Error(`${id} has no model ${modelId}.`)
    const started = Date.now()
    try {
      const reply = await this.runtime.completeSimple(
        model,
        { messages: [{ role: 'user', content: 'Reply with the word OK.', timestamp: Date.now() }] },
        { signal: AbortSignal.timeout(60_000) },
      )
      const ok = reply.stopReason !== 'error' && reply.stopReason !== 'aborted'
      this.checks.set(id, ok ? { ok, ms: Date.now() - started } : { ok, message: reply.errorMessage ?? 'The provider returned an error.' })
    } catch (error) {
      this.checks.set(id, { ok: false, message: error instanceof Error ? error.message : String(error) })
    }
    this.changed()
    return this.detail(id)
  }

  async addCustom(input: CustomProviderInput) {
    const models = getConfig().models
    let id = `custom-${slug(input.name)}`
    for (let n = 2; models.custom.some((p) => p.id === id) || this.runtime.getProvider(id); n++) id = `custom-${slug(input.name)}-${n}`
    await setConfig({ models: { ...models, custom: [...models.custom, { id, name: input.name.trim(), baseUrl: input.baseUrl.trim() }] } })
    if (input.key) await storeSecret(id, input.key)
    await this.refreshServers(id)
    return this.detail(id)
  }

  async remove(id: string) {
    const models = getConfig().models
    if (!models.custom.some((p) => p.id === id)) throw new Error('Only providers you added can be removed.')
    const { [id]: _, ...providers } = models.providers
    await setConfig({ models: { ...models, custom: models.custom.filter((p) => p.id !== id), providers } })
    await storeSecret(id, null)
    this.servers.delete(id)
    if (this.runtime.getProvider(id)) this.runtime.unregisterProvider(id)
    this.changed()
  }

  // ─── Which model the agent uses ───

  /** Models the pickers offer: the enabled models of providers that are ready. */
  /** Models the agent can run on. Apple's on-device model isn't one: its context is too small, so it only does small tasks (small()). */
  choosable() {
    return this.list()
      .filter((p) => p.state === 'ready' && p.id !== APPLE_PROVIDER)
      .flatMap((p) => this.models(p.id).filter((m) => m.enabled).map((model) => ({ provider: p.id, providerName: p.name, model })))
  }

  private usable(ref: ModelRef | null | undefined) {
    return ref && this.summary(ref.provider)?.state !== 'off' && this.runtime.getModel(ref.provider, ref.id) ? ref : null
  }

  /**
   * The model for a role. The user's pick if it can be used; otherwise one that
   * works without asking: a model a local server already has loaded, then the
   * first model of a provider that's set up. Background work uses the main
   * model unless it has its own.
   */
  resolve(role: 'main' | 'background'): ModelRef | null {
    const { main, background } = getConfig().models
    if (role === 'background' && this.usable(background)) return background!
    if (this.usable(main)) return main!
    const choosable = this.choosable()
    const pick = choosable.find((c) => c.model.loaded) ?? choosable[0]
    return pick ? { provider: pick.provider, id: pick.model.id } : null
  }

  /**
   * The model for small, bounded tasks, like naming a conversation: Apple's
   * on-device model when this Mac has it ready, since it's private and quick and
   * its small context is enough for them; otherwise the background model.
   */
  small(): Model<Api> | null {
    return this.runtime.getModel(APPLE_PROVIDER, 'system') ?? this.model('background')
  }

  model(role: 'main' | 'background'): Model<Api> | null {
    const ref = this.resolve(role)
    return ref ? (this.runtime.getModel(ref.provider, ref.id) ?? null) : null
  }

  /** The levels a model can think at, lowest first. */
  thinkingLevels(model: Model<Api> | null): string[] {
    return model ? getSupportedThinkingLevels(model) : []
  }

  /** The configured level, or the nearest one the model has. */
  thinking(model: Model<Api> | null): string {
    const levels = this.thinkingLevels(model)
    const wanted = getConfig().models.thinking
    if (!levels.length || levels.includes(wanted)) return wanted
    const order = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    return levels.reduce((best, l) => (Math.abs(order.indexOf(l) - order.indexOf(wanted)) < Math.abs(order.indexOf(best) - order.indexOf(wanted)) ? l : best))
  }

  choices(): ModelChoices {
    const { main, background } = getConfig().models
    const label = (ref: ModelRef | null) => ref && { ...ref, providerName: this.summary(ref.provider)?.name ?? ref.provider }
    const model = this.model('main')
    return {
      main: label(this.resolve('main')),
      mainIsAutomatic: !this.usable(main),
      background: label(this.usable(background)),
      thinking: this.thinking(model),
      thinkingLevels: this.thinkingLevels(model),
    }
  }

  async setThinking(level: string) {
    await setConfig({ models: { ...getConfig().models, thinking: level } })
    this.changed()
    return this.choices()
  }

  /**
   * Brings over what the user set up for their own pi: keys from auth.json,
   * OpenAI-compatible servers from models.json, and the default model and
   * thinking level from settings.json. Runs only when the user asks; Jezo
   * never reads ~/.pi on its own (docs/design/backend.md, "Isolation").
   */
  async importFromPi(): Promise<PiImport> {
    const dir = join(homedir(), '.pi', 'agent')
    const read = (name: string) => {
      try {
        return JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>
      } catch {
        return {}
      }
    }
    const result: PiImport = { providers: [], keys: 0, model: null, skipped: [] }
    // $NAME and ${NAME} read the environment; a leading ! runs a command, which Jezo doesn't do.
    const resolveKey = (value: unknown) => {
      if (typeof value !== 'string' || value.startsWith('!')) return undefined
      const env = /^\$\{?([A-Z_][A-Z0-9_]*)\}?$/.exec(value)
      return env ? process.env[env[1]] : value
    }

    for (const [provider, credential] of Object.entries(read('auth.json'))) {
      const key = (credential as { type?: string; key?: string }).type === 'api_key' ? (credential as { key?: string }).key : undefined
      if (key && this.runtime.getProvider(provider)) {
        await this.setKey(provider, key)
        result.keys++
      }
    }

    const providers = (read('models.json').providers ?? {}) as Record<string, { baseUrl?: string; api?: string; apiKey?: unknown; name?: string }>
    for (const [id, p] of Object.entries(providers)) {
      if (!p.baseUrl) continue
      if (p.api && p.api !== 'openai-completions') {
        result.skipped.push({ name: p.name ?? id, why: 'api' })
        continue
      }
      if (typeof p.apiKey === 'string' && p.apiKey.startsWith('!')) result.skipped.push({ name: p.name ?? id, why: 'command' })
      const local = LOCAL.find((l) => l.id === id || l.baseUrl.replace('localhost', '127.0.0.1') === p.baseUrl!.replace('localhost', '127.0.0.1'))
      if (local) {
        if (p.baseUrl !== this.detail(local.id).baseUrl) await this.setBaseUrl(local.id, p.baseUrl)
        continue
      }
      if (getConfig().models.custom.some((c) => c.baseUrl === p.baseUrl)) continue
      await this.addCustom({ name: p.name ?? id, baseUrl: p.baseUrl, key: resolveKey(p.apiKey) })
      result.providers.push(p.name ?? id)
    }

    const settings = read('settings.json') as { defaultProvider?: string; defaultModel?: string; defaultThinkingLevel?: string }
    if (settings.defaultProvider && settings.defaultModel) {
      const provider =
        [...LOCAL, ...getConfig().models.custom].find((p) => p.id === settings.defaultProvider || providers[settings.defaultProvider!]?.baseUrl === p.baseUrl)?.id ??
        settings.defaultProvider
      if (this.runtime.getModel(provider, settings.defaultModel)) {
        await this.choose('main', { provider, id: settings.defaultModel })
        result.model = settings.defaultModel
      }
    }
    if (settings.defaultThinkingLevel) await this.setThinking(settings.defaultThinkingLevel)
    this.changed()
    return result
  }

  async choose(role: 'main' | 'background', ref: ModelRef | null) {
    if (ref?.provider === APPLE_PROVIDER) throw new Error("Apple's on-device model can read too little at once to run the agent; Jezo uses it for small tasks.")
    await setConfig({ models: { ...getConfig().models, [role]: ref } })
    this.changed()
    return this.choices()
  }
}
