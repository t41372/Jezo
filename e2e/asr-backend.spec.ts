// The speech backend through its public IPC, with real SDK and plugins.
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { SpeechTranscript } from '../src/main/speech/transcript'
import { expect, test } from './jezo'
import { fakeMicrophone, spoken } from './speech-audio'

const run = promisify(execFile)
const ready = process.platform === 'darwin' && process.arch === 'arm64'
const sentence = 'The quick brown fox jumps over the lazy dog. Please remember to buy milk tomorrow.'
const wav = ready ? spoken(sentence, 'Samantha') : ''

const other = 'Call the dentist on Friday afternoon about the appointment.'
const otherWav = ready ? spoken(other, 'Samantha') : ''

/** A WAV file's samples at the rate recognition takes, as base64 PCM. */
async function pcmAt(file: string, sampleRate: number) {
  const converted = `${file}.${sampleRate}.wav`
  await run('afconvert', ['-f', 'WAVE', '-d', `LEI16@${sampleRate}`, '-c', '1', file, converted])
  const audio = readFileSync(converted)
  const start = audio.indexOf('data')
  return audio.subarray(start + 8, start + 8 + audio.readUInt32LE(start + 4)).toString('base64')
}

async function dictate(page: Page) {
  const sampleRate = await page.evaluate(() => window.jezo.speech.start())
  expect(sampleRate).toBeTruthy()
  const pcm = await pcmAt(wav, sampleRate as number)
  return page.evaluate(async (encoded) => {
    const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))
    for (let at = 0; at < bytes.length; at += 8192) window.jezo.speech.audio(bytes.slice(at, at + 8192).buffer)
    return window.jezo.speech.end()
  }, pcm)
}

