// Frontmatter edits touch files the user owns, so they're tested on their own.
// Written before the code, from the ways an edit could go wrong:
//
// 1. Lines nobody changed are reformatted: comments, spacing, flow lists, number styles.
// 2. A nested value is replaced but its old child lines stay behind.
// 3. The last key has no newline after it, and the edit glues two lines together.
// 4. A comment between keys disappears or moves.
// 5. The body changes when only the frontmatter was edited, or the other way round.
// 6. CRLF files come back with mixed line endings.
// 7. A file without frontmatter gets a broken one, or loses its text.
// 8. An empty frontmatter block (`---` then `---`).
// 9. Frontmatter that doesn't parse (a duplicate key, bad indentation) is overwritten.
// 10. A value that needs quoting or several lines is written so it reads back differently.
// 11. Setting a key to the value it already has changes the file at all.
// 12. Deleting a key leaves a blank line or eats the next one.
// 13. A body that itself starts with `---` (a markdown rule) is mistaken for frontmatter's end.
// 14. Local times like 2026-09-29T09:30 or 09:30 read back as dates or numbers.

import { describe, expect, test } from 'bun:test'
import { FrontmatterError, parse, patch } from './frontmatter'

const file = `---
id: t-1   # the id
title: 寫第五段
tags: [a, b,   c]
n: 0x1F
steps:
  - text: 找草稿
    done: true
  - text: 寫
    done: false
# the agent's reasoning
why: 早上最有精神
last: 1
---
Some prose.

---

More after a rule.
`

const lines = (text: string) => text.split('\n')

describe('parse', () => {
  test('reads fields and body', () => {
    const { data, body } = parse(file)
    expect(data.title).toBe('寫第五段')
    expect(data.steps).toEqual([
      { text: '找草稿', done: true },
      { text: '寫', done: false },
    ])
    expect(body).toBe('Some prose.\n\n---\n\nMore after a rule.\n') // 13
  })

  test('keeps local times as strings', () => {
    const { data } = parse('---\nscheduled: 2026-09-29T09:30\nat: 09:30\nday: 2026-09-29\n---\n')
    expect(data).toEqual({ scheduled: '2026-09-29T09:30', at: '09:30', day: '2026-09-29' }) // 14
  })

  test('no frontmatter', () => {
    expect(parse('just text\n')).toEqual({ data: {}, body: 'just text\n' })
  })

  test('empty frontmatter', () => {
    expect(parse('---\n---\nbody\n')).toEqual({ data: {}, body: 'body\n' }) // 8
  })

  test('refuses frontmatter that does not parse', () => {
    expect(() => parse('---\na: 1\na: 2\n---\n')).toThrow(FrontmatterError) // 9
    expect(() => parse('---\na: [1\n---\n')).toThrow(FrontmatterError)
  })
})

describe('patch', () => {
  test('changes one scalar and nothing else', () => {
    const out = patch(file, { title: '寫第六段' })
    const a = lines(file)
    const b = lines(out)
    expect(b.length).toBe(a.length)
    const diff = a.flatMap((line, i) => (line === b[i] ? [] : [[line, b[i]]]))
    expect(diff).toEqual([['title: 寫第五段', 'title: 寫第六段']]) // 1, 4, 5
  })

  test('replaces a nested value whole', () => {
    const out = patch(file, { steps: [{ text: '寫', done: true }] })
    expect(parse(out).data.steps).toEqual([{ text: '寫', done: true }]) // 2
    expect(out).not.toContain('找草稿')
    expect(out).toContain('# the agent\'s reasoning\nwhy:') // 4
    expect(out).toContain('tags: [a, b,   c]\nn: 0x1F') // 1
  })

  test('edits the last key', () => {
    const out = patch(file, { last: 2 })
    expect(out).toContain('why: 早上最有精神\nlast: 2\n---\n') // 3
    const bare = '---\na: 1\nb: 2\n---\n'
    expect(patch(bare, { b: 3 })).toBe('---\na: 1\nb: 3\n---\n')
  })

  test('adds a key at the end', () => {
    expect(patch('---\na: 1\n---\nbody\n', { b: 'x' })).toBe('---\na: 1\nb: x\n---\nbody\n')
  })

  test('deletes a key cleanly', () => {
    expect(patch('---\na: 1\nb:\n  - 1\n  - 2\nc: 3\n---\n', { b: undefined })).toBe('---\na: 1\nc: 3\n---\n') // 12
    expect(patch('---\na: 1\nc: 3\n---\n', { c: undefined })).toBe('---\na: 1\n---\n')
    expect(patch('---\na: 1\n---\n', { missing: undefined })).toBe('---\na: 1\n---\n')
  })

  test('same value leaves the file as it was', () => {
    expect(patch(file, { title: '寫第五段', steps: parse(file).data.steps })).toBe(file) // 11
  })

  test('values that need quoting or lines read back the same', () => {
    const values = { a: 'x: y', b: '# not a comment', c: 'line one\nline two', d: 'yes', e: '09:30', f: '', g: ' padded ' }
    expect(parse(patch('---\n---\n', values)).data).toEqual(values) // 10, 14
  })

  test('keeps CRLF', () => {
    const crlf = '---\r\na: 1\r\nb: 2\r\n---\r\nbody\r\n'
    const out = patch(crlf, { a: 5, c: 'new' })
    expect(out).toBe('---\r\na: 5\r\nb: 2\r\nc: new\r\n---\r\nbody\r\n') // 6
  })

  test('adds frontmatter to a file without one', () => {
    expect(patch('just text\n', { id: 'n-1' })).toBe('---\nid: n-1\n---\njust text\n') // 7
  })

  test('replaces the body only', () => {
    expect(patch('---\na: 1\n---\nold\n', {}, 'new\n')).toBe('---\na: 1\n---\nnew\n') // 5
  })

  test('refuses to edit frontmatter that does not parse', () => {
    expect(() => patch('---\na: 1\na: 2\n---\n', { b: 1 })).toThrow(FrontmatterError) // 9
  })
})
