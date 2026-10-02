// Fetches the uv a packaged Jezo brings along (docs/design/backend.md,
// "Speech"): speech recognition is a Python environment Jezo makes with uv, and
// a user who installs Jezo shouldn't have to install uv first. Run by `package`.
//
//   bun scripts/uv.ts [<platform>-<arch>]   (default: this machine's, like darwin-arm64)
//
// One version, with the SHA-256 of each archive from its release. To move to
// another version, change both, and check the archives' build provenance with
// `gh attestation verify <archive> --repo astral-sh/uv`.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.12.22'

/** uv's own name for each target, with the SHA-256 of its archive in that release. */
const TARGETS: Record<string, { name: string; sha256: string }> = {
  'darwin-arm64': { name: 'aarch64-apple-darwin', sha256: '5d714de09501a59393ceca78f4bc232a50478729640d251907160299b2a93ddd' },
  'darwin-x64': { name: 'x86_64-apple-darwin', sha256: '1b8a5b316883df2daf20fb9a446e5b230e01d947d57aba2694977c5ac5a7e98c' },
  'linux-arm64': { name: 'aarch64-unknown-linux-gnu', sha256: '6f66a14e8239871fb477f9746c941fedfa77e8fe28a8bc7c07e1dc7f53a66712' },
  'linux-x64': { name: 'x86_64-unknown-linux-gnu', sha256: 'b9980552309f09c15172b8be828555e375097f16deb459795ce7bfd200380f0b' },
  'win32-arm64': { name: 'aarch64-pc-windows-msvc', sha256: '6a42b919c2bb7135f07b4d1bb8e489f0eaab0bae039020573cc522d831e2d32e' },
  'win32-x64': { name: 'x86_64-pc-windows-msvc', sha256: 'ea1397797a0ca15f63516dd0f49c2dde9776db9be5861cab152ebe8ad199894d' },
}

const key = process.argv[2] ?? `${process.platform}-${process.arch}`
const target = TARGETS[key]
if (!target) throw new Error(`No uv for ${key}. Known: ${Object.keys(TARGETS).join(', ')}`)
const windows = key.startsWith('win32')
const out = join(import.meta.dirname, '../vendor/uv')
const stamp = join(out, 'version')
const wanted = `${VERSION} ${target.name}`

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === wanted) process.exit(0)

const archive = `uv-${target.name}.${windows ? 'zip' : 'tar.gz'}`
const response = await fetch(`https://github.com/astral-sh/uv/releases/download/${VERSION}/${archive}`)
if (!response.ok) throw new Error(`Downloading ${archive}: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
const sha256 = createHash('sha256').update(bytes).digest('hex')
if (sha256 !== target.sha256) throw new Error(`${archive} isn't the one pinned here: its SHA-256 is ${sha256}.`)

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
const file = join(out, archive)
writeFileSync(file, bytes)
// bsdtar, on macOS and Windows 10 and later, reads zip too. The archives hold uv and uvx in a directory, or at the top level for zip.
execFileSync('tar', ['-xf', file, '-C', out, ...(windows ? [] : ['--strip-components', '1'])])
rmSync(file)
const binary = join(out, windows ? 'uv.exe' : 'uv')
if (!existsSync(binary)) throw new Error(`${archive} has no uv where it was expected.`)
if (!windows) chmodSync(binary, 0o755)
// uvx isn't used.
rmSync(join(out, windows ? 'uvx.exe' : 'uvx'), { force: true })
// uv is MIT or Apache-2.0; what's passed on carries both.
for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) {
  const text = await fetch(`https://raw.githubusercontent.com/astral-sh/uv/${VERSION}/${license}`)
  if (!text.ok) throw new Error(`Downloading uv's ${license}: ${text.status}`)
  writeFileSync(join(out, license), await text.text())
}
writeFileSync(stamp, wanted)
console.log(`uv ${VERSION} for ${key} in vendor/uv`)
