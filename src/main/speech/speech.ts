// Speech recognition through Standard ASR (docs/design/backend.md, "Speech").
// Jezo keeps a Python environment of its own, made with uv, holding the
// standard-asr core and one engine, and runs its reference server on a local
// port. Holding ⌥X streams audio to it and gets the text back as it's heard.

import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { SpeechStatus } from '../../shared/bridge'
import { guidanceOf, options, type Guidance, type SpeechContext } from './context'

const run = promisify(execFile)

/** A package from git at a fixed commit: `name` as pip names it, `dist` as its installed metadata does. */
interface Pinned {
  name: string
  dist: string
  repo: string
  commit: string
}

const requirement = (p: Pinned, extras = '') => `${p.name}${extras} @ git+${p.repo}@${p.commit}`

/**
 * The core and the engines, from git: the release on PyPI predates protocol
 * 0.2, and main has fixes and changes to the protocol that aren't released
 * yet (Tim, 2026-10-01). Each is fixed to a commit on main, so every install
 * gets the same code and a change on main can't break an install that works;
 * moving a commit here updates installs when Jezo next starts.
 */
const CORE: Pinned = { name: 'standard-asr', dist: 'standard_asr', repo: 'https://github.com/standard-voice/standard_asr.git', commit: '1b2cf3fa5860c075e5160eb60b26b708a7c8bfea' }

/** The engine for this machine. MLX runs on Apple Silicon's GPU; elsewhere faster-whisper runs on the CPU. */
const ENGINE =
  process.platform === 'darwin' && process.arch === 'arm64'
    ? {
        name: 'Qwen3-ASR 0.6B',
        model: 'mlx-audio/qwen3-asr-0.6b',
        package: { name: 'std-mlx-audio', dist: 'std_mlx_audio', repo: 'https://github.com/standard-voice/std-mlx-audio.git', commit: '474277b39192abc8bed9be8d2d66d06ec0fd43e2' },
      }
    : {
        name: 'Whisper small',
        model: 'faster-whisper/small',
        package: { name: 'std-faster-whisper', dist: 'std_faster_whisper', repo: 'https://github.com/standard-voice/std-faster-whisper.git', commit: 'b902b1394efeff4c30fb968517ddd6fe96a29655' },
      }

const dir = () => join(app.getPath('userData'), 'speech')
const bin = (name: string) => join(dir(), 'venv', 'bin', name)

/** The commit a git package was installed from, from the metadata pip leaves (PEP 610), or null. */
function installedCommit(p: Pinned) {
  const lib = join(dir(), 'venv', 'lib')
  try {
    for (const python of readdirSync(lib)) {
      const site = join(lib, python, 'site-packages')
      const info = readdirSync(site).find((name) => name.startsWith(`${p.dist}-`) && name.endsWith('.dist-info'))
      if (info) return (JSON.parse(readFileSync(join(site, info, 'direct_url.json'), 'utf8')) as { vcs_info?: { commit_id?: string } }).vcs_info?.commit_id ?? null
    }
  } catch {
    // Not installed, or installed some other way.
  }
  return null
}

/** Whether what's installed is older or newer than the commits above. */
const outdated = () => [CORE, ENGINE.package].some((p) => installedCommit(p) !== p.commit)

