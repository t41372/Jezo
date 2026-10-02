// Opt in on a capable Mac: JEZO_TEST_AFM=1 bun test src/main/agent/foundation-models/native.test.ts
// Uses the shipped helper and real ModelRuntime; only the lookup tool result is synthetic.
import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { InMemoryCredentialStore, Type, type Message } from '@earendil-works/pi-ai'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { APPLE_PROVIDER, appleProvider, availability } from './provider'

const native = test.skipIf(process.env.JEZO_TEST_AFM !== '1' || process.platform !== 'darwin')
native('native availability, streaming, tool handoff, replay, overflow and cancellation', async () => {
  const binary = join(import.meta.dirname, '../../../../native/foundation-models/build/jezo-foundation-models')
  const status = await availability(binary)
  expect(status.reason).toBe('available')
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })
  runtime.registerProvider(APPLE_PROVIDER, appleProvider(binary, status.contextWindow!))
  const model = runtime.getModel(APPLE_PROVIDER, 'system')!
  const messages: Message[] = [{ role: 'user', content: 'What is the secret code for Taipei? Use lookup_code.', timestamp: Date.now() }]
  const tools = [{ name: 'lookup_code', description: 'Look up the secret code for a city.', parameters: Type.Object({ city: Type.String() }) }]
  const systemPrompt = 'Use lookup_code to look up codes. Never invent a code. Report the tool result in your answer.'
  const first = await runtime.completeSimple(model, { systemPrompt, tools, messages })
  expect(first.stopReason).toBe('toolUse')
  const call = first.content.find((part) => part.type === 'toolCall')!
  expect(call.type).toBe('toolCall')
  if (call.type !== 'toolCall') throw new Error('Expected tool call')
  expect(call.name).toBe('lookup_code')
  expect(call.arguments.city).toBe('Taipei')
  messages.push(first, { role: 'toolResult', toolCallId: call.id, toolName: call.name, isError: false,
    content: [{ type: 'text', text: 'The secret code is PINEAPPLE-7429.' }], timestamp: Date.now() })
  const stream = runtime.streamSimple(model, { systemPrompt, tools, messages })
  const events = []
  for await (const event of stream) events.push(event.type)
  const second = await stream.result()
  expect(second.stopReason).toBe('stop')
  expect(second.content.some((part) => part.type === 'text' && part.text.includes('PINEAPPLE-7429'))).toBe(true)
  expect(events).toContain('text_delta')
  expect(second.usage.input).toBeGreaterThan(0)
  const overflow = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'apple orange banana '.repeat(12000), timestamp: 0 }] })
  expect(overflow.stopReason).toBe('error')
  expect(overflow.errorMessage).toContain('context window')
  const limited = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Write a long story about a lighthouse.', timestamp: 0 }] }, { maxTokens: 1 })
  expect(limited.stopReason).toBe('length')
  const unsupported = await runtime.completeSimple(model, {
    tools: [{ name: 'pattern_test', description: 'A tool with an unsupported pattern.', parameters: Type.Object({ code: Type.String({ pattern: '^X$' }) }) }],
    messages: [{ role: 'user', content: 'Use the tool.', timestamp: 0 }],
  })
  expect(unsupported.stopReason).toBe('error')
  expect(unsupported.errorMessage).toContain('pattern')
  // Constraints combined with alternatives, or malformed numeric bounds, must
  // fail before generation rather than silently changing the tool contract.
  const schemaFailures = []
  for (const schema of [
    { anyOf: [{ type: 'integer' }], minimum: 10 },
    { type: 'integer', minimum: 'ten' },
    { type: 'integer', maximum: true },
    { type: 'array', items: { type: 'string' }, minItems: 0.5 },
    { type: 'object', required: ['missing'] },
  ]) {
    const failure = await runtime.completeSimple(model, {
      tools: [{ name: 'constrained', description: 'A constrained input.', parameters: Type.Unsafe(schema) }],
      messages: [{ role: 'user', content: 'Use the tool.', timestamp: 0 }],
    })
    expect(failure.stopReason).toBe('error')
    expect(failure.errorMessage).toContain('constrained')
    schemaFailures.push(failure)
  }
  const controller = new AbortController()
  const pending = runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Write a long story about a lighthouse.', timestamp: 0 }] }, { signal: controller.signal })
  setTimeout(() => controller.abort(), 300)
  const cancelled = await pending
  expect(cancelled.stopReason).toBe('aborted')
  const report = join(import.meta.dirname, '../../../../e2e/results/afm-native.json')
  mkdirSync(join(report, '..'), { recursive: true })
  writeFileSync(report, JSON.stringify({ status, first, second, events, overflow, limited, unsupported, schemaFailures, cancelled }, null, 2))
}, 120_000)
