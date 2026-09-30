// Failure cases, before the parser:
// 1. A URL is mistaken for a command, npm source or method archive.
// 2. Scoped npm names or pinned versions lose part of their source.
// 3. Quoted arguments, empty arguments, escapes or unfinished quotes change argv.
// 4. Claude/Cursor and VS Code configs lose servers or transport fields.
// 5. Invalid JSON, entries, argument lists or unsupported SSE silently install.
// 6. Literal env/header/client secrets survive in the converted config.
// 7. Existing pi environment/command references are stored as literal secrets.
// 8. Different server names or fields overwrite one another's secret.
// 9. GitHub package detection accepts an ordinary package or misses an empty pi key.

import { describe, expect, test } from 'bun:test'
import { classifySource, convertMcp, isPiPackage, splitCommand } from './source'

describe('install sources', () => {
  test('recognizes addresses and npm sources', () => {
    for (const source of ['npm:one', 'npm:@org/one@1.2.3']) expect(classifySource(source)).toEqual({ kind: 'package', source })
    for (const source of ['https://github.com/o/r', 'https://github.com/o/r/tree/main/skills', 'https://host/a.tgz?x=1']) expect(classifySource(source).kind).toBe('skill')
    expect(classifySource('https://host/mcp').kind).toBe('mcp')
    expect(() => classifySource('npm:')).toThrow('npm')
    expect(() => classifySource('')).toThrow('source')
    expect(() => classifySource('https://github.com/o/r/issues')).toThrow('GitHub')
  })

  test('preserves command arguments', () => {
    expect(splitCommand('npx -y "a b" \'c d\' "" a\\ b')).toEqual(['npx', '-y', 'a b', 'c d', '', 'a b'])
    expect(splitCommand('node "C:\\tools\\mcp.js"')).toEqual(['node', 'C:\\tools\\mcp.js'])
    expect(() => splitCommand('npx "unfinished')).toThrow('quote')
  })

  test('converts both config shapes and retains fields', () => {
    const a = convertMcp({ mcpServers: { one: { command: 'node', args: ['a'], cwd: '/tmp', timeout: 12 }, two: { url: 'https://host/mcp', type: 'http' } } })
    expect(a.servers.map((s) => s.name)).toEqual(['one', 'two'])
    expect(a.servers[0].config).toMatchObject({ command: 'node', args: ['a'], cwd: '/tmp', timeout: 12, exposure: 'deferred' })
    expect(convertMcp({ servers: { one: { type: 'stdio', command: 'node' } }, inputs: [] }).servers[0].name).toBe('one')
    expect(classifySource(JSON.stringify({ mcpServers: { a: { command: 'node' } } })).kind).toBe('mcp')
  })

  test('refuses malformed configs with a reason', () => {
    for (const input of [{}, { servers: [] }, { mcpServers: { a: null } }, { mcpServers: { a: { command: 'node', args: [1] } } }, { servers: { a: { type: 'sse', url: 'https://host' } } }]) expect(() => convertMcp(input)).toThrow()
    expect(() => classifySource('{bad')).toThrow('JSON')
  })

  test('extracts literal secrets, preserving references', () => {
    const result = convertMcp({ mcpServers: {
      one: { command: 'node', env: { TOKEN: 'private-one', PATH: '${PATH}', REF: '!get-token', OTHER: '$TOKEN' } },
      two: { url: 'https://host', headers: { Authorization: 'Bearer private-two' }, oauth: { clientSecret: 'private-three' } },
    } })
    const json = JSON.stringify(result.servers)
    for (const value of ['private-one', 'private-two', 'private-three']) expect(json).not.toContain(value)
    expect(result.secrets.map((s) => s.value)).toEqual(['private-one', 'Bearer private-two', 'private-three'])
    expect(new Set(result.secrets.map((s) => s.name)).size).toBe(3)
    expect(result.servers[0].config).toMatchObject({ env: { PATH: '${PATH}', REF: '!get-token', OTHER: '$TOKEN' } })
    expect(convertMcp({ servers: { other: { command: 'node', env: { TOKEN: 'x' } } } }).secrets[0].name).not.toBe(result.secrets[0].name)
  })

  test('identifies pi manifests', () => {
    expect(isPiPackage({ pi: {} })).toBe(true)
    expect(isPiPackage({ keywords: ['pi-package'] })).toBe(true)
    expect(isPiPackage({ name: 'ordinary' })).toBe(false)
  })
})
