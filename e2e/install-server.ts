// Real MCP protocol messages and real pi tarballs; no model response is mocked.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTarGzip } from 'nanotar'
import { skillMarkdown } from './skill-server'

export const STDIO_SERVER = `
const readline = require('node:readline');
require('node:fs').writeFileSync(__filename + '.proof', process.env.INSTALL_TOKEN === 'literal-test-secret' ? 'secret-loaded' : 'secret-missing');
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', line => {
  const q = JSON.parse(line);
  if (q.id === undefined) return;
  const result = q.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'jezo-test', version: '1' } }
    : q.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Echo a message.', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
    : q.method === 'tools/call' ? { content: [{ type: 'text', text: process.env.INSTALL_TOKEN === 'literal-test-secret' ? 'secret-loaded' : 'secret-missing' }] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }) + '\\n');
});
`

const extension = `
import { Type } from 'typebox'
export default function (pi) {
  pi.registerTool({ name: 'installation_echo', label: 'Installation echo', description: 'Echo a message.',
    parameters: Type.Object({ text: Type.String() }),
    async execute(id, args) { return { content: [{ type: 'text', text: args.text }], details: undefined } }
  })
  pi.registerCommand('greet', {
    description: 'Says hello from the package.',
    getArgumentCompletions: (typed) => ['Tim', 'Taro', 'Anna'].filter((n) => n.toLowerCase().startsWith(typed.toLowerCase())).map((n) => ({ value: n, label: n, description: 'say hello to ' + n })),
    handler: async (args, ctx) => ctx.ui.notify('套件打招呼：' + args.trim(), 'info'),
  })
  pi.on('session_start', async (event, ctx) => {
    const allowed = await ctx.ui.confirm('啟用測試工具？', '這是套件提出的問題。')
    let selected, input
    if (allowed) {
      selected = await ctx.ui.select('選一個測試選項', ['第一個', '第二個'])
      input = await ctx.ui.input('輸入測試文字', '你的回答')
    }
    pi.appendEntry('install.confirm', { allowed, selected, input })
    ctx.ui.notify('測試套件收到回答', 'info')
  })
}
`

export async function installServer() {
  const manifest = { name: 'jezo-e2e-tools', version: '1.0.0', description: 'A real test package.', pi: { extensions: ['./extension.ts'], skills: ['./methods'], prompts: ['./prompts'] } }
  const files = [
    { name: 'extension.ts', data: extension },
    { name: 'package.json', data: JSON.stringify(manifest) },
    { name: 'methods/package-method/SKILL.md', data: skillMarkdown('package-method', '套件的方法') },
    { name: 'prompts/package-prompt.md', data: '---\ndescription: A package prompt.\nargument-hint: <topic>\n---\nTake one step on $1.\n' },
  ]
  const githubArchive = await createTarGzip(files.map((f) => ({ ...f, name: `package-main/${f.name}` })))
  const npmArchive = await createTarGzip(files.map((f) => ({ ...f, name: `package/${f.name}` })))
  const requests: string[] = []
  let base = ''
  const server = createServer(async (req, res) => {
    requests.push(`${req.method} ${req.url}`)
    if (req.url === '/repos/o/package') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ default_branch: 'main' }))
    if (req.url === '/o/package/tar.gz/main') return res.writeHead(200, { 'content-type': 'application/gzip' }).end(githubArchive)
    if (req.url === '/package.tgz') return res.writeHead(200, { 'content-type': 'application/gzip' }).end(npmArchive)
    if (req.url === '/jezo-e2e-tools') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ name: manifest.name, 'dist-tags': { latest: '1.0.0' }, versions: { '1.0.0': { ...manifest, dist: { tarball: `${base}/package.tgz` } } } }))
    if (req.url === '/mcp' && req.method === 'POST') {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      const q = JSON.parse(Buffer.concat(chunks).toString())
      if (q.id === undefined) return res.writeHead(202).end()
      const result = q.method === 'initialize' ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'jezo-http', version: '1' } }
        : q.method === 'tools/list' ? { tools: [{ name: 'http_echo', description: 'Echo over HTTP.', inputSchema: { type: 'object', properties: {} } }] }
        : q.method === 'tools/call' ? { content: [{ type: 'text', text: 'http-connected' }] } : {}
      return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: q.id, result }))
    }
    if (req.url === '/mcp') return res.writeHead(405).end()
    return res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, requests, close: () => server.close() }
}
