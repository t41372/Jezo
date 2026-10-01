// One discovery entry, with pi handling packages and MCP. Methods keep their
// workspace installer and history (docs/design/extensions.md).

import { chmod, lstat, mkdir, rename, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { shell } from 'electron'
import { createMcpExtension, DefaultPackageManager, SettingsManager, type McpServerConfig, type McpServerEntry, type PackageSource } from '@earendil-works/pi-coding-agent'
import type { InstallOrigin, InstallPreview, InstallResult, InstalledResources } from '../../shared/install'
import { currentActing } from '../agent/acting'
import { getSecret, storeSecretSync } from '../secrets'
import { newId, readIfExists, writeAtomic } from '../workspace/files'
import { remoteFiles, skillInstaller } from '../workspace/skill-install'
import type { SkillFile } from '../workspace/skill-source'
import type { Workspace } from '../workspace/workspace'
import { installDependencies, npmLauncher, packageError, packageMetadata } from './npm'
import { mcpConfig, mcpRuntime, mcpValidation, type AuthStorageBackend, type McpServerConnection, type ResolvedPaths, type ResolvedResource } from './pi-internals'
import { classifySource, isPiPackage, type ParsedMcp } from './source'

type PackageRecord = Exclude<PackageSource, string> & { jezo?: InstallOrigin; jezoDisabled?: boolean; jezoFilters?: Pick<Exclude<PackageSource, string>, 'extensions' | 'skills' | 'prompts' | 'themes'> }
type McpRecord = McpServerConfig & { jezo?: InstallOrigin }
type Prepared = { kind: 'mcp'; parsed: ParsedMcp; source: string } | { kind: 'package'; source: string; path?: string; files?: SkillFile[]; ref?: string }
const packageSource = (pkg: PackageSource) => typeof pkg === 'string' ? pkg : pkg.source
const secretRefs = (config: McpServerConfig) => [...JSON.stringify(config).matchAll(/\$\{(JEZO_MCP_[a-f0-9]+)\}/g)].map((m) => m[1])

class OAuthBackend implements AuthStorageBackend {
  private queue: Promise<unknown> = Promise.resolve()
  withLock<T>(fn: (current: string | undefined) => { result: T; next?: string }): T {
    const { result, next } = fn(getSecret('mcp:oauth'))
    if (next !== undefined) storeSecretSync('mcp:oauth', next)
    return result
  }
  withLockAsync<T>(fn: (current: string | undefined) => Promise<{ result: T; next?: string }>): Promise<T> {
    const work = this.queue.then(async () => {
      const { result, next } = await fn(getSecret('mcp:oauth'))
      if (next !== undefined) storeSecretSync('mcp:oauth', next)
      return result
    })
    this.queue = work.catch(() => undefined)
    return work
  }
}

export class Installer {
  readonly agentDir = process.env.PI_CODING_AGENT_DIR!
  readonly settings: SettingsManager
  readonly packages: DefaultPackageManager
  private previews = new Map<string, Prepared>()
  private connections = new Map<string, McpServerConnection>()
  private connectionErrors = new Map<string, string>()
  private listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()
  private credentials?: Awaited<ReturnType<typeof mcpRuntime>>['McpOAuthCredentialStore']['prototype']
  private command: string[] = []
  private signIns = new Map<string, (url: string | undefined) => void>()
  private signInReplies = new Map<string, string | undefined>()
  private loginTasks = new Map<string, Promise<void>>()
  private closed = false

  constructor(private workspace: Workspace) {
    this.settings = SettingsManager.create(workspace.root, this.agentDir, { projectTrusted: false })
    this.packages = new DefaultPackageManager({ cwd: workspace.root, agentDir: this.agentDir, settingsManager: this.settings })
  }

  async open() {
    this.command = await npmLauncher(this.agentDir)
    this.settings.setNpmCommand(this.command)
    this.settings.setEnableInstallTelemetry(false)
    await this.settings.flush()
    const runtime = await mcpRuntime()
    this.credentials = new runtime.McpOAuthCredentialStore(new OAuthBackend(), this.agentDir)
  }

  onChange(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private changed() { for (const listener of this.listeners) listener() }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work)
    this.queue = next.catch(() => undefined)
    return next
  }
  private get mcpFile() { return join(this.agentDir, 'mcp.json') }
  private async config() {
    const text = await readIfExists(this.mcpFile)
    const config = text === null ? {} : JSON.parse(text)
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('mcp.json needs an object.')
    config.mcpServers ??= {}
    return config as { mcpServers: Record<string, McpRecord>; [key: string]: unknown }
  }

  async preview(source: string): Promise<InstallPreview> {
    const input = source.trim()
    if (/^(?:\/|\.\.?[/\\]|~[/\\]|[a-z]:[/\\]|file:\/\/)/i.test(input)) {
      const path = input.startsWith('file://') ? fileURLToPath(input) : input.startsWith('~/') ? join(homedir(), input.slice(2)) : resolve(this.workspace.root, input)
      try {
        const info = await lstat(path)
        if (info.isDirectory() || /\.(zip|skill|tar\.gz|tgz)$/i.test(path)) return this.local(path)
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    const parsed = classifySource(source)
    if (parsed.kind === 'mcp') {
      const { validateMcpServerConfig } = await mcpValidation()
      for (const server of parsed.parsed.servers) {
        const checked = validateMcpServerConfig(server.name, server.config)
        if (typeof checked === 'string') throw new Error(checked)
      }
      // Do not retain pasted secrets in the provenance or return them to the window.
      const token = newId('install')
      this.previews.set(token, { kind: 'mcp', parsed: parsed.parsed, source: 'pasted' })
      return { kind: 'mcp', token, choices: parsed.parsed.servers.map(({ name, config }) => ({
        id: name, title: name, description: 'url' in config ? 'HTTP MCP' : 'stdio MCP',
        source: 'url' in config ? config.url : [config.command, ...(config.args ?? [])].join(' '), destination: this.mcpFile,
      })) }
    }
    if (parsed.kind === 'package') {
      const meta = await packageMetadata(this.command, parsed.source)
      return this.packagePreview({ kind: 'package', source: parsed.source }, meta.name ?? parsed.source, meta.description ?? '', meta.pi)
    }
    const tree = await remoteFiles(parsed.source)
    const manifest = tree.entries.find((f) => f.path === 'package.json')
    if (tree.address.kind === 'github' && !tree.address.path && manifest) {
      const meta = JSON.parse(new TextDecoder().decode(manifest.data))
      if (isPiPackage(meta)) {
        const { owner, repo } = tree.address
        return this.packagePreview({ kind: 'package', source: parsed.source, ref: tree.ref, path: join(this.agentDir, 'git/github.com', owner!, repo!), files: tree.entries }, meta.name ?? `${owner}/${repo}`, meta.description ?? '', meta.pi)
      }
    }
    return { kind: 'skill', preview: await skillInstaller(this.workspace).remote(parsed.source, tree) }
  }

  private packagePreview(prepared: Prepared & { kind: 'package' }, title: string, description: string, manifest?: unknown): InstallPreview {
    const token = newId('install')
    this.previews.set(token, prepared)
    const resources = manifest && typeof manifest === 'object' ? Object.entries(manifest).filter(([kind]) => ['extensions', 'skills', 'prompts', 'themes'].includes(kind)).flatMap(([kind, paths]) => Array.isArray(paths) ? paths.filter((path) => typeof path === 'string').map((path) => `${kind} · ${path}`) : []) : []
    return { kind: 'package', token, choices: [{ id: prepared.source, title: String(title), description: String(description), source: prepared.source, destination: prepared.path ?? join(this.agentDir, 'npm'), resources }] }
  }

  async local(path: string): Promise<InstallPreview> { return { kind: 'skill', preview: await skillInstaller(this.workspace).local(path) } }
  discard(token: string) { this.previews.delete(token); skillInstaller(this.workspace).discard(token) }

  async agentInstall(source: string, path?: string, replace = false) {
    const preview = await this.preview(source)
    if (preview.kind === 'skill') {
      const found = preview.preview
      try {
        if (path === undefined && found.skills.length > 1) return { choices: found.skills.map(({ path, name, description }) => ({ path, name, description })), skipped: found.skipped }
        const selected = path === undefined ? found.skills.map((s) => s.path) : [path]
        const result = await skillInstaller(this.workspace).install(found.token, selected, replace)
        if (result.conflicts.length) throw new Error(`Already installed: ${result.conflicts.join(', ')}. Call again with replace: true only if the user asked to replace it.`)
        return { result }
      } finally { this.discard(found.token) }
    }
    try {
      const selected = path === undefined ? preview.choices.map((c) => c.id) : [path]
      const result = await this.install(preview.token, selected, replace)
      if (result.conflicts.length) throw new Error(`Already installed: ${result.conflicts.join(', ')}. Call again with replace: true only if the user asked to replace it.`)
      return { summary: `Installed ${preview.kind}: ${result.installed.join(', ')}. Available from the next conversation. Recorded in ${preview.kind === 'mcp' ? this.mcpFile : join(this.agentDir, 'settings.json')}.` }
    } finally { this.discard(preview.token) }
  }

  async install(token: string, selected: string[], replace = false): Promise<InstallResult> {
    return this.serial(async () => {
      const prepared = this.previews.get(token)
      if (!prepared) throw new Error('Read the source again before installing it.')
      const origin: InstallOrigin = { source: prepared.source, installed: new Date().toISOString(), by: currentActing().actor.by === 'agent' ? 'agent' : 'user' }
      if (prepared.kind === 'mcp') {
        const config = await this.config()
        const previousSecrets = Object.values(config.mcpServers).flatMap(secretRefs)
        const chosen = prepared.parsed.servers.filter((s) => selected.includes(s.name))
        if (!chosen.length || selected.some((name) => !chosen.some((s) => s.name === name))) throw new Error('Choose at least one server from the source.')
        const conflicts = chosen.filter((s) => config.mcpServers[s.name]).map((s) => s.name)
        if (conflicts.length && !replace) return { installed: [], conflicts }
        for (const { name, config: server } of chosen) {
          const needed = secretRefs(server)
          for (const secret of prepared.parsed.secrets.filter((s) => needed.includes(s.name))) storeSecretSync(secret.name, secret.value)
          config.mcpServers[name] = { ...server, jezo: { ...origin, source: 'url' in server ? server.url : [server.command, ...(server.args ?? [])].join(' ') } }
          await this.dropConnection(name)
        }
        await writeAtomic(this.mcpFile, JSON.stringify(config, null, 2) + '\n')
        const keptSecrets = new Set(Object.values(config.mcpServers).flatMap(secretRefs))
        for (const key of previousSecrets) if (!keptSecrets.has(key)) storeSecretSync(key, null)
      } else {
        if (!selected.includes(prepared.source)) throw new Error('Choose the package from the source.')
        const source = prepared.path ?? prepared.source
        const configured = this.settings.getPackages().find((p) => this.samePackage(packageSource(p), source))
        if (configured && !replace) return { installed: [], conflicts: [prepared.source] }
        if (prepared.path && prepared.files) await this.unpackPackage(prepared.path, prepared.files)
        try { await this.packages.installAndPersist(source) } catch (error) { throw packageError(error, await readIfExists(join(this.agentDir, 'npm-error.log')) ?? '') }
        const actual = this.packages.listConfiguredPackages().find((p) => p.installedPath === prepared.path || this.samePackage(p.source, source))
        if (!actual) throw new Error('pi did not save the installed package.')
        this.settings.setPackages(this.settings.getPackages().map((p) => packageSource(p) === actual.source ? { ...(typeof p === 'string' ? { source: p } : p), jezo: { ...origin, ...(prepared.ref ? { ref: prepared.ref } : {}) } } as PackageRecord : p))
        await this.settings.flush()
      }
      this.previews.delete(token)
      this.changed()
      return { installed: selected, conflicts: [] }
    })
  }

  private samePackage(a: string, b: string) {
    if (a.startsWith('npm:') && b.startsWith('npm:')) return a.replace(/(?<=.)@[^/]*$/, '') === b.replace(/(?<=.)@[^/]*$/, '')
    return resolve(this.agentDir, a) === resolve(this.agentDir, b)
  }

  private async unpackPackage(path: string, files: SkillFile[]) {
    const temp = `${path}.${newId('download')}`
    const previous = `${path}.previous`
    await mkdir(temp, { recursive: true })
    try {
      for (const file of files) {
        await writeAtomic(join(temp, file.path), file.data)
        if (file.executable) await chmod(join(temp, file.path), 0o755)
      }
      await installDependencies(this.command, temp)
      await rm(previous, { recursive: true, force: true })
      try { await rename(path, previous) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      try { await rename(temp, path) } catch (error) { await rename(previous, path).catch(() => undefined); throw error }
      await rm(previous, { recursive: true, force: true })
    } finally { await rm(temp, { recursive: true, force: true }) }
  }

  /** Explicit package paths keep ambient ~/.agents and project .pi discovery off. */
  async resources(): Promise<ResolvedPaths> {
    await this.queue
    await this.settings.reload()
    const all = await this.packages.resolve(() => Promise.resolve('skip'))
    return Object.fromEntries(Object.entries(all).map(([kind, values]) => [kind, (values as ResolvedResource[]).filter((r) => r.metadata.origin === 'package')])) as unknown as ResolvedPaths
  }

  private resolveSecret(value: string) {
    return value.replace(/\$\{(JEZO_MCP_[a-f0-9]+)\}/g, (_, key: string) => {
      const stored = getSecret(key)
      if (stored === undefined) throw new Error(`The keychain entry ${key} is missing. Install this server again.`)
      return stored.replaceAll('$', '$$$$').replace(/^!/, '$!')
    })
  }

  private resolveSecrets(entry: McpServerEntry): McpServerEntry {
    const config = structuredClone(entry.config)
    for (const field of ['env', 'headers'] as const) {
      const values = (config as unknown as Record<string, Record<string, string>>)[field]
      if (values) for (const key of Object.keys(values)) values[key] = this.resolveSecret(values[key])
    }
    if ('url' in config && config.oauth?.clientSecret) config.oauth.clientSecret = this.resolveSecret(config.oauth.clientSecret)
    if ('command' in config && ['npm', 'npx', 'node'].includes(config.command)) config.command = join(this.agentDir, 'bin', config.command + (process.platform === 'win32' ? '.cmd' : ''))
    return { ...entry, config }
  }

  async mcpExtension() {
    const runtime = await mcpRuntime()
    const config = await mcpConfig()
    return createMcpExtension({
      credentials: this.credentials,
      openUrl: (url) => { void shell.openExternal(url) },
      loadConfig: () => {
        const loaded = config.loadMcpConfig({ agentDir: this.agentDir, cwd: this.workspace.root, projectTrusted: false })
        // OAuth resolves clientSecret outside createTransport, when refreshing.
        loaded.servers = loaded.servers.map((entry) => {
          if (!('url' in entry.config) || !entry.config.oauth?.clientSecret) return entry
          try {
            return { ...entry, config: { ...entry.config, oauth: { ...entry.config.oauth, clientSecret: this.resolveSecret(entry.config.oauth.clientSecret) } } }
          } catch {
            // The affected connection reports its missing credential. Keep
            // the other configured servers available to the session.
            return entry
          }
        })
        return loaded
      },
      createTransport: (entry, cwd, auth) => runtime.createDefaultTransport(this.resolveSecrets(entry), cwd, auth),
    })
  }

  async list(): Promise<InstalledResources> {
    const resources = await this.resources()
    const config = await this.config()
    const runtime = await mcpRuntime()
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      if (this.closed || entry.enabled === false || this.connections.has(name)) continue
      try {
        const connection = new runtime.McpServerConnection({
          entry: this.resolveSecrets({ name, config: entry, source: this.mcpFile, scope: 'global' }),
          cwd: this.workspace.root, credentials: this.credentials!,
          createTransport: runtime.createDefaultTransport,
          onTools: () => this.changed(), onChange: () => this.changed(),
        })
        this.connections.set(name, connection)
        this.connectionErrors.delete(name)
        void connection.getClient().catch(() => undefined)
      } catch (error) { this.connectionErrors.set(name, String((error as Error).message)) }
    }
    return {
      packages: this.packages.listConfiguredPackages().map((pkg) => {
        const record = this.settings.getPackages().find((p) => packageSource(p) === pkg.source) as PackageRecord | string
        return { source: pkg.source, enabled: typeof record === 'string' || !record.jezoDisabled, origin: typeof record === 'string' ? undefined : record.jezo,
          resources: Object.entries(resources).flatMap(([kind, values]) => (values as ResolvedResource[]).filter((r) => r.metadata.source === pkg.source).map((r) => ({ kind, path: relative(pkg.installedPath ?? this.agentDir, r.path) }))),
        }
      }),
      servers: Object.entries(config.mcpServers).map(([name, server]) => {
        const connection = this.connections.get(name)
        return { name, source: 'url' in server ? server.url : [server.command, ...(server.args ?? [])].join(' '), enabled: server.enabled !== false, origin: server.jezo,
          state: server.enabled === false ? 'disabled' : connection?.state ?? (this.connectionErrors.has(name) ? 'failed' : this.closed ? 'closed' : 'connecting'), tools: connection?.tools.map((t) => t.name) ?? [], error: connection?.error ?? this.connectionErrors.get(name) }
      }),
    }
  }

  async setEnabled(kind: 'package' | 'mcp', id: string, enabled: boolean) {
    return this.serial(async () => {
      if (kind === 'mcp') {
        const config = await this.config()
        if (!config.mcpServers[id]) throw new Error(`No MCP server "${id}".`)
        config.mcpServers[id].enabled = enabled
        await writeAtomic(this.mcpFile, JSON.stringify(config, null, 2) + '\n')
        await this.dropConnection(id)
      } else {
        const types = ['extensions', 'skills', 'prompts', 'themes'] as const
        this.settings.setPackages(this.settings.getPackages().map((pkg) => {
          if (packageSource(pkg) !== id) return pkg
          const entry: PackageRecord = typeof pkg === 'string' ? { source: pkg } : { ...pkg }
          if (enabled) {
            for (const type of types) { if (entry.jezoFilters?.[type] === undefined) delete entry[type]; else entry[type] = entry.jezoFilters[type] }
            delete entry.jezoFilters
            delete entry.jezoDisabled
          } else if (!entry.jezoDisabled) {
            entry.jezoFilters = Object.fromEntries(types.filter((type) => entry[type] !== undefined).map((type) => [type, entry[type]]))
            entry.jezoDisabled = true
            for (const type of types) entry[type] = []
          }
          return entry
        }))
        await this.settings.flush()
      }
      this.changed()
    })
  }

  async remove(kind: 'package' | 'mcp', id: string) {
    return this.serial(async () => {
      if (kind === 'package') {
        const pkg = this.packages.listConfiguredPackages().find((p) => p.source === id)
        // pi reads a local source given to remove against the workspace, but saved it relative to its own directory.
        const local = !/^[a-z]+:/.test(id) && !id.startsWith('/')
        await this.packages.removeAndPersist(local ? join(this.agentDir, id) : id)
        await this.settings.flush()
        if (pkg?.installedPath?.startsWith(join(this.agentDir, 'git') + '/') && !id.startsWith('npm:')) await rm(pkg.installedPath, { recursive: true, force: true })
      } else {
        const config = await this.config()
        const server = config.mcpServers[id]
        if (server) {
          delete config.mcpServers[id]
          await writeAtomic(this.mcpFile, JSON.stringify(config, null, 2) + '\n')
          const keptSecrets = new Set(Object.values(config.mcpServers).flatMap(secretRefs))
          for (const key of secretRefs(server)) if (!keptSecrets.has(key)) storeSecretSync(key, null)
          // Sign-ins are kept per server, so this one's go with it.
          if ('url' in server) this.credentials?.remove(id, server.url)
        }
        await this.dropConnection(id)
      }
      this.changed()
    })
  }

  signIn(name: string): Promise<void> {
    const pending = this.loginTasks.get(name)
    if (pending) return pending
    const work = this.signInNow(name).finally(() => this.loginTasks.delete(name))
    this.loginTasks.set(name, work)
    return work
  }

  private async signInNow(name: string) {
    this.signInReplies.delete(name)
    const connection = this.connections.get(name)
    if (!connection?.oauthUrl) throw new Error('This server does not use OAuth.')
    const { signInMcpServer } = await mcpRuntime()
    try {
      await signInMcpServer({ serverUrl: connection.oauthUrl, store: this.credentials!.forServer(name, connection.oauthUrl), settings: connection.oauthSettings(), challenge: connection.challenge,
        prompt: { showAuthorizationUrl: (url) => { void shell.openExternal(url.href) }, promptForRedirectUrl: (signal) => new Promise((resolve) => {
          const finish = (url?: string) => { signal.removeEventListener('abort', cancel); this.signIns.delete(name); resolve(url) }
          const cancel = () => finish()
          this.signIns.set(name, finish)
          signal.addEventListener('abort', cancel, { once: true })
          if (signal.aborted) cancel()
          else if (this.signInReplies.has(name)) finish(this.signInReplies.get(name))
        }) },
      })
    } finally { this.signIns.delete(name); this.signInReplies.delete(name) }
    await connection.reconnect()
    this.changed()
  }

  replySignIn(name: string, url?: string) {
    const reply = this.signIns.get(name)
    if (reply) reply(url)
    else this.signInReplies.set(name, url)
  }

  async reconnect(name: string) { await this.connections.get(name)?.reconnect(); this.changed() }
  private async dropConnection(name: string) { const connection = this.connections.get(name); this.connections.delete(name); this.connectionErrors.delete(name); await connection?.close() }
  async close() {
    this.closed = true
    for (const name of this.loginTasks.keys()) this.replySignIn(name)
    await Promise.allSettled([...this.loginTasks.values()])
    await Promise.all([...this.connections.keys()].map((name) => this.dropConnection(name)))
  }
}

const installers = new WeakMap<Workspace, Installer>()
export function installer(workspace: Workspace) {
  let found = installers.get(workspace)
  if (!found) { found = new Installer(workspace); installers.set(workspace, found) }
  return found
}
