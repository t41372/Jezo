// Package and artifact management stays separate from microphone sessions.
// Python speaks the installed SDK; Jezo never keeps its own engine catalog.
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { SpeechStatus } from '../../shared/bridge'
import type {
  SpeechArtifactReport,
  SpeechCommand,
  SpeechDiagnostic,
  SpeechInventory,
  SpeechModelDetail,
  SpeechModelSettings,
  SpeechPackage,
  SpeechUpdate,
} from '../../shared/speech'
import { getConfig, setConfig } from '../config'
import { getSecret, secretNames, storeSecret } from '../secrets'
import { speechError } from './errors'

const run = promisify(execFile)
const CORE_REPO = 'https://github.com/standard-voice/standard_asr.git'
const CORE_COMMIT = '97bfdb28134c114088ec335596aa6bca53f9204f'
const CORE_REQUIREMENT = `standard-asr[audio] @ git+${CORE_REPO}@${CORE_COMMIT}`

/** Suggestions for first setup. Installed entry points, never these suggestions, are the catalog. */
export const preferred =
  process.platform === 'darwin' && process.arch === 'arm64'
    ? {
        name: 'Qwen3-ASR 0.6B',
        model: 'mlx-audio/qwen3-asr-0.6b',
        requirement:
          'std-mlx-audio @ git+https://github.com/standard-voice/std-mlx-audio.git@080beb1b89ed1795532c70cf1ef3db465ae8657c',
      }
    : {
        name: 'Whisper small',
        model: 'faster-whisper/small',
        requirement:
          'std-faster-whisper @ git+https://github.com/standard-voice/std-faster-whisper.git@aee319ff713d0e1d3656609954097fc1cdbfc8ef',
      }

export const speechDir = () => join(app.getPath('userData'), 'speech')
export const speechBin = (name: string) =>
  join(
    speechDir(),
    'venv',
    process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? `${name}.exe` : name,
  )
export const adapterPath = () =>
  app.isPackaged
    ? join(process.resourcesPath, 'standard-asr.py')
    : join(import.meta.dirname, '../../resources/standard-asr.py')
const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-')
const secretPrefix = (model: string) => `speech:${model}:`
const packageSecret = (name: string) => `speech-package-source:${normalize(name)}`
const emptySettings = (): SpeechModelSettings => ({ config: {}, options: {}, provider: {} })

function requirementUrl(requirement: string) {
  const match = requirement.match(/(?:git\+)?https?:\/\/[^\s]+/)
  if (!match) return null
  return { text: match[0], git: match[0].startsWith('git+'), url: new URL(match[0].replace(/^git\+/, '')) }
}

function publicRequirement(requirement: string) {
  const parsed = requirementUrl(requirement)
  if (!parsed) return requirement
  parsed.url.username = ''
  parsed.url.password = ''
  return requirement.replace(parsed.text, `${parsed.git ? 'git+' : ''}${parsed.url}`)
}

/** Restore source authentication only for the same repository or archive. */
function authenticatedRequirement(requirement: string, name: string) {
  const stored = getSecret(packageSecret(name))
  const credential = stored && requirementUrl(stored)
  const target = requirementUrl(requirement)
  if (!credential || !target) return requirement
  const repository = (url: URL) => url.origin + url.pathname.replace(/@[^/]+$/, '').replace(/\.git$/, '')
  if (repository(credential.url) !== repository(target.url)) return requirement
  target.url.username = credential.url.username
  target.url.password = credential.url.password
  return requirement.replace(target.text, `${target.git ? 'git+' : ''}${target.url}`)
}

export function findUv() {
  const executable = process.platform === 'win32' ? 'uv.exe' : 'uv'
  return (
    [
      ...(app.isPackaged ? [join(process.resourcesPath, 'uv', executable)] : []),
      ...(process.env.PATH ?? '').split(delimiter).map((p) => join(p, executable)),
      '/opt/homebrew/bin/uv',
      '/usr/local/bin/uv',
      join(homedir(), '.local/bin', executable),
      join(homedir(), '.cargo/bin', executable),
    ].find((path) => existsSync(path)) ?? null
  )
}

