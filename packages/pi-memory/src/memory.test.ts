// The memory keeps things about a person, and forgetting has to stick, so it's
// tested on its own. Written before the code, from the ways it could go wrong:
//
// 1. An inference is saved without evidence, or without how sure the agent is.
// 2. Evidence points at something that doesn't exist.
// 3. Something the user deleted is saved again, in the same words or nearly.
// 4. The user asks to remember it again, and can't.
// 5. A replaced preference still shows up, in recall or in what the agent is told.
// 6. Replacing names a memory that doesn't exist, or one already replaced.
// 7. Forgetting leaves the file, or the index still finds it.
// 8. The index can't be rebuilt from the files alone.
// 9. A hand-edited file that doesn't parse breaks everything.
// 10. What the agent is told at the start goes over its budget, or puts guesses before what the user said.
// 11. A memory past its valid_until is still used.
// 12. A short Chinese query ("健身") finds nothing.
// 13. The model claims where a memory came from; the host should say.
// 14. "Stated" is claimed when nothing the user said backs it.
// 15. A changed preference is saved next to the old one instead of replacing it,
//     so both are used and they contradict each other. Found with a real model
//     on 2026-09-30: it left out `replaces` two runs in three.
// 16. A forgotten memory's file comes back (a backup, a sync, a copy) and it's
//     recalled again, though forgotten.yaml still says it was deleted.
// 17. Memories recorded in different zones are ordered by their clocks, so an
//     older one recorded at 16:00 Tokyo goes before a newer one at 11:00 Phoenix.

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { fileStore, Memory } from './memory.ts'

// Run with Node, which has node:sqlite: node --test packages/pi-memory/src/memory.test.ts
function expect(actual: unknown) {
  const matchers = (negate: boolean) => ({
    toEqual: (v: unknown) => (negate ? assert.notDeepStrictEqual(actual, v) : assert.deepStrictEqual(actual, v)),
    toBe: (v: unknown) => (negate ? assert.notStrictEqual(actual, v) : assert.strictEqual(actual, v)),
    toContain: (v: string) => assert.equal(String(actual).includes(v), !negate, `${negate ? 'did not expect' : 'expected'} ${JSON.stringify(v)} in ${JSON.stringify(actual)}`),
    toBeLessThanOrEqual: (v: number) => assert.ok((actual as number) <= v, `${actual} > ${v}`),
  })
  return {
    ...matchers(false),
    not: matchers(true),
    rejects: { toThrow: (pattern: RegExp) => assert.rejects(actual as Promise<unknown>, pattern) },
  }
}

