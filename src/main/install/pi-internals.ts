// pi 0.99.1 does not export its MCP credential store or connection manager.
// Keep all internal imports here; check these contracts when upgrading pi.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export type { AuthStorageBackend } from '../../../node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage'
export type { McpServerConnection } from '../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime'
export type { ResolvedPaths, ResolvedResource } from '../../../node_modules/@earendil-works/pi-coding-agent/dist/core/package-manager'

// pi exports only an ESM entry, so require.resolve can't find it.
const dist = dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')))
const version = JSON.parse(readFileSync(join(dist, '../package.json'), 'utf8')).version
if (version !== '0.99.1') throw new Error(`Jezo's MCP adapter needs pi 0.99.1; found ${version}.`)

const internal = (path: string) => import(/* @vite-ignore */ pathToFileURL(join(dist, path)).href)

export const mcpRuntime = () => internal('extensions/mcp/runtime.js') as Promise<typeof import('../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/runtime')>
export const mcpConfig = () => internal('extensions/mcp/config.js') as Promise<typeof import('../../../node_modules/@earendil-works/pi-coding-agent/dist/extensions/mcp/config')>
export const mcpValidation = () => internal('core/mcp-servers.js') as Promise<typeof import('../../../node_modules/@earendil-works/pi-coding-agent/dist/core/mcp-servers')>
export const piTheme = () => internal('modes/interactive/theme/theme.js') as Promise<typeof import('../../../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme')>
