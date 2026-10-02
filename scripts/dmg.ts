// Recompresses the Mac disk images electron-builder made with LZMA (ULMO),
// which electron-builder can't write itself: about a fifth smaller to download
// than its best (lzfse), and readable on macOS 10.15 and later. Run by
// `bun run release` after electron-builder.

import { execFileSync } from 'node:child_process'
import { readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(import.meta.dirname, '../dist')
for (const name of readdirSync(dist).filter((n) => n.endsWith('.dmg'))) {
  const path = join(dist, name)
  const packed = `${path}.ulmo.dmg`
  rmSync(packed, { force: true })
  const before = statSync(path).size
  execFileSync('hdiutil', ['convert', path, '-format', 'ULMO', '-o', packed], { stdio: ['ignore', 'ignore', 'inherit'] })
  execFileSync('hdiutil', ['verify', packed], { stdio: 'ignore' })
  renameSync(packed, path)
  console.log(`${name}: ${Math.round(before / 2 ** 20)} MB → ${Math.round(statSync(path).size / 2 ** 20)} MB`)
}