function setup(options: { source?: string; exists?: (ref: string) => boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-memory-'))
  const memory = new Memory({
    store: fileStore(dir),
    source: () => options.source ?? 'user',
    evidenceExists: options.exists ?? ((ref) => !ref.includes('missing')),
    now: () => new Date('2026-09-29T09:00:00'),
  })
  return { dir, memory }
}

const files = (dir: string) => readdirSync(join(dir, 'items'))

describe('remember', () => {
  test('keeps what the user said, as a file, with the source from the host', async () => {
    const { dir, memory } = setup()
    await memory.load()
    const m = await memory.remember({ text: '週日不排工作', about: 'preference', epistemic: 'stated', source: 'connector:evil' } as never)
    expect(files(dir)).toEqual([`${m.id}.md`])
    const text = readFileSync(join(dir, 'items', `${m.id}.md`), 'utf8')
    expect(text).toContain('epistemic: stated')
    expect(text).toContain('source: user') // 13
    expect(text).not.toContain('evil')
    expect(text.trim().endsWith('週日不排工作')).toBe(true)
  })

  test('refuses an inference without evidence or confidence', async () => {
    const { memory } = setup()
    await memory.load()
    await expect(memory.remember({ text: '下午會議多寫不下去', epistemic: 'inferred', confidence: 'medium' })).rejects.toThrow(/evidence/) // 1
    await expect(memory.remember({ text: '下午會議多寫不下去', epistemic: 'inferred', evidence: ['todos/items/t-1.md'] })).rejects.toThrow(/confidence/) // 1
    await expect(
      memory.remember({ text: '下午會議多寫不下去', epistemic: 'inferred', confidence: 'medium', evidence: ['todos/items/missing.md'] }),
    ).rejects.toThrow(/missing/) // 2
    const ok = await memory.remember({ text: '下午會議多寫不下去', epistemic: 'inferred', confidence: 'medium', evidence: ['todos/items/t-1.md'] })
    expect(ok.epistemic).toBe('inferred')
  })

  test('refuses "stated" when no one said it and nothing backs it', async () => {
    const { memory } = setup({ source: 'agent' })
    await memory.load()
    await expect(memory.remember({ text: '喜歡早起', epistemic: 'stated' })).rejects.toThrow(/said/) // 14
    const ok = await memory.remember({ text: '喜歡早起', epistemic: 'stated', evidence: ['notes/items/n-3.md'] })
    expect(ok.source).toBe('agent')
  })
})

describe('forget', () => {
  test('removes the file and the memory, and keeps it from coming back', async () => {
    const { dir, memory } = setup()
    await memory.load()
    const m = await memory.remember({ text: '我討厭早上開會', epistemic: 'stated' })
    await memory.forget(m.id)
    expect(files(dir)).toEqual([]) // 7
    expect(memory.recall('早上開會')).toEqual([]) // 7
    expect(readFileSync(join(dir, 'forgotten.yaml'), 'utf8')).toContain(m.id)
    await expect(memory.remember({ text: '我討厭早上開會', epistemic: 'stated' })).rejects.toThrow(/deleted/) // 3
    await expect(memory.remember({ text: ' 我討厭 早上開會。', epistemic: 'stated' })).rejects.toThrow(/deleted/) // 3
  })

  test('the user can ask for it again', async () => {
    const { memory } = setup()
    await memory.load()
    const m = await memory.remember({ text: '我討厭早上開會', epistemic: 'stated' })
    await memory.forget(m.id)
    const again = await memory.remember({ text: '我討厭早上開會', epistemic: 'stated', again: true }) // 4
    expect(memory.recall('早上開會').map((r) => r.id)).toEqual([again.id])
  })

  test('its file coming back from a backup does not bring it back', async () => {
    const { dir, memory } = setup()
    await memory.load()
    const m = await memory.remember({ text: '我討厭早上開會', epistemic: 'stated' })
    const saved = readFileSync(join(dir, 'items', files(dir)[0]), 'utf8')
    const name = files(dir)[0]
    await memory.forget(m.id)
    writeFileSync(join(dir, 'items', name), saved)
    await memory.load()
    expect(memory.recall('早上開會')).toEqual([]) // 16
    expect(memory.context().text).not.toContain('早上開會') // 16
  })

  test("the agent can't lift it on its own", async () => {
    const { memory } = setup({ source: 'agent' })
    await memory.load()
    const m = await memory.remember({ text: '週日不排工作', epistemic: 'stated', evidence: ['notes/items/n-1.md'] })
    await memory.forget(m.id)
    await expect(memory.remember({ text: '週日不排工作', epistemic: 'stated', evidence: ['notes/items/n-1.md'], again: true })).rejects.toThrow(/deleted/) // 4
  })
})

describe('replace', () => {
  test('the old one stays on disk, marked, and is never used again', async () => {
    const { dir, memory } = setup()
    await memory.load()
    const old = await memory.remember({ text: '早上 6:40 跑步', about: 'preference', epistemic: 'stated' })
    const next = await memory.remember({ text: '改成下班後跑步', about: 'preference', epistemic: 'stated', replaces: old.id })
    expect(files(dir).sort()).toEqual([`${old.id}.md`, `${next.id}.md`].sort())
    expect(readFileSync(join(dir, 'items', `${old.id}.md`), 'utf8')).toContain(`superseded_by: ${next.id}`)
    expect(memory.recall('跑步').map((r) => r.id)).toEqual([next.id]) // 5
    expect(memory.context().text).not.toContain('6:40') // 5
    await expect(memory.remember({ text: 'x', epistemic: 'stated', replaces: 'm-nope' })).rejects.toThrow(/no memory/) // 6
    await expect(memory.remember({ text: 'y', epistemic: 'stated', replaces: old.id })).rejects.toThrow(/already/) // 6
  })
})

describe('related memories', () => {
  test('a new memory close to one already kept waits until the agent says whether it replaces it', async () => {
    const { dir, memory } = setup()
    await memory.load()
    const old = await memory.remember({ text: '我每週三晚上 7 點上吉他課', epistemic: 'stated' })
    await expect(memory.remember({ text: '吉他課改到週四晚上 8 點', epistemic: 'stated' })).rejects.toThrow(new RegExp(old.id)) // 15
    expect(files(dir)).toEqual([`${old.id}.md`])
    const next = await memory.remember({ text: '吉他課改到週四晚上 8 點', epistemic: 'stated', replaces: old.id })
    expect(memory.recall('吉他').map((r) => r.id)).toEqual([next.id])
  })

  test('both stay when the agent says they are separate', async () => {
    const { memory } = setup()
    await memory.load()
    await memory.remember({ text: '週三晚上上吉他課', epistemic: 'stated' })
    await memory.remember({ text: '週三晚上要接小孩', epistemic: 'stated', separate: true })
    expect(memory.recall('週三').length).toBe(2)
  })

  test('something unrelated is saved at once', async () => {
    const { memory } = setup()
    await memory.load()
    await memory.remember({ text: '我每週三晚上 7 點上吉他課', epistemic: 'stated' })
    await memory.remember({ text: '對花生過敏', epistemic: 'stated' })
    await memory.remember({ text: 'Prefers meetings after lunch', epistemic: 'stated' })
    expect(memory.context().text).toContain('花生')
  })
})

describe('provenance', () => {
  test('the host adds where the turn happened; an inference still needs its own evidence', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pi-memory-'))
    const memory = new Memory({ store: fileStore(dir), source: () => 'user', evidenceExists: () => true, provenance: () => ['sessions/s1.jsonl'] })
    await memory.load()
    const m = await memory.remember({ text: '週三上吉他課', epistemic: 'stated' })
    expect(m.evidence).toEqual(['sessions/s1.jsonl'])
    await expect(memory.remember({ text: '晚上比較有空', epistemic: 'inferred', confidence: 'low' })).rejects.toThrow(/evidence/)
    await memory.forget(m.id)
    expect(memory.deleted()[0].evidence).toEqual(['sessions/s1.jsonl'])
  })
})

