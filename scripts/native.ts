// Builds the Mac helpers for calendars and the optional on-device model.
// They run separately from Electron and do not depend on its Node ABI.
// Run by postinstall and build.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
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

// A separate executable keeps FoundationModels out of Electron's native ABI.
// Older Mac SDKs can still build Jezo; the provider reports helper-unavailable.
if (process.platform === 'darwin') {
  const dir = join(import.meta.dirname, '../native/foundation-models')
  const source = join(dir, 'main.swift')
  const binary = join(dir, 'build/jezo-foundation-models')
  mkdirSync(join(dir, 'build'), { recursive: true })
  const sdk = execFileSync('xcrun', ['--show-sdk-path'], { encoding: 'utf8' }).trim()
  const [major = 0, minor = 0] = execFileSync('xcrun', ['--show-sdk-version'], { encoding: 'utf8' }).trim().split('.').map(Number)
  if (major < 26 || (major === 26 && minor < 4) || !existsSync(join(sdk, 'System/Library/Frameworks/FoundationModels.framework'))) {
    rmSync(binary, { force: true })
    console.warn('Apple Foundation Models helper requires a macOS 26.4 SDK or newer; other providers remain available.')
  } else if (!existsSync(binary) || Math.max(statSync(source).mtimeMs, statSync(import.meta.filename).mtimeMs) > statSync(binary).mtimeMs) {
    execFileSync('swiftc', ['-parse-as-library', '-swift-version', '6', '-O',
      '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos26.0`,
      '-o', binary, source], { stdio: 'inherit' })
  }
}