/** uv, wherever it's installed. A packaged app doesn't get the shell's PATH, so the usual places are tried too. */
function findUv() {
  const candidates = [
    ...(process.env.PATH ?? '').split(':').map((p) => join(p, 'uv')),
    '/opt/homebrew/bin/uv',
    '/usr/local/bin/uv',
    join(homedir(), '.local/bin/uv'),
    join(homedir(), '.cargo/bin/uv'),
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

export type StepListener = (status: SpeechStatus) => void

export class Speech {
  private server: ChildProcess | null = null
  private port: number | null = null
  private starting: Promise<number | null> | null = null
  /** What the engine takes besides audio, read from the server once; null until that worked. */
  private guidance: Guidance | null = null
  private step: SpeechStatus['step'] = null
  private error: string | null = null
  private listeners = new Set<StepListener>()

  status(): SpeechStatus {
    return {
      installed: existsSync(bin('standard-asr')),
      engine: ENGINE.name,
      step: this.step,
      error: this.error,
      uv: findUv() !== null,
    }
  }

  onStatus(listener: StepListener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private report(step: SpeechStatus['step'], error: string | null = null) {
    this.step = step
    this.error = error
    for (const listener of this.listeners) listener(this.status())
  }

  /** Makes the environment, installs the core and the engine, and gets the model. Safe to run again. */
  async install() {
    const uv = findUv()
    if (!uv) return this.report(null, 'uv')
    try {
      this.report('environment')
      if (!existsSync(bin('python'))) await run(uv, ['venv', '--python', '3.12', join(dir(), 'venv')])
      await this.installPackages(uv)
      this.report('model')
      await run(bin('standard-asr'), ['pull', ENGINE.model, '--json'], { maxBuffer: 16 * 1024 * 1024 })
      this.report(null)
      // A server already running has the old packages loaded.
      this.stop()
      void this.start()
    } catch (error) {
      this.report(null, String((error as { stderr?: string }).stderr || error).slice(-600))
    }
  }

  /**
   * Installs the core and the engine at their commits. The engines ask for
   * the core at main by URL, which pip would take as a second, conflicting
   * source; the override makes the commit above the only one.
   */
  private async installPackages(uv: string) {
    this.report('packages')
    const overrides = join(dir(), 'overrides.txt')
    writeFileSync(overrides, `${requirement(CORE, '[server]')}\n`)
    await run(uv, ['pip', 'install', '--python', bin('python'), '--overrides', overrides, requirement(CORE, '[server]'), requirement(ENGINE.package)], { maxBuffer: 16 * 1024 * 1024 })
  }

  /**
   * Moves an install to the commits this Jezo names, before the server starts.
   * If it can't (offline, say), the server runs what's there, and 設定 says why.
   */
  private async update() {
    const uv = findUv()
    if (!uv || !outdated()) return
    try {
      await this.installPackages(uv)
      this.report(null)
    } catch (error) {
      this.report(null, String((error as { stderr?: string }).stderr || error).slice(-600))
    }
  }

  /** Starts the server if it isn't running. Resolves to its port, or null if speech isn't installed. */
  start(): Promise<number | null> {
    if (this.port) return Promise.resolve(this.port)
    if (!this.status().installed) return Promise.resolve(null)
    this.starting ??= (async () => {
      await this.update()
      const port = await freePort()
      this.server = spawn(bin('standard-asr'), ['serve', '--host', '127.0.0.1', '--port', String(port)], {
        // The model was fetched at install; nothing downloads while the user talks.
        env: { ...process.env, STANDARD_ASR_ALLOW_DOWNLOAD: '0' },
        stdio: 'ignore',
      })
      this.server.on('exit', () => {
        this.server = null
        this.port = null
        this.starting = null
      })
      for (let i = 0; i < 120; i++) {
        try {
          if ((await fetch(`http://127.0.0.1:${port}/v1/health`)).ok) {
            this.port = port
            return port
          }
        } catch {
          // Not up yet.
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      this.stop()
      return null
    })()
    return this.starting
  }

  stop() {
    this.guidance = null
    this.server?.kill()
    this.server = null
    this.port = null
    this.starting = null
  }

  /**
   * What the engine takes besides audio. A failed read is tried again on the
   * next utterance; until then, nothing extra is sent, which every engine takes.
   */
  private async guidanceOf(port: number): Promise<Guidance> {
    if (this.guidance) return this.guidance
    try {
      const response = await fetch(`http://127.0.0.1:${port}/v1/capabilities/${ENGINE.model}`, { signal: AbortSignal.timeout(2000) })
      if (response.ok) this.guidance = guidanceOf(await response.json())
    } catch {
      // Tried again next time.
    }
    return this.guidance ?? {}
  }

  /**
   * Streams one utterance. `onText` gets the whole text heard so far each time
   * it changes; `end()` says the audio is over and resolves to the final text.
   * `context` is what the user is likely to say (./context.ts), sent as far as
   * the engine takes it; `language` is the app's, for how it's written.
   */
  async listen(onText: (text: string) => void, context?: SpeechContext, language = 'en') {
    const port = await this.start()
    if (!port) return null
    const guidance = context ? await this.guidanceOf(port) : {}
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream/${ENGINE.model}`)
    ws.binaryType = 'arraybuffer'
    // Audio that arrives before the connection opens waits here.
    const queued: ArrayBuffer[] = []
    // The protocol's reduce: segments in reading order, each replaced whole by its latest text.
    const order: string[] = []
    const texts = new Map<string, string>()
    const joined = () => order.map((id) => texts.get(id) ?? '').join('')
    let finish: (text: string) => void
    const done = new Promise<string>((resolve) => (finish = resolve))

    ws.onopen = () => {
      const guided = context && options(context, guidance, language)
      ws.send(JSON.stringify({ audio_format: { encoding: 'pcm_s16le', sample_rate: 16000, channels: 1 }, ...(guided && { options: guided }) }))
      for (const chunk of queued.splice(0)) ws.send(chunk)
    }
    ws.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as {
        type: string
        segment_id?: string
        text?: string
        old_ids?: string[]
        new_ids?: string[]
        recoverable?: boolean
        message?: string
      }
      if ((event.type === 'partial' || event.type === 'final') && event.segment_id) {
        if (!order.includes(event.segment_id)) order.push(event.segment_id)
        texts.set(event.segment_id, event.text ?? '')
        onText(joined())
      } else if (event.type === 'supersede' && event.old_ids?.length && event.new_ids) {
        const at = order.indexOf(event.old_ids[0])
        for (const id of event.old_ids) {
          order.splice(order.indexOf(id), 1)
          texts.delete(id)
        }
        order.splice(Math.max(0, at), 0, ...event.new_ids)
      } else if (event.type === 'done' || (event.type === 'error' && (event.message !== undefined || event.recoverable === false))) {
        finish(joined())
        ws.close()
      }
    }
    ws.onclose = () => finish(joined())
    ws.onerror = () => finish(joined())

    return {
      audio(chunk: ArrayBuffer) {
        if (ws.readyState === WebSocket.OPEN) ws.send(chunk)
        else if (ws.readyState === WebSocket.CONNECTING) queued.push(chunk)
      },
      end() {
        // Any text frame means the audio is over.
        if (ws.readyState === WebSocket.OPEN) ws.send('')
        else if (ws.readyState === WebSocket.CONNECTING) ws.addEventListener('open', () => ws.send(''))
        return done
      },
    }
  }
}
