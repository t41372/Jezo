// The automation history decides whether a time may run, so reading it is
// tested on its own. Ways it could fail, written before the code:
//
// 1. A damaged line in the middle is dropped, and a claim it held disappears, so the time runs again.
// 2. A line that's valid JSON but not an event (null, a number, a claim without its attempt) is taken as an event.
// 3. A last line a crash cut off mid-append is reported as damage, though it never happened.
// 4. A run the user retried after it couldn't reach the model still counts as given back, so the scheduler starts it beside the retry.
// 5. A resumed run that ends again isn't taken as ended.

import { describe, expect, test } from 'bun:test'
import { parseHistory, summarize } from './history'

const line = (event: object) => `${JSON.stringify(event)}\n`
const claimed = { type: 'claimed', attempt: 'at-1', slot: '2026-10-01T08:00', origin: 'scheduled', session: 's-1', at: '2026-10-01T08:00:30-07:00' }

describe('reading', () => {
  test('a damaged line in the middle is a problem, with its line number (1)', () => {
    const text = line({ type: 'watching', at: '2026-10-01T07:00:00-07:00', zone: 'America/Phoenix' }) + '{"type":"claimed","attem\n' + line({ type: 'ended', attempt: 'at-1', outcome: 'completed', at: '2026-10-01T08:05:00-07:00' })
    const read = parseHistory(text, 'automations/history/a.jsonl')
    expect(read.problems).toEqual([{ path: 'automations/history/a.jsonl', line: 2, message: "This line isn't JSON." }])
    expect(read.events).toHaveLength(2)
  })
  test('JSON that is not an event is a problem (2)', () => {
    for (const bad of ['null', '42', JSON.stringify({ type: 'claimed', slot: 'x', origin: 'scheduled', at: 'x' }), JSON.stringify({ type: 'ended', attempt: 'a', outcome: 'done', at: 'x' })]) {
      expect(parseHistory(`${bad}\n`, 'h').problems).toHaveLength(1)
    }
  })
  test('a last line without its newline was never written, and is not a problem (3)', () => {
    const read = parseHistory(line(claimed) + '{"type":"ended","att', 'h')
    expect(read.problems).toEqual([])
    expect(read.torn).toBe(true)
    expect(read.events).toHaveLength(1)
  })
})

describe('what ran', () => {
  const unreachable = { type: 'ended', attempt: 'at-1', outcome: 'unreachable', at: '2026-10-01T08:01:00-07:00' }
  test('a time given back after the model could not be reached is held again once the user retries it (4)', () => {
    const given = parseHistory(line(claimed) + line(unreachable), 'h').events
    expect(summarize(given).claimed.has('2026-10-01T08:00')).toBe(false)
    const resumed = parseHistory(line(claimed) + line(unreachable) + line({ type: 'resumed', attempt: 'at-1', at: '2026-10-01T08:10:00-07:00' }), 'h').events
    expect(summarize(resumed).claimed.has('2026-10-01T08:00')).toBe(true)
    expect(summarize(resumed).unfinished.map((c) => c.attempt)).toEqual(['at-1'])
  })
  test('a resumed run that ends again is ended (5)', () => {
    const events = parseHistory(line(claimed) + line(unreachable) + line({ type: 'resumed', attempt: 'at-1', at: '2026-10-01T08:10:00-07:00' }) + line({ type: 'ended', attempt: 'at-1', outcome: 'completed', at: '2026-10-01T08:12:00-07:00' }), 'h').events
    expect(summarize(events).unfinished).toEqual([])
    expect(summarize(events).lastFinished?.attempt).toBe('at-1')
  })
})
