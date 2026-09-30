// Builds the native helpers that aren't Node modules. On macOS that's
// jezo-eventkit (native/eventkit), which reads the Mac's calendars. It's rebuilt
// only when its source is newer than the binary. Run by postinstall and build.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform === 'darwin') {
  const dir = join(import.meta.dirname, '../native/eventkit')
  const source = join(dir, 'main.swift')
  const binary = join(dir, 'build/jezo-eventkit')
  if (!existsSync(binary) || statSync(source).mtimeMs > statSync(binary).mtimeMs) {
    mkdirSync(join(dir, 'build'), { recursive: true })
    execFileSync('swiftc', ['-O', '-o', binary, source], { stdio: 'inherit' })
  }
}
