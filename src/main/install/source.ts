// Parsing has no filesystem or Electron dependencies. Secrets are separated
// before a preview goes to the window or a config goes to disk.

import { createHash } from 'node:crypto'
import type { McpServerConfig } from '@earendil-works/pi-coding-agent'
import { parseSource } from '../workspace/skill-source'

export interface ParsedMcp {
  servers: { name: string; config: McpServerConfig }[]
  secrets: { name: string; value: string }[]
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const reference = (value: string) => value.startsWith('!') || /(?<!\$)\$(?:\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)/.test(value)

export function convertMcp(input: unknown): ParsedMcp {
  if (!record(input)) throw new Error('MCP JSON needs an mcpServers or servers object.')
  const entries = input.mcpServers ?? input.servers
  if (!record(entries) || !Object.keys(entries).length) throw new Error('MCP JSON needs at least one server in mcpServers or servers.')
  const secrets: ParsedMcp['secrets'] = []
  const servers = Object.entries(entries).map(([name, raw]) => {
    if (!record(raw)) throw new Error(`MCP server "${name}" needs a config object.`)
    const config = structuredClone(raw)
    if (config.type === 'sse') throw new Error('Use a streamable HTTP server. pi does not support legacy SSE.')
    if (config.type === 'streamable-http') config.type = 'http'
    if (typeof config.url !== 'string' && typeof config.command !== 'string') throw new Error(`MCP server "${name}" needs a URL or command.`)
    if (config.args !== undefined && (!Array.isArray(config.args) || config.args.some((v) => typeof v !== 'string'))) throw new Error(`MCP server "${name}" args must be strings.`)
    const protect = (value: string, field: string) => {
      if (reference(value) || !value) return value
      const key = `JEZO_MCP_${createHash('sha256').update(`${name}\0${field}`).digest('hex').slice(0, 24)}`
      secrets.push({ name: key, value })
      return `\${${key}}`
    }
    for (const field of ['env', 'headers']) {
      if (config[field] === undefined) continue
      if (!record(config[field])) throw new Error(`MCP server "${name}" ${field} must be an object.`)
      config[field] = Object.fromEntries(Object.entries(config[field]).map(([key, value]) => {
        if (typeof value !== 'string') throw new Error(`MCP server "${name}" ${field}.${key} must be a string.`)
        return [key, protect(value, `${field}.${key}`)]
      }))
    }
    if (record(config.oauth) && typeof config.oauth.clientSecret === 'string') config.oauth.clientSecret = protect(config.oauth.clientSecret, 'oauth.clientSecret')
    // Tool search avoids a large declaration list and works with small models.
    config.exposure ??= 'deferred'
    return { name, config: config as unknown as McpServerConfig }
  })
  return { servers, secrets }
}

export function splitCommand(source: string): string[] {
  const args: string[] = []
  let word = ''
  let quote = ''
  let started = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i]
    if (char === '\\' && quote !== "'" && /[\s"'\\]/.test(source[i + 1] ?? '')) { word += source[++i]; started = true }
    else if (quote) { if (char === quote) quote = ''; else word += char }
    else if (char === '"' || char === "'") { quote = char; started = true }
    else if (/\s/.test(char)) { if (started) args.push(word); word = ''; started = false }
    else { word += char; started = true }
  }
  if (quote) throw new Error('Close the quote in the command.')
  if (started) args.push(word)
  return args
}

export function classifySource(input: string): { kind: 'skill' | 'package'; source: string } | { kind: 'mcp'; parsed: ParsedMcp } {
  const source = input.trim()
  if (!source) throw new Error('Paste a source first.')
  if (source.startsWith('npm:')) {
    if (!/^npm:(?:@[\w.-]+\/)?[\w.-]+(?:@[^\s]+)?$/.test(source)) throw new Error('Use npm:name or npm:@scope/name@version.')
    return { kind: 'package', source }
  }
  if (source.startsWith('{') || source.startsWith('[')) {
    let json: unknown
    try { json = JSON.parse(source) } catch { throw new Error('The MCP JSON could not be read. Check its commas and quotes.') }
    return { kind: 'mcp', parsed: convertMcp(json) }
  }
  if (/^https?:\/\//i.test(source)) {
    const url = new URL(source)
    if (url.hostname === 'github.com' || /\.(zip|skill|tar\.gz|tgz)$/i.test(url.pathname)) {
      parseSource(source)
      return { kind: 'skill', source }
    }
    return { kind: 'mcp', parsed: convertMcp({ mcpServers: { [url.hostname.replace(/[^\w-]/g, '-')]: { url: source } } }) }
  }
  const [command, ...args] = splitCommand(source)
  if (!command) throw new Error('Paste a command first.')
  const name = command.split(/[/\\]/).at(-1)!.replace(/[^\w-]/g, '-') || 'server'
  return { kind: 'mcp', parsed: convertMcp({ mcpServers: { [name]: { command, args } } }) }
}

export function isPiPackage(value: unknown): boolean {
  return record(value) && (Object.hasOwn(value, 'pi') || (Array.isArray(value.keywords) && value.keywords.includes('pi-package')))
}