export class SpeechEnvironment {
  private busy = false
  private cached: SpeechInventory | null = null
  private loading: Promise<SpeechInventory> | null = null
  private updates: SpeechUpdate[] = []
  private checkedAt: string | null = null
  private diagnostics: string[] = []
  private sessionDiagnostics: SpeechInventory['sessionDiagnostics'] = []
  private acquisitionReports = new Map<string, SpeechArtifactReport>()
  private acquisitionErrors = new Map<string, SpeechModelDetail['acquisitionError']>()
  private step: SpeechStatus['step'] = null
  private progress: SpeechStatus['progress'] = null
  private error: string | null = null
  private listeners = new Set<(status: SpeechStatus) => void>()

  constructor(private beforeChange: () => void) {}

  get installed() {
    return existsSync(speechBin('standard-asr'))
  }

  get settings() {
    return (
      getConfig().speech ?? {
        model: preferred.model,
        models: {},
        sources: {},
      }
    )
  }

  status(): SpeechStatus {
    const model = this.settings.model
    const found = this.cached?.models.find((m) => m.id === model)
    return {
      installed: this.installed,
      uv: findUv() !== null,
      model,
      engine: model === preferred.model ? preferred.name : found?.name || model || '',
      step: this.step,
      progress: this.progress,
      error: this.error,
    }
  }