describe('reading and context', () => {
  test('rebuilds from the files alone, and skips a file that does not parse', async () => {
    const { dir, memory } = setup()
    await memory.load()
    await memory.remember({ text: '週四晚上打排球', epistemic: 'stated' })
    writeFileSync(join(dir, 'items', 'm-broken.md'), '---\nid: [\n---\nx\n')
    const again = new Memory({ store: fileStore(dir), source: () => 'user', evidenceExists: () => true })
    const problems = await again.load() // 8, 9
    expect(again.recall('排球').length).toBe(1)
    expect(problems.map((p) => p.path)).toEqual(['items/m-broken.md'])
  })

  test('finds short Chinese words', async () => {
    const { memory } = setup()
    await memory.load()
    await memory.remember({ text: '去健身房只做 20 分鐘比較容易開始', epistemic: 'stated' })
    expect(memory.recall('健身').length).toBe(1) // 12
  })

  test('leaves out what has expired', async () => {
    const { memory } = setup()
    await memory.load()
    await memory.remember({ text: '這個月在減重', epistemic: 'stated', valid_until: '2026-09-01' })
    expect(memory.recall('減重')).toEqual([]) // 11
    expect(memory.context().text).not.toContain('減重') // 11
  })

  test('tells the agent what the user said first, within its budget', async () => {
    const { memory } = setup()
    await memory.load()
    await memory.remember({ text: '推測：晚上比較有空', epistemic: 'inferred', confidence: 'low', evidence: ['todos/items/t-1.md'] })
    // Near-identical filler, so each is marked separate.
    for (let i = 0; i < 40; i++) await memory.remember({ text: `你說過的第 ${i} 件事，寫長一點讓它佔空間`, epistemic: 'stated', separate: true })
    const small = new Memory({ store: memory.store, source: () => 'user', evidenceExists: () => true, budget: 400 })
    await small.load()
    const { text } = small.context()
    expect(text.length).toBeLessThanOrEqual(400 + 400) // 10: the budget covers the entries; the fixed guidance is extra
    expect(text).not.toContain('推測') // 10: guesses come after what the user said
    expect(text).toContain('memory_recall')
  })

  test('puts the newest first by when it happened, wherever it was recorded', async () => {
    const { dir, memory } = setup()
    await memory.load()
    const tokyo = await memory.remember({ text: '在東京說的', epistemic: 'stated' })
    const phoenix = await memory.remember({ text: '在鳳凰城說的', epistemic: 'stated', separate: true })
    // 16:00 Tokyo is 07:00Z; 11:00 Phoenix, later the same day, is 18:00Z.
    const stamp = (id: string, recorded: string) => {
      const name = files(dir).find((f) => f.startsWith(id))!
      const text = readFileSync(join(dir, 'items', name), 'utf8')
      writeFileSync(join(dir, 'items', name), text.replace(/recorded: .*/, `recorded: '${recorded}'`))
    }
    stamp(tokyo.id, '2026-10-05T16:00:00+09:00')
    stamp(phoenix.id, '2026-10-05T11:00:00-07:00')
    await memory.load()
    expect(memory.context().ids).toEqual([phoenix.id, tokyo.id]) // 17
  })
})
