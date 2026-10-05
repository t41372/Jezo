// Recognition uses the installed Standard ASR SDK in the managed Python sidecar.
// Entry points and declarations decide which model and audio path are used.
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import type { SpeechStatus } from '../../shared/bridge'
import type { SpeechCommand } from '../../shared/speech'
import { guidanceOf, options, type SpeechContext } from './context'
import { adapterPath, SpeechEnvironment, speechBin } from './environment'
import { SpeechTranscript } from './transcript'

/**
 * Steps that replace packages or files a recording would load. Reading,
 * checking for updates and saving settings don't stop anyone from talking.
 */
const changing = (step: SpeechStatus['step']) => step !== null && step !== 'checking'

export class Speech {
  private active = new Set<ChildProcessWithoutNullStreams>()
  private environment = new SpeechEnvironment(() => {
    if (this.active.size) throw new Error('Finish dictation before changing speech recognition')
  })

  status() {
    return this.environment.status()
  }
  onStatus(listener: Parameters<SpeechEnvironment['onStatus']>[0]) {
    return this.environment.onStatus(listener)
  }
  install() {
    return this.environment.install()
  }
  inventory() {
    return this.environment.inventory()
  }
  model(id: string) {
    return this.environment.model(id)
  }
  command(command: SpeechCommand) {
    return this.environment.command(command)
  }
  async sampleRate() {
    const status = this.status()
    if (!status.installed || !status.model || changing(status.step)) return null
    const model = (await this.inventory()).models.find((m) => m.id === status.model)
    if (!model || model.error) {
      this.environment.report(null, model?.error ?? 'The selected speech model is no longer installed')
      return null
    }
    return model.dictation?.sampleRate ?? null
  }
  /** Read declarations at startup without downloading, upgrading, or loading a model. */
  async start() {
    if (!this.status().installed) return null
    try {
      return await this.inventory()
    } catch (error) {
      this.environment.report(null, String(error))
      return null
    }
  }
  stop() {
    for (const process of this.active) process.kill()
    this.active.clear()
  }

  async listen(onText: (text: string) => void, context?: SpeechContext, language = 'en') {
    const status = this.status()
    if (!status.installed || !status.model || changing(status.step)) return null
    const inventory = await this.inventory()
    const model = inventory.models.find((m) => m.id === status.model)
    if (!model || model.error) {
      this.environment.report(null, model?.error ?? 'The selected speech model is no longer installed')
      return null
    }
    const capabilities = model.capabilities
    const guided = context
      ? {
          batch: options(context, guidanceOf(capabilities, 'batch'), language),
          streaming: options(context, guidanceOf(capabilities, 'streaming'), language),
        }
      : {}
    const child = spawn(speechBin('python'), [adapterPath()], {
      env: { ...process.env, STANDARD_ASR_ALLOW_DOWNLOAD: '0' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.active.add(child)
    let pending = ''
    let stderr = ''
    let ended = false
    const transcript = new SpeechTranscript()
    let failed = false
    let failure: string | null = null
    let finish!: (result: { text: string; error: string | null }) => void
    const done = new Promise<{ text: string; error: string | null }>((resolve) => {
      finish = resolve
    })
    let ready!: (format: { sampleRate: number } | null) => void
    const opening = new Promise<{ sampleRate: number } | null>((resolve) => {
      ready = resolve
    })
    const fail = (reason: string) => {
      failed = true
      failure = reason
      this.environment.report(null, reason)
      ready(null)
      // Preserve text for display, but never send a failed recognition as a request.
      finish(transcript.result(reason))
      child.kill()
    }
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-2000)
    })
    child.on('error', (error) => fail(String(error)))
    child.stdin.on('error', () => {
      /* close reports an early process exit. */
    })
    child.on('close', (code) => {
      this.active.delete(child)
      ready(null)
      const result = transcript.result(failure ?? (code !== 0 ? stderr || `Speech process exited (${code})` : null))
      if (!failed && result.error) this.environment.report(null, result.error)
      finish(result)
    })
    child.stdout.on('data', (chunk) => {
      pending += String(chunk)
      let end: number
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 1)
        try {
          const { kind, value } = JSON.parse(line)
          if (kind === 'ready') ready(value)
          else if (kind === 'error') fail(typeof value === 'string' ? value : value.message)
          else if (kind === 'transcript') {
            transcript.complete(value.text)
            onText(transcript.preview)
            this.environment.recordDiagnostics(model.id, value.diagnostics ?? [])
          } else if (kind === 'diagnostics') this.environment.recordDiagnostics(model.id, value)
          else if (kind === 'event') {
            const event = value
            if (transcript.event(event)) onText(transcript.preview)
            else if (event.type === 'error') {
              this.environment.recordDiagnostics(model.id, [{
                ...event,
                level: 'warning',
                message: event.extra?.detail || event.code || 'Speech recognition failed',
              }])
              if (!event.recoverable) {
                failed = true
                failure = event.extra?.detail || event.code || 'Speech recognition failed'
                this.environment.report(null, failure)
                // Drain the adapter's final diagnostics before resolving or
                // killing anything; strict capability failures live there.
                ended = true
                child.stdin.end()
              }
            }
          }
        } catch (error) {
          fail(`Speech adapter: ${error}`)
        }
      }
    })
    child.stdin.write(
      JSON.stringify(
        this.environment.request('listen', { model: model.id, guidance: guided, sampleRate: await this.sampleRate() }),
      ) + '\n',
    )
    const format = await opening
    if (!format || failed || child.killed) return null
    this.environment.report(null)
    return {
      sampleRate: format.sampleRate,
      audio(chunk: ArrayBuffer) {
        if (!ended && !child.killed)
          child.stdin.write(JSON.stringify({ kind: 'audio', data: Buffer.from(chunk).toString('base64') }) + '\n')
      },
      end() {
        if (!ended && !child.killed) child.stdin.end(JSON.stringify({ kind: 'end' }) + '\n')
        ended = true
        return done
      },
    }
  }
}
