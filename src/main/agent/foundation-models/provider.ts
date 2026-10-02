// The only pi ↔ Apple boundary. No Electron imports or native Node modules.
import { execFile, spawn } from 'node:child_process'
import { release } from 'node:os'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import {
  createAssistantMessageEventStream, getCurrentSystemPrompt, getCurrentTools,
  type AssistantMessage, type StreamFunction, type TranscriptContext,
} from '@earendil-works/pi-ai'
import type { CompactionModelOverride, ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AppleAvailabilityReason as AvailabilityReason } from '../../../shared/bridge'

export const APPLE_PROVIDER = 'apple-foundation-models'
export const APPLE_MODEL = `${APPLE_PROVIDER}/system`

/** Merge per field so a partial user override cannot restore pi's 16K reserve. */
export function appleCompactionOverrides(overrides: Record<string, CompactionModelOverride> = {}) {
  return {
    ...overrides,
    [APPLE_MODEL]: { reserveTokens: 1024, keepRecentTokens: 1024, ...overrides[APPLE_MODEL] },
  }
}

export interface AppleAvailability { reason: AvailabilityReason; contextWindow?: number }
const reasons: AvailabilityReason[] = ['available', 'unsupported-system', 'device-not-eligible', 'intelligence-disabled', 'model-not-ready', 'unavailable']
const execute = promisify(execFile)

export async function availability(binary: string, platform = process.platform, arch = process.arch, kernel = release()): Promise<AppleAvailability> {
  // Darwin 25 is macOS 26. Do not even launch an Apple executable on other systems.
  if (platform !== 'darwin' || Number.parseInt(kernel) < 25) return { reason: 'unsupported-system' }
  if (arch !== 'arm64') return { reason: 'device-not-eligible' }
  try {
    const { stdout } = await execute(binary, ['--availability'], { timeout: 10_000, maxBuffer: 64 * 1024 })
    const result = JSON.parse(stdout)
    if (result.version !== 1 || !reasons.includes(result.reason)) throw new Error('Invalid helper handshake')
    if (result.reason === 'available' && (!Number.isSafeInteger(result.contextWindow) || result.contextWindow <= 0)) throw new Error('Invalid context window')
    return { reason: result.reason, contextWindow: result.contextWindow }
  } catch {
    return { reason: 'helper-unavailable' }
  }
}

export function toRequest(context: TranscriptContext, maxTokens: number, temperature?: number) {
  const text = (content: string | { type: string; text?: string }[]) => {
    if (typeof content === 'string') return content
    if (content.some((part) => part.type === 'image')) throw new Error('Apple Foundation Models in Jezo does not accept images yet. Choose a model that supports images.')
    return content.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n')
  }
  return {
    version: 1,
    instructions: getCurrentSystemPrompt(context.messages),
    tools: getCurrentTools(context.messages).map((tool) => ({ name: tool.name, description: tool.description, schema: JSON.stringify(tool.parameters) })),
    messages: context.messages.flatMap((message) => {
      if (message.role === 'system') return []
      // pi records failed streams for display, but their partial tool calls never
      // ran. Replaying them would leave Apple's transcript waiting for results.
      if (message.role === 'assistant' && (message.stopReason === 'error' || message.stopReason === 'aborted')) return []
      if (message.role === 'user') return [{ role: 'user', text: text(message.content) }]
      if (message.role === 'toolResult') return [{ role: 'tool', id: message.toolCallId, name: message.toolName, text: `${message.isError ? 'Tool failed:\n' : ''}${text(message.content)}` }]
      // Provider-specific thinking is not a user-visible answer. Tool calls retain their IDs.
      return [{ role: 'assistant', text: text(message.content), calls: message.content.flatMap((part) =>
        part.type === 'toolCall' ? [{ id: part.id, name: part.name, arguments: JSON.stringify(part.arguments) }] : []) }]
    }),
    maxTokens,
    temperature,
  }
}

