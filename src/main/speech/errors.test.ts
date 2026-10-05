import { describe, expect, test } from 'bun:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { speechError } from './errors'

// Failures at the subprocess-to-window boundary:
// - execFile includes authenticated arguments when stderr is empty (including timeouts);
// - a tool itself prints authenticated URLs in stderr;
// - truncating first can leave a credential fragment without its URL prefix;
// - Git revisions and useful, non-secret diagnostics must remain readable.
const run = promisify(execFile)
const source = 'https://review-user:FAKE_REVIEW_TOKEN@example.invalid/engine.git@main'

describe('speech operation errors', () => {
  test('uses tool output rather than its authenticated command line', async () => {
    const error = await run(process.execPath, ['-e', 'console.error("Revision not found: release"); process.exit(1)', source]).catch((e) => e)
    expect(String(error)).toContain('FAKE_REVIEW_TOKEN')
    expect(speechError(error)).toBe('Revision not found: release\n')
  })

  test('removes credentials from real subprocess failures without stderr', async () => {
    const error = await run(process.execPath, ['-e', 'process.exit(1)', source]).catch((e) => e)
    expect(speechError(error)).not.toContain('FAKE_REVIEW_TOKEN')
    expect(speechError(error)).not.toContain('review-user')
    expect(speechError(error)).toContain('https://***@example.invalid/engine.git@main')
  })

  test('also handles a killed subprocess with no output', async () => {
    const error = await run(process.execPath, ['-e', 'setInterval(() => {}, 1000)', source], { timeout: 50 }).catch((e) => e)
    expect(error.killed).toBe(true)
    expect(speechError(error)).not.toContain('FAKE_REVIEW_TOKEN')
  })

  test('redacts every URL before limiting the diagnostic length', () => {
    const error = { stderr: `Failed git+${source}\nhttps://${'a'.repeat(2400)}:other%40secret@host.invalid/repo\nhttps://host.invalid/repo@release` }
    const message = speechError(error)
    expect(message).toContain('git+https://***@example.invalid/engine.git@main')
    expect(message).not.toContain('other%40secret')
    expect(message).not.toContain('aaaa')
    expect(message).toContain('https://host.invalid/repo@release')
    expect(speechError(new Error('x'.repeat(3000)))).toHaveLength(2000)
  })
})
