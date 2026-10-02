// Boundary contracts written before the adapter: real subprocesses, no pi mocks.
import { afterAll, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { InMemoryCredentialStore, normalizeContext, type AssistantMessage } from '@earendil-works/pi-ai'
import { ModelRuntime, SettingsManager } from '@earendil-works/pi-coding-agent'
import { appleProvider, appleStream, appleCompactionOverrides, APPLE_MODEL, APPLE_PROVIDER, availability, toRequest } from './provider'

const dir = mkdtempSync(join(tmpdir(), 'jezo-afm-contract-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
// The provider itself is Mac-only. These fixture executables use Unix shebangs;
// platform gating and transcript tests still run on Windows.
const subprocessTest = test.skipIf(process.platform === 'win32')
let sequence = 0
function helper(body: string) {
  const file = join(dir, `helper-${sequence++}`)
  writeFileSync(file, `#!${process.execPath}\n${body}\n`)
  chmodSync(file, 0o755)
  return file
}
async function runtime(binary: string) {
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null })
  runtime.registerProvider(APPLE_PROVIDER, appleProvider(binary, 8192))
  return { runtime, model: runtime.getModel(APPLE_PROVIDER, 'system')! }
}
const input = { messages: [{ role: 'user' as const, content: 'hello', timestamp: 0 }] }

test('other platforms do not launch the helper', async () => {
  const binary = helper('throw new Error("Must never run")')
  expect((await availability(binary, 'linux', 'x64', '6.0')).reason).toBe('unsupported-system')
  expect((await availability(binary, 'win32', 'arm64', '10.0')).reason).toBe('unsupported-system')
  expect((await availability(binary, 'darwin', 'x64', '26.0')).reason).toBe('device-not-eligible')
  expect((await availability(binary, 'darwin', 'arm64', '24.0')).reason).toBe('unsupported-system')
})

test('missing helper and bad handshake are unavailable without throwing', async () => {
  expect((await availability(join(dir, 'missing'), 'darwin', 'arm64', '26.0')).reason).toBe('helper-unavailable')
  const binary = helper('console.log(JSON.stringify({version: 99, reason: "available", contextWindow: 8192}))')
  expect((await availability(binary, 'darwin', 'arm64', '26.0')).reason).toBe('helper-unavailable')
})

test('system and tool deltas use the public pi replay helpers', () => {
  const request = toRequest(normalizeContext({ messages: [
    { role: 'system', content: 'Base', sections: { day: 'Monday' }, timestamp: 0 },
    ...input.messages,
    { role: 'system', content: 'Update', sections: { day: 'Tuesday' }, timestamp: 1 },
  ] }), 100)
  expect(request.instructions).toContain('Tuesday')
  expect(request.instructions).not.toContain('Monday')
  expect(request.instructions).toContain('Base')
  expect(request.instructions).toContain('Update')
  expect(request.messages).toHaveLength(1)
})

test('unsupported image input is explicit', () => {
  expect(() => toRequest(normalizeContext({ messages: [{ role: 'user', timestamp: 0, content: [{ type: 'image', mimeType: 'image/png', data: 'abc' }] }] }), 100)).toThrow('images')
})

subprocessTest('real ModelRuntime handles snapshots and terminal events', async () => {
  const binary = helper('for (const event of [{type:"usage",input:12},{type:"text",text:"O"},{type:"text",text:"OK"},{type:"done",reason:"stop",output:1}]) console.log(JSON.stringify(event))')
  const { runtime: rt, model } = await runtime(binary)
  const stream = rt.streamSimple(model, input)
  const events = []
  for await (const event of stream) events.push(event)
  const reply = await stream.result()
  expect(events.map(e => e.type)).toEqual(['start', 'text_start', 'text_delta', 'text_delta', 'text_end', 'done'])
  expect(reply.content).toEqual([{ type: 'text', text: 'OK' }])
  expect(reply.usage.totalTokens).toBe(13)
})

for (const body of ['console.log("not json")', 'console.log(JSON.stringify({type:"text",text:"partial"}))', 'process.exit(2)']) {
  subprocessTest(`invalid helper output settles as error: ${body}`, async () => {
    const { runtime: rt, model } = await runtime(helper(body))
    const reply = await rt.completeSimple(model, input)
    expect(reply.stopReason).toBe('error')
  })
}

subprocessTest('abort before spawn and during a stalled request settles as aborted', async () => {
  const binary = helper('setInterval(() => {}, 1000)')
  const { runtime: rt, model } = await runtime(binary)
  const cancelled = AbortSignal.abort()
  expect((await appleStream(binary)(model, normalizeContext(input), { signal: cancelled }).result()).stopReason).toBe('aborted')
  const controller = new AbortController()
  const pending = rt.completeSimple(model, input, { signal: controller.signal })
  setTimeout(() => controller.abort(), 50)
  expect((await pending).stopReason).toBe('aborted')
})

subprocessTest('tool calls are returned to pi without execution', async () => {
  const binary = helper('console.log(JSON.stringify({type:"tool",id:"call-1",name:"read",arguments:"{\\"path\\":\\"test.md\\"}"}));console.log(JSON.stringify({type:"done",reason:"toolUse",output:8}))')
  const { runtime: rt, model } = await runtime(binary)
  const reply = await rt.completeSimple(model, input)
  expect(reply.stopReason).toBe('toolUse')
  expect(reply.content).toEqual([{ type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'test.md' } }])
})