/** Per-generation subprocesses keep cancellation, branching and model switches independent. */
export function appleStream(binary: string): StreamFunction {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream()
    const output: AssistantMessage = {
      role: 'assistant', api: model.api, provider: model.provider, model: model.id,
      content: [], stopReason: 'pending', timestamp: Date.now(),
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    }
    void (async () => {
      let child: ReturnType<typeof spawn> | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let textIndex = -1
      let textEnded = false
      const finishText = () => {
        if (textIndex < 0 || textEnded) return
        const part = output.content[textIndex]
        if (part.type === 'text') stream.push({ type: 'text_end', contentIndex: textIndex, content: part.text, partial: output })
        textEnded = true
      }
      const abort = () => { child?.kill('SIGKILL') }
      try {
        options?.signal?.throwIfAborted()
        const request = toRequest(context, Math.min(options?.maxTokens ?? model.maxTokens, model.maxTokens), options?.temperature)
        const payload = await options?.onPayload?.(request, model) ?? request
        options?.signal?.throwIfAborted()
        child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })
        const worker = child
        process.once('exit', abort)
        let failure: Error | undefined
        // Attach rejection handlers before writing stdin or reading stdout.
        const closed = new Promise<void>((resolve) => {
          worker.once('error', (error) => { failure = error; resolve() })
          worker.once('close', (code, signal) => {
            if (code !== 0) failure ??= new Error(`Apple Foundation Models helper exited (${signal ?? code}).`)
            resolve()
          })
        })
        worker.stdin!.on('error', (error) => { failure ??= error })
        // Drain stderr so the native runtime cannot block. Do not log private prompts.
        worker.stderr!.resume()
        options?.signal?.addEventListener('abort', abort, { once: true })
        if (options?.signal?.aborted) abort()
        timer = setTimeout(() => {
          failure = new Error('Apple Foundation Models timed out. Try a shorter request.')
          worker.kill('SIGKILL')
        }, options?.timeoutMs ?? 120_000)
        await new Promise<void>((resolve, reject) => {
          worker.once('spawn', resolve)
          worker.once('error', reject)
          worker.once('close', () => reject(new Error('Apple Foundation Models helper closed before starting.')))
        })
        options?.signal?.throwIfAborted()
        worker.stdin!.end(JSON.stringify(payload))
        stream.push({ type: 'start', partial: output })
        let done = false
        const lines = createInterface({ input: worker.stdout! })
        for await (const line of lines) {
          if (done) throw new Error('Apple Foundation Models sent data after completion.')
          const event = JSON.parse(line)
          switch (event.type) {
            case 'usage':
              if (!Number.isSafeInteger(event.input) || event.input < 0) throw new Error('Invalid input usage.')
              output.usage.input = event.input
              break
            case 'text': {
              if (typeof event.text !== 'string' || textEnded) throw new Error('Invalid text snapshot.')
              if (textIndex < 0) {
                textIndex = output.content.length
                output.content.push({ type: 'text', text: '' })
                stream.push({ type: 'text_start', contentIndex: textIndex, partial: output })
              }
              const part = output.content[textIndex]
              if (part.type !== 'text' || !event.text.startsWith(part.text)) throw new Error('Apple Foundation Models revised an already streamed response.')
              const delta = event.text.slice(part.text.length)
              part.text = event.text
              if (delta) stream.push({ type: 'text_delta', contentIndex: textIndex, delta, partial: output })
              break
            }
            case 'tool': {
              finishText()
              if (typeof event.id !== 'string' || typeof event.name !== 'string' || typeof event.arguments !== 'string') throw new Error('Invalid tool call.')
              const args = JSON.parse(event.arguments)
              if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Invalid tool arguments.')
              const toolCall = { type: 'toolCall' as const, id: event.id, name: event.name, arguments: args }
              const contentIndex = output.content.length
              output.content.push(toolCall)
              stream.push({ type: 'toolcall_start', contentIndex, partial: output })
              stream.push({ type: 'toolcall_end', contentIndex, toolCall, partial: output })
              break
            }
            case 'done':
              if (!['stop', 'length', 'toolUse'].includes(event.reason) || !Number.isSafeInteger(event.output) || event.output < 0) throw new Error('Invalid completion.')
              if ((event.reason === 'toolUse') !== output.content.some((part) => part.type === 'toolCall')) throw new Error('Tool completion does not match the response.')
              output.stopReason = event.reason
              output.usage.output = event.output
              done = true
              break
            case 'error': throw new Error(typeof event.message === 'string' ? event.message : 'Apple Foundation Models failed.')
            default: throw new Error('Unknown Apple Foundation Models bridge event.')
          }
        }
        await closed
        options?.signal?.throwIfAborted()
        if (failure) throw failure
        if (!done) throw new Error('Apple Foundation Models stopped before completing its response.')
        finishText()
        output.usage.totalTokens = output.usage.input + output.usage.output
        stream.push({ type: 'done', reason: output.stopReason as 'stop' | 'length' | 'toolUse', message: output })
      } catch (error) {
        output.stopReason = options?.signal?.aborted ? 'aborted' : 'error'
        output.usage.totalTokens = output.usage.input + output.usage.output
        output.errorMessage = error instanceof Error ? error.message : String(error)
        stream.push({ type: 'error', reason: output.stopReason, error: output })
      } finally {
        if (timer) clearTimeout(timer)
        options?.signal?.removeEventListener('abort', abort)
        process.removeListener('exit', abort)
        child?.kill('SIGKILL')
        stream.end()
      }
    })()
    return stream
  }
}

export function appleProvider(binary: string, contextWindow: number): Parameters<ModelRuntime['registerProvider']>[1] {
  return {
    // pi requires a base URL for custom models; this adapter never opens it.
    name: 'Apple Foundation Models', baseUrl: 'local://apple-foundation-models', api: 'jezo-apple-foundation-models', apiKey: 'on-device',
    streamSimple: appleStream(binary),
    models: [{ id: 'system', name: 'Apple on-device', input: ['text'], reasoning: false,
      contextWindow, maxTokens: Math.min(1024, Math.floor(contextWindow / 4)),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }],
  }
}