  onStatus(listener: (status: SpeechStatus) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  report(step: SpeechStatus['step'], error: string | null = null, progress: SpeechStatus['progress'] = null) {
    this.step = step
    this.error = error
    this.progress = progress
    for (const listener of this.listeners) listener(this.status())
  }

  recordDiagnostics(model: string, values: SpeechDiagnostic[]) {
    if (!values.length) return
    this.sessionDiagnostics = [...this.sessionDiagnostics, ...values.map((diagnostic) => ({ model, diagnostic }))].slice(-100)
    this.invalidate()
    this.report(this.step, this.error, this.progress)
  }

  /** Secrets travel over stdin only, never command arguments, disk settings, or renderer responses. */
  request(command: string, extra: Record<string, unknown> = {}) {
    const settings = structuredClone(this.settings)
    const models = structuredClone(settings.models)
    for (const key of secretNames().filter((key) => key.startsWith('speech:'))) {
      // Model routing keys may contain colons; match the known model prefix.
      for (const model of Object.keys(models)) {
        const prefix = secretPrefix(model)
        if (!key.startsWith(prefix)) continue
        const [group, ...parts] = key.slice(prefix.length).split(':')
        if (group !== 'config' && group !== 'provider') continue
        models[model][group] = { ...models[model][group], [parts.join(':')]: getSecret(key) }
      }
    }
    return { command, models, ...extra }
  }

  python<T>(
    command: string,
    extra: Record<string, unknown> = {},
    progress?: (value: SpeechStatus['progress']) => void,
  ): Promise<T> {
    return new Promise((resolveResult, reject) => {
      const child = spawn(speechBin('python'), [adapterPath()], {
        // artifact_status is pure: use the same acquisition policy as the
        // install action so missing artifacts can actually offer that action.
        env: { ...process.env, STANDARD_ASR_ALLOW_DOWNLOAD: command === 'acquire' || command === 'detail' ? '1' : '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let pending = ''
      let stderr = ''
      let result: T
      let completed = false
      let failure: string | null = null
      child.stdout.on('data', (chunk) => {
        pending += String(chunk)
        let end: number
        while ((end = pending.indexOf('\n')) >= 0) {
          const line = pending.slice(0, end)
          pending = pending.slice(end + 1)
          try {
            const event = JSON.parse(line)
            if (event.kind === 'progress') progress?.(event.value)
            if (event.kind === 'error') {
              failure = typeof event.value === 'string' ? event.value : event.value.message
              if (command === 'acquire' && typeof extra.model === 'string' && typeof event.value === 'object')
                this.acquisitionErrors.set(extra.model, { ...event.value, mode: extra.mode })
            }
            if (event.kind === 'artifactReport' && typeof extra.model === 'string')
              this.acquisitionReports.set(extra.model, event.value)
            if (event.kind === 'result') {
              result = event.value
              completed = true
            }
          } catch {
            failure = 'Invalid response from the speech adapter'
          }
        }
      })
      child.stderr.on('data', (chunk) => {
        stderr = (stderr + String(chunk)).slice(-4000)
      })
      child.on('error', reject)
      child.on('close', (code) => {
        if (code === 0 && completed) resolveResult(result!)
        else reject(new Error(failure ?? (stderr || `Speech adapter exited (${code})`)))
      })
      child.stdin.on('error', () => {
        /* An early exit is reported by close. */
      })
      child.stdin.end(JSON.stringify(this.request(command, extra)) + '\n')
    })
  }

  async inventory(): Promise<SpeechInventory> {
    if (this.cached) return this.cached
    this.loading ??= (async () => {
      const uv = findUv()
      const uvVersion = uv ? (await run(uv, ['--version'])).stdout.trim() : null
      const data = this.installed
        ? await this.python<Omit<SpeechInventory, 'uv' | 'updates' | 'checkedAt' | 'sessionDiagnostics'>>('inventory')
        : { core: null, plugins: [], packages: [], models: [], python: null, runtime: null, diagnostics: [] }
      this.cached = {
        ...data,
        uv: uvVersion,
        updates: this.updates,
        checkedAt: this.checkedAt,
        diagnostics: [...data.diagnostics, ...this.diagnostics],
        sessionDiagnostics: this.sessionDiagnostics,
      }
      return this.cached
    })().finally(() => {
      this.loading = null
    })
    return this.loading
  }

  async model(id: string): Promise<SpeechModelDetail> {
    const detail = await this.python<Omit<SpeechModelDetail, 'settings' | 'secrets'>>('detail', { model: id })
    const failed = this.acquisitionReports.get(id)
    return {
      ...detail,
      acquisitionError: this.acquisitionErrors.has(id)
        ? { ...this.acquisitionErrors.get(id)!, report: failed }
        : undefined,
      settings: this.settings.models[id] ?? emptySettings(),
      secrets: secretNames()
        .filter((key) => key.startsWith(secretPrefix(id)))
        .map((key) => key.slice(secretPrefix(id).length)),
    }
  }

  private invalidate() {
    this.cached = null
  }

  /**
   * One change at a time. A failed install is kept in the status, since it's
   * what the settings row reports; other operations reject to the window that
   * asked, which shows the reason where the user acted.
   */
  private async operation(step: SpeechStatus['step'], work: () => Promise<void>, keepError = false) {
    if (this.busy) throw new Error('Another speech operation is still running')
    this.busy = true
    this.report(step)
    try {
      await work()
      this.invalidate()
      await this.inventory()
      this.report(null)
    } catch (error) {
      this.invalidate()
      const reason = speechError(error)
      this.report(null, keepError ? reason : null)
      throw new Error(reason)
    } finally {
      this.busy = false
    }
  }

  private async ensureCore() {
    const uv = findUv()
    if (!uv) throw new Error('uv is not installed')
    mkdirSync(speechDir(), { recursive: true })
    if (!existsSync(speechBin('python'))) {
      this.report('environment')
      await run(uv, ['venv', '--python', '3.12', join(speechDir(), 'venv')])
    }
    if (!this.installed) await this.pipInstall([CORE_REQUIREMENT])
  }

  private coreRequirement(core: SpeechPackage | null) {
    return core?.source && core.commit
      ? `standard-asr[audio] @ git+${core.source}@${core.commit}`
      : core
        ? `standard-asr[audio]==${core.version}`
        : CORE_REQUIREMENT
  }

  private packageRequirement(p: SpeechPackage) {
    const original = this.settings.sources[normalize(p.name)]
    const extras = original?.match(/^[^\s\[]+(\[[^\]]+\])/)?.[1] ?? ''
    const requirement =
      p.vcs === 'git' && p.source && p.commit
        ? `${p.name}${extras} @ git+${p.source}@${p.commit}${p.subdirectory ? `#subdirectory=${p.subdirectory}` : ''}`
        : p.source && !p.vcs
          ? (original ?? p.source)
          : `${p.name}${extras}==${p.version}`
    return authenticatedRequirement(requirement, p.name)
  }

  private async pipInstall(requirements: string[]) {
    const uv = findUv()
    if (!uv) throw new Error('uv is not installed')
    this.beforeChange()
    this.report('packages')
    const installed = this.installed ? await this.inventory() : null
    const core = installed?.core ?? null
    const targetName = (requirement: string) => normalize(requirement.match(/^([\w.-]+)(?:\[|\s|[=<>!~]|$)/)?.[1] ?? '')
    const override = requirements.find((r) => targetName(r) === 'standard-asr') ?? this.coreRequirement(core)
    writeFileSync(join(speechDir(), 'overrides.txt'), `${override}\n`)
    const targets = new Set(requirements.map(targetName))
    // Resolve the installed plugin roots together. Otherwise updating one
    // shared dependency can quietly violate another engine's requirements.
    const roots =
      installed?.plugins
        .filter((p) => !targets.has(normalize(p.name)) && !requirements.some((r) => r.includes(p.source ?? '\0')))
        .map((p) => this.packageRequirement(p)) ?? []
    await run(
      uv,
      [
        'pip',
        'install',
        '--python',
        speechBin('python'),
        '--overrides',
        'overrides.txt',
        '--upgrade',
        '--strict',
        ...requirements,
        ...roots,
      ],
      { cwd: speechDir(), maxBuffer: 16 * 1024 * 1024 },
    )
    await run(uv, ['pip', 'check', '--python', speechBin('python')], { maxBuffer: 4 * 1024 * 1024 })
    this.invalidate()
  }

  async install() {
    return this.operation('environment', async () => {
      // Persist before installing, while we can still distinguish new and legacy caches.
      await setConfig({ speech: this.settings })
      await this.ensureCore()
      const runtime = (await this.inventory()).runtime
      await this.pipInstall([
        ...(!runtime?.stableText || !runtime.sessionCapabilityChecks ? [CORE_REQUIREMENT] : []),
        preferred.requirement,
      ])
      const inventory = await this.inventory()
      const plugin = inventory.plugins.find((p) => p.engines.includes(preferred.model.split('/')[0]))
      const settings = structuredClone(this.settings)
      if (plugin) settings.sources[normalize(plugin.name)] = `${plugin.name} @ git+${plugin.source}@main`
      await setConfig({ speech: { ...settings, model: preferred.model } })
      this.report('model')
      const result = await this.python<{ readiness: string }>(
        'acquire',
        { model: preferred.model, mode: 'streaming' },
        (value) => this.report('model', null, value),
      )
      if (result.readiness !== 'ready' && result.readiness !== 'not_applicable')
        throw new Error(`Artifacts: ${result.readiness}`)
    }, true)
  }

  async command(command: SpeechCommand) {
    const step = command.kind === 'acquire' ? 'model' : command.kind === 'uninstallPlugin' ? 'removing' : 'checking'
    return this.operation(step, async () => {
      if (command.kind === 'refresh') {
        this.acquisitionReports.clear()
        this.acquisitionErrors.clear()
        return
      }
      if (command.kind === 'checkUpdates') return this.checkUpdates()
      if (command.kind === 'diagnose') {
        const uv = findUv()
        if (!uv) throw new Error('uv is not installed')
        const results = await Promise.allSettled([
          run(uv, ['pip', 'check', '--python', speechBin('python')]),
          run(speechBin('standard-asr'), ['doctor'], { maxBuffer: 4 * 1024 * 1024 }),
        ])
        this.diagnostics = results.map((r) =>
          r.status === 'fulfilled'
            ? r.value.stdout + r.value.stderr
            : speechError(r.reason),
        )
        return
      }
      if (command.kind === 'installPlugin') {
        await setConfig({ speech: this.settings })
        await this.ensureCore()
        const before = (await this.inventory()).plugins
        await this.pipInstall([command.requirement])
        const catalog = await this.inventory()
        const after = catalog.plugins
        const changed = after.filter(
          (p) => !before.some((old) => old.name === p.name && old.version === p.version && old.commit === p.commit),
        )
        const requestedName = normalize(command.requirement.match(/^([\w.-]+)(?:\[|\s|[=<>!~]|$)/)?.[1] ?? '')
        const publicSource = publicRequirement(command.requirement)
        const targets = after.filter(
          (p) =>
            changed.includes(p) ||
            normalize(p.name) === requestedName ||
            (!!p.source && publicSource.includes(p.source)),
        )
        const settings = structuredClone(this.settings)
        for (const p of targets) {
          const url = requirementUrl(command.requirement)
          if (url?.url.username || url?.url.password) await storeSecret(packageSecret(p.name), command.requirement)
          else await storeSecret(packageSecret(p.name), null)
          settings.sources[normalize(p.name)] = publicRequirement(command.requirement)
        }
        // A model that isn't there is no model; the user picks one, which checks its files first.
        if (settings.model && !catalog.models.some((m) => m.id === settings.model)) settings.model = null
        await setConfig({ speech: settings })
        if (!changed.length)
          this.diagnostics = [
            'No new engine entry points were found. Refresh or check the package’s Standard ASR compatibility.',
          ]
        return
      }
      if (command.kind === 'uninstallPlugin') {
        const inventory = await this.inventory()
        const plugin = inventory.plugins.find((p) => normalize(p.name) === normalize(command.name))
        if (!plugin) throw new Error('Engine plugin not found')
        this.beforeChange()
        await run(findUv()!, ['pip', 'uninstall', '--python', speechBin('python'), plugin.name], {
          maxBuffer: 4 * 1024 * 1024,
        })
        const settings = structuredClone(this.settings)
        if (inventory.models.some((m) => normalize(m.package) === normalize(plugin.name) && m.id === settings.model))
          settings.model = null
        delete settings.sources[normalize(plugin.name)]
        await setConfig({ speech: settings })
        return
      }
      if (command.kind === 'updatePackage' || command.kind === 'updatePackages') {
        const names = new Set((command.kind === 'updatePackages' ? command.names : [command.name]).map(normalize))
        if (!names.size) throw new Error('Select packages to update')
        const updates = [...names].map((name) => {
          const update = this.updates.find((u) => normalize(u.name) === name)
          if (!update?.requirement) throw new Error(`Check updates before updating ${name}`)
          return update
        })
        // A pre-release contract can break without changing its version. Let
        // the owner update core and engines in one dependency-resolution pass.
        await this.pipInstall(updates.map((u) => authenticatedRequirement(u.requirement!, u.name)))
        this.updates = this.updates.filter((u) => !updates.includes(u))
        return
      }
      if (command.kind === 'select') {
        if (command.model) {
          const model = (await this.inventory()).models.find((m) => m.id === command.model)
          if (!model || model.error) throw new Error(model?.error ?? 'Model not found')
        }
        this.beforeChange()
        await setConfig({ speech: { ...this.settings, model: command.model } })
        return
      }
      if (command.kind === 'saveModel') {
        const detail = await this.model(command.model)
        const settings = structuredClone(command.settings)
        // Extract schema-marked credentials even when an older client put them in config.
        for (const group of ['config', 'provider'] as const) {
          const schema = group === 'config' ? detail.configSchema : detail.paramsSchema
          for (const [field, node] of Object.entries(schema.properties ?? {})) {
            if (
              !node.writeOnly &&
              node.format !== 'password' &&
              !node.anyOf?.some((n) => n.format === 'password' || n.writeOnly)
            )
              continue
            if (Object.hasOwn(settings[group], field)) {
              command.secrets[`${group}:${field}`] =
                settings[group][field] == null ? null : String(settings[group][field])
              delete settings[group][field]
            }
          }
        }
        const proposed = { ...this.settings.models, [command.model]: settings }
        // Validate the proposed credentials before changing the working settings.
        const models = this.request('validate').models
        models[command.model] = { ...settings, config: { ...settings.config }, provider: { ...settings.provider } }
        for (const key of secretNames().filter((key) => key.startsWith(secretPrefix(command.model)))) {
          const [group, ...parts] = key.slice(secretPrefix(command.model).length).split(':')
          if (group === 'config' || group === 'provider')
            models[command.model][group] = { ...models[command.model][group], [parts.join(':')]: getSecret(key) }
        }
        for (const [key, value] of Object.entries(command.secrets)) {
          const [group, ...parts] = key.split(':')
          if (group !== 'config' && group !== 'provider') continue
          if (value === null) delete models[command.model][group][parts.join(':')]
          else models[command.model][group] = { ...models[command.model][group], [parts.join(':')]: value }
        }
        await this.python('validate', { model: command.model, models })
        this.beforeChange()
        for (const [key, value] of Object.entries(command.secrets))
          await storeSecret(secretPrefix(command.model) + key, value)
        await setConfig({ speech: { ...this.settings, models: proposed } })
        this.acquisitionReports.delete(command.model)
        this.acquisitionErrors.delete(command.model)
        return
      }
      if (command.kind === 'acquire') {
        this.beforeChange()
        await this.python('acquire', command, (value) => this.report('model', null, value))
        this.acquisitionReports.delete(command.model)
        this.acquisitionErrors.delete(command.model)
        return
      }
      throw new Error('Unsupported speech operation')
    })
  }

  private async checkUpdates() {
    const inventory = await this.inventory()
    const uv = findUv()
    if (!uv || !inventory.core) return
    const outdated = await run(uv, ['pip', 'list', '--python', speechBin('python'), '--outdated', '--format', 'json'], {
      maxBuffer: 4 * 1024 * 1024,
    })
    const releases = JSON.parse(outdated.stdout) as { name: string; latest_version: string }[]
    this.updates = await Promise.all(
      inventory.packages
        .filter((p) => p.vcs === 'git' || releases.some((r) => normalize(r.name) === normalize(p.name)))
        .map(async (p): Promise<SpeechUpdate> => {
          const current = p.commit ?? p.version
          try {
            const source = this.settings.sources[normalize(p.name)]
            const extras =
              normalize(p.name) === 'standard-asr' ? '[audio]' : (source?.match(/^[^\s\[]+(\[[^\]]+\])/)?.[1] ?? '')
            if (p.vcs === 'git' && p.source) {
              const official = p.source.startsWith('https://github.com/standard-voice/')
              const revision =
                normalize(p.name) === 'standard-asr'
                  ? 'main'
                  : (source?.match(/@([^@\s#]+)(?:#[^\s]*)?\s*$/)?.[1] ?? (official ? 'main' : (p.revision ?? 'main')))
              if (/^[0-9a-f]{40}$/.test(revision))
                return { name: p.name, current, latest: current, requirement: null, error: null }
              const response = await run(
                'git',
                [
                  'ls-remote',
                  authenticatedRequirement(p.source, p.name),
                  `refs/heads/${revision}`,
                  `refs/tags/${revision}`,
                  `refs/tags/${revision}^{}`,
                ],
                { timeout: 30_000 },
              )
              const latest = response.stdout.trim().split('\n').at(-1)?.split(/\s+/)[0]
              if (!latest) throw new Error(`Revision not found: ${revision}`)
              return {
                name: p.name,
                current,
                latest,
                requirement:
                  latest === current
                    ? null
                    : `${p.name}${extras} @ git+${p.source}@${latest}${p.subdirectory ? `#subdirectory=${p.subdirectory}` : ''}`,
                error: null,
              }
            }
            const latest = releases.find((r) => normalize(r.name) === normalize(p.name))?.latest_version ?? null
            return {
              name: p.name,
              current,
              latest,
              requirement: latest && latest !== current ? `${p.name}${extras}==${latest}` : null,
              error: null,
            }
          } catch (error) {
            return { name: p.name, current, latest: null, requirement: null, error: speechError(error) }
          }
        }),
    )
    this.checkedAt = new Date().toISOString()
  }
}
