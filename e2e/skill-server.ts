// A repository served through GitHub's API and codeload shapes. The archive is
// real; tests drive the GUI and inspect the workspace that Jezo writes.

import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createTarGzip } from 'nanotar'

export const SKILL_ADDRESS = 'https://github.com/o/r'

export const skillMarkdown = (name: string, title: string, body = 'Take one step, then check what happened.') =>
  `---\nname: ${name}\ndescription: A method for taking the next step.\nmetadata:\n  title: ${title}\n---\n${body}\n`

export async function skillServer() {
  let archive = await makeArchive(1)
  const requests: string[] = []
  const server = createServer((req, res) => {
    requests.push(req.url ?? '')
    if (req.url === '/repos/o/r') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ default_branch: 'main' }))
    if (req.url === '/o/r/tar.gz/main' || req.url === '/methods.tgz') return res.writeHead(200, { 'content-type': 'application/gzip' }).end(archive)
    return res.writeHead(404).end('not found')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, requests, close: () => server.close(), version: async (n: number) => { archive = await makeArchive(n) } }
}

async function makeArchive(version: number) {
  return createTarGzip([
    { name: 'pax_global_header', data: '' },
    { name: 'r-main/methods/next-step/SKILL.md', data: skillMarkdown('next-step', '下一步方法', `Version ${version}: take one step.`) },
    { name: 'r-main/methods/next-step/scripts/run.sh', data: '#!/bin/sh\necho next\n', attrs: { mode: '755' } },
    { name: 'r-main/methods/next-step/picture.bin', data: new Uint8Array([0, 255, 128, 42]) },
    ...(version === 1 ? [{ name: 'r-main/methods/next-step/old.txt', data: 'Only in version one.\n' }] : [{ name: 'r-main/methods/next-step/new.txt', data: 'Only in version two.\n' }]),
    { name: 'r-main/methods/other-method/SKILL.md', data: skillMarkdown('other-method', '另一個方法') },
    { name: '../escape.txt', data: 'Must not be written.\n' },
  ])
}