test.describe('Standard ASR PR 107 backend', { tag: '@speech' }, () => {
  test.skip(!ready, 'Requires Apple Silicon, uv and real model artifacts.')
  test.describe.configure({ timeout: 600_000 })
  test.use({ prepare: { model: null, args: fakeMicrophone(wav) } })

  test('native session contract, dynamic settings, and two real engines', async ({ jezo }, info) => {
    const { page, data } = jezo
    await page.evaluate(() => window.jezo.speech.install())
    const inventory = await page.evaluate(() => window.jezo.speech.inventory())
    expect(inventory.runtime).toEqual({ stableText: true, sessionCapabilityChecks: true })
    expect(inventory.models.filter((model) => model.error)).toEqual([])

    const replay = await run(join(data, 'speech/venv/bin/python'), ['-B', 'e2e/fixtures/asr-session-replay.py'])
    type Message = { kind: string; value: any }
    const cases = JSON.parse(replay.stdout) as { name: string; messages: Message[] }[]
    for (const scenario of cases) {
      const transcript = new SpeechTranscript()
      const codes: string[] = []
      let failure: string | null = null
      for (const message of scenario.messages) {
        if (message.kind === 'event') {
          transcript.event(message.value)
          if (message.value.type === 'error' && !message.value.recoverable) failure = message.value.code
          if (['partial', 'final'].includes(message.value.type)) {
            expect(typeof message.value.stable_text).toBe('string')
            expect(message.value).not.toHaveProperty('stable_until')
          }
        }
        if (message.kind === 'transcript') transcript.complete(message.value.text)
        if (message.kind === 'diagnostics') codes.push(...message.value.map((d: { code: string }) => d.code))
      }
      const result = transcript.result(failure)
      if (scenario.name === 'unicode-supersede-closed') {
        expect(result.error).toBeNull()
        expect(result.text).toContain('新！')
        expect(result.text).toContain('ใหม่')
        expect(result.text.indexOf('新！')).toBeLessThan(result.text.indexOf(' tail'))
        expect(result.text).not.toContain('𠮷野家')
      } else if (scenario.name === 'abandoned-stable-text') {
        expect(result).toEqual({ text: '', error: null })
        expect(codes).toContain('stable_text_abandoned')
      } else if (scenario.name === 'effective-capabilities') {
        expect(codes).toEqual(expect.arrayContaining(['stream_exceeds_emits_partials', 'stream_exceeds_partial_stability', 'stream_exceeds_re_segments', 'finality_level_not_reached']))
        expect(codes.filter((c) => c === 'stream_exceeds_emits_partials')).toHaveLength(1)
        expect(result.text).toBe('replacement')
      } else {
        expect(result.error).toBe('engine_error')
        expect(scenario.messages.some((message) => message.kind === 'transcript')).toBe(false)
        expect(scenario.messages.at(-1)?.kind).toBe('diagnostics')
      }
    }
    await info.attach('native-session-contract', { body: replay.stdout, contentType: 'application/json' })

    // New MLX window/pause settings arrive through the plugin's own schema.
    const mlx = await page.evaluate(() => window.jezo.speech.model('mlx-audio/qwen3-asr-0.6b'))
    expect(mlx.configSchema.properties).toHaveProperty('commit_pause_s')
    expect(mlx.effectiveCapabilities?.streaming).toHaveProperty('partial_stability')
    expect(mlx.configurationError).toBeNull()
    await page.evaluate(() => window.jezo.speech.command({ kind: 'saveModel', model: 'mlx-audio/qwen3-asr-0.6b',
      settings: { config: { max_window_s: 4, commit_pause_s: 0.8, redecode_interval_s: 0.5 }, options: {}, provider: {} }, secrets: {} }))
    const mlxResult = await dictate(page)
    expect(mlxResult.error).toBeNull()
    expect(mlxResult.text.toLowerCase()).toContain('milk')

    await page.evaluate(() => window.jezo.speech.command({ kind: 'installPlugin', requirement:
      'std-faster-whisper @ git+https://github.com/standard-voice/std-faster-whisper.git@aee319ff713d0e1d3656609954097fc1cdbfc8ef' }))
    await page.evaluate(() => window.jezo.speech.command({ kind: 'saveModel', model: 'faster-whisper/tiny',
      settings: { config: { device: 'cpu', compute_type: 'int8' }, options: { language: 'en' }, provider: {} }, secrets: {} }))
    await page.evaluate(() => window.jezo.speech.command({ kind: 'acquire', model: 'faster-whisper/tiny', mode: 'batch', refresh: false }))
    await page.evaluate(() => window.jezo.speech.command({ kind: 'select', model: 'faster-whisper/tiny' }))
    const whisperResult = await dictate(page)
    expect(whisperResult.error).toBeNull()
    expect(whisperResult.text.toLowerCase()).toContain('milk')

    // The remote Qwen plugin now conforms; discovery/config/artifacts require
    // no network inference service, but actual remote inference still does.
    await page.evaluate(() => window.jezo.speech.command({ kind: 'installPlugin', requirement:
      'std-qwen3-asr @ git+https://github.com/standard-voice/std-qwen3-asr.git@7b0bc5444f35cbb346d86c61dfaab70aff0fe2dd' }))
    const final = await page.evaluate(() => window.jezo.speech.inventory())
    expect(final.models.filter((model) => model.engine === 'qwen3-asr')).toHaveLength(3)
    expect(final.models.filter((model) => model.error)).toEqual([])
    expect(final.sessionDiagnostics.filter(({ diagnostic }) => /^(stream_exceeds_|stable_text_|finality_level_)/.test(diagnostic.code))).toEqual([])
    await info.attach('real-inference-and-inventory', { body: JSON.stringify({ mlxResult, whisperResult, inventory: final }, null, 2), contentType: 'application/json' })
    expect(jezo.errors).toEqual([])
  })

  test('a hold released and pressed again while Python starts keeps the two recordings apart', async ({ jezo }, info) => {
    const { page } = jezo
    await page.evaluate(() => window.jezo.speech.install())
    const sampleRate = await page.evaluate(() => window.jezo.speech.sampleRate())
    expect(sampleRate).toBeTruthy()
    const [first, second] = await Promise.all([pcmAt(wav, sampleRate!), pcmAt(otherWav, sampleRate!)])
    // Both holds start, send all their audio and end before either process is ready.
    const results = await page.evaluate(async ([a, b]) => {
      const send = (encoded: string) => {
        const bytes = Uint8Array.from(atob(encoded), (ch) => ch.charCodeAt(0))
        for (let at = 0; at < bytes.length; at += 8192) window.jezo.speech.audio(bytes.slice(at, at + 8192).buffer)
      }
      void window.jezo.speech.start()
      send(a)
      const firstEnd = window.jezo.speech.end()
      void window.jezo.speech.start()
      send(b)
      const secondEnd = window.jezo.speech.end()
      return Promise.all([firstEnd, secondEnd])
    }, [first, second])
    await info.attach('overlapping-holds', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })
    expect(results[0].error).toBeNull()
    expect(results[1].error).toBeNull()
    expect(results[0].text.toLowerCase()).toContain('milk')
    expect(results[0].text.toLowerCase()).not.toContain('dentist')
    expect(results[1].text.toLowerCase()).toContain('dentist')
    expect(results[1].text.toLowerCase()).not.toContain('milk')
    expect(jezo.errors).toEqual([])
  })
})