test('missing executable settles and onPayload hooks can inspect requests', async () => {
  const { runtime: rt, model } = await runtime(join(dir, 'missing-executable'))
  let payload: unknown
  const reply = await rt.completeSimple(model, input, { onPayload: (value) => { payload = value } })
  expect(reply.stopReason).toBe('error')
  expect(payload).toMatchObject({ version: 1, messages: [{ role: 'user', text: 'hello' }] })
})

subprocessTest('concurrent requests cannot share text or usage', async () => {
  const binary = helper(`
    let data = '';
    for await (const chunk of process.stdin) data += chunk;
    const request = JSON.parse(data);
    console.log(JSON.stringify({type:'usage',input:request.messages[0].text.length}));
    console.log(JSON.stringify({type:'text',text:request.messages[0].text}));
    console.log(JSON.stringify({type:'done',reason:'stop',output:1}));
  `)
  const { runtime: rt, model } = await runtime(binary)
  const replies = await Promise.all(['first', 'second'].map(content => rt.completeSimple(model, {
    messages: [{ role: 'user', content, timestamp: 0 }],
  })))
  expect(replies.map(reply => reply.content)).toEqual([[{ type: 'text', text: 'first' }], [{ type: 'text', text: 'second' }]])
  expect(replies.map(reply => reply.usage.input)).toEqual([5, 6])
})


test('failed and cancelled assistant turns are not replayed as tool requests', () => {
  const partial: AssistantMessage = {
    role: 'assistant', api: 'jezo-apple-foundation-models', provider: APPLE_PROVIDER, model: 'system',
    content: [{ type: 'toolCall', id: 'unfinished', name: 'read', arguments: { path: 'incomplete' } }],
    stopReason: 'aborted', timestamp: 1,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
  for (const stopReason of ['aborted', 'error'] as const) {
    const context = normalizeContext({ messages: [...input.messages, { ...partial, stopReason },
      { role: 'user', content: 'Try again', timestamp: 2 }] })
    expect(toRequest(context, 100).messages.map(message => message.role)).toEqual(['user', 'user'])
    expect(context.messages).toHaveLength(3)
  }
})

test('partial compaction overrides retain Apple defaults and other models', async () => {
  const { model } = await runtime(join(dir, 'unused'))
  const overrides = { [APPLE_MODEL]: { keepRecentTokens: 256 }, 'other/model': { reserveTokens: 2000 } }
  const settings = SettingsManager.inMemory({ compaction: { reserveTokens: 16000, modelOverrides: appleCompactionOverrides(overrides) } })
  expect(settings.getCompactionSettings(model)).toMatchObject({ reserveTokens: 1024, keepRecentTokens: 256 })
  expect(settings.getSettings().compaction?.modelOverrides?.['other/model']).toEqual({ reserveTokens: 2000 })
  expect(overrides[APPLE_MODEL]).toEqual({ keepRecentTokens: 256 })
})
