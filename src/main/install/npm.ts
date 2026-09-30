// pi calls this executable through npmCommand. Only the child enters Node
// mode; Jezo's own environment remains an Electron app's environment.

import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export async function npmLauncher(agentDir: string) {
  const require = createRequire(import.meta.url)
  const npmDir = dirname(require.resolve('npm/package.json')).replace('app.asar/', 'app.asar.unpacked/')
  const bin = join(agentDir, 'bin')
  await mkdir(bin, { recursive: true })
  const cache = join(agentDir, 'cache/npm')
  // pi reports a failed process's exit code, not its compiler output. Keep
  // npm's last install error so the dialog can say what needs fixing.
  const runner = join(bin, 'npm-run.cjs')
  await writeFile(runner, `const { spawn } = require('node:child_process')
const { writeFileSync } = require('node:fs')
const args = process.argv.slice(2)
const installing = args[0] === 'install'
const log = ${JSON.stringify(join(agentDir, 'npm-error.log'))}
if (installing) writeFileSync(log, '')
const child = spawn(process.execPath, [${JSON.stringify(join(npmDir, 'bin/npm-cli.js'))}, ...args], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['inherit', 'pipe', 'pipe'],
})
let output = ''
const forward = (stream, target) => stream.on('data', (chunk) => {
  target.write(chunk)
  if (installing) output = (output + chunk.toString()).slice(-20000)
})
forward(child.stdout, process.stdout)
forward(child.stderr, process.stderr)
child.on('error', (error) => { output += error.message; if (installing) writeFileSync(log, output); process.exitCode = 1 })
child.on('close', (code) => { if (installing && code !== 0) writeFileSync(log, output); process.exitCode = code ?? 1 })
process.on('SIGTERM', () => child.kill('SIGTERM'))
process.on('SIGINT', () => child.kill('SIGINT'))
`)
  for (const name of ['npm', 'npx', 'node']) {
    const cli = name === 'node' ? '' : name === 'npm' ? runner : join(npmDir, 'bin/npx-cli.js')
    const path = join(bin, name + (process.platform === 'win32' ? '.cmd' : ''))
    const script = process.platform === 'win32'
      ? `@echo off\r\nsetlocal\r\nset ELECTRON_RUN_AS_NODE=1\r\nset "npm_config_cache=${cache}"\r\nset "PATH=${bin};%PATH%"\r\n"${process.execPath}" ${cli ? `"${cli}" ` : ''}%*\r\n`
      : `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexport npm_config_cache=${quote(cache)}\nexport PATH=${quote(bin)}:"$PATH"\nexec ${quote(process.execPath)} ${cli ? quote(cli) + ' ' : ''}"$@"\n`
    await writeFile(path, script, { mode: 0o755 })
  }
  return [join(bin, process.platform === 'win32' ? 'npm.cmd' : 'npm')]
}

function npmProcess(command: string[], args: string[]) {
  if (process.platform !== 'win32') return { command: command[0], args: [...command.slice(1), ...args] }
  // execFile does not launch .cmd files; pi uses cross-spawn for its calls.
  return { command: process.execPath, args: [join(dirname(command[0]), 'npm-run.cjs'), ...args],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', npm_config_cache: join(dirname(command[0]), '../cache/npm'), PATH: `${dirname(command[0])};${process.env.PATH ?? ''}` },
  }
}

export async function installDependencies(command: string[], cwd: string) {
  const npm = npmProcess(command, ['install', '--omit=dev', '--legacy-peer-deps'])
  await new Promise<void>((resolve, reject) => {
    execFile(npm.command, npm.args, { cwd, env: npm.env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(packageError(new Error(`${error.message}\n${stderr}\n${stdout}`)))
      else resolve()
    })
  })
}

export async function packageMetadata(command: string[], source: string) {
  const npm = npmProcess(command, ['view', source.slice(4), '--json'])
  return new Promise<{ name: string; description?: string; pi?: unknown; keywords?: string[] }>((resolve, reject) => {
    execFile(npm.command, npm.args, { env: npm.env, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(packageError(new Error(`${error.message}\n${stderr}`)))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('npm returned unreadable package metadata.')) }
    })
  })
}

export function packageError(error: unknown, output = ''): Error {
  const message = [String((error as Error)?.message ?? error), output].filter(Boolean).join('\n')
  return new Error(/node-gyp|gyp ERR|make:|C\+\+|compiler|xcode/i.test(message)
    ? `This package needs developer tools to build a native addon.\n${message}` : message)
}
