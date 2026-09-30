// 1. A GitHub address may lack a repository, use another host, or name a blob other than SKILL.md.
// 2. A tree may contain no skills, nested skills, hidden directories, or a broken SKILL.md.
// 3. A name may have capitals, spaces, repeated hyphens, no ASCII characters, or exceed 64 characters.
// 4. An archive may contain traversal, absolute paths, links, or paths rewritten by its parser.
// 5. A download may exceed 50 MB, unpack to far more than it downloads, or a skill may have more than 2,000 files.
// 6. Bytes may be invalid UTF-8 or contain NUL; valid text must survive without losing its BOM.
// 7. Tar and ZIP link modes, or long PAX/ustar paths, may be lost by the archive adapter.

import { describe, expect, test } from 'bun:test'
import { createTar } from 'nanotar'
import { gzipSync, zipSync } from 'fflate'
import { archiveEntries, checkDownloadSize, checkFileCount, discoverSkills, MAX_DOWNLOAD, MAX_UNPACKED, normalizeName, parseSource, textOf, usableEntries } from './skill-source'

const bytes = (text: string) => new TextEncoder().encode(text)
const skill = (name: string) => bytes(`---\nname: ${name}\ndescription: A method.\n---\nDo the work.\n`)

const file = (path: string, data = skill('method')) => ({ path, data, type: 'file' as const })

describe('skill sources', () => {
  test('reads the three GitHub address forms and encoded refs', () => {
    expect(parseSource('https://github.com/o/r')).toEqual({ kind: 'github', owner: 'o', repo: 'r' })
    expect(parseSource('https://github.com/o/r/tree/main/methods/one')).toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'main', path: 'methods/one' })
    expect(parseSource('https://github.com/o/r/blob/v1/methods/one/SKILL.md')).toEqual({ kind: 'github', owner: 'o', repo: 'r', ref: 'v1', path: 'methods/one' })
    expect(parseSource('https://github.com/o/r/tree/feature%2Fone/skill').ref).toBe('feature/one')
    expect(parseSource('https://github.com/o/r/blob/main/SKILL.md').path).toBe('')
    expect(parseSource('https://github.com/o/r/archive/refs/heads/main.zip').kind).toBe('archive')
    expect(parseSource('https://github.com/o/r/releases/download/v1/method.skill').kind).toBe('archive')
    expect(parseSource('https://github.com/o/repo.zip').kind).toBe('github')
    for (const ext of ['zip', 'skill', 'tar.gz', 'tgz']) expect(parseSource(`http://localhost/archive.${ext}?download=1`).kind).toBe('archive')
  })

  test('rejects other addresses with a reason', () => {
    for (const url of ['https://github.com/o', 'https://github.com/o/r/issues', 'https://github.com/o/r/blob/main/README.md']) {
      expect(() => parseSource(url)).toThrow('GitHub')
    }
    expect(() => parseSource('not an address')).toThrow('URL')
    expect(() => parseSource('file:///tmp/a.zip')).toThrow('HTTP')
    expect(() => parseSource('https://example.com/hello')).toThrow('archive')
  })

  test('finds skills anywhere, with their own files, skipping hidden and dependency directories', () => {
    const entries = usableEntries([
      file('SKILL.md', skill('root')), file('nested/one/SKILL.md', skill('one')), file('nested/one/scripts/run.sh', bytes('echo hi')),
      file('.private/SKILL.md'), file('node_modules/pkg/SKILL.md'), file('.git/SKILL.md'), file('nested/one/.cache/no.txt'),
    ]).entries
    const found = discoverSkills(entries)
    expect(found.map((s) => s.path)).toEqual(['', 'nested/one'])
    expect(found[1].files.map((f) => f.path)).toEqual(['SKILL.md', 'scripts/run.sh'])
    expect(found[1].programs).toBe(true)
    expect(() => discoverSkills([file('bad/SKILL.md', bytes('---\nname: bad\n---\n'))])).toThrow('description')
    expect(() => discoverSkills([file('bad/SKILL.md', bytes('---\nname: [\n---\n'))])).toThrow('bad/SKILL.md')
    expect(discoverSkills([file('README.md')])).toEqual([])
  })

  test('normalizes names and refuses unusable names', () => {
    expect(normalizeName(' My__Method -- 2! ')).toBe('my-method-2')
    expect(normalizeName('already-valid-2')).toBe('already-valid-2')
    expect(normalizeName('x'.repeat(70))).toBe('x'.repeat(64))
    expect(normalizeName('x'.repeat(63) + '-more')).toBe('x'.repeat(63))
    expect(() => normalizeName('方法 !!')).toThrow('name')
  })

  test('skips traversal, absolute paths and links, with counts and reasons', () => {
    const result = usableEntries([
      file('one/SKILL.md'), file('../escape.txt'), file('/absolute.txt'), file('C:\\escape.txt'),
      file('one/../../escape.txt'), { ...file('one/link'), type: 'symlink' }, { ...file('one/hard'), type: 'link' },
    ])
    expect(result.entries.map((f) => f.path)).toEqual(['one/SKILL.md'])
    expect(result.skipped.reduce((sum, s) => sum + s.count, 0)).toBe(6)
    expect(result.skipped.map((s) => s.reason)).toContain('path leaves the skill directory')
    expect(result.skipped.map((s) => s.reason)).toContain('links are not copied')
  })

  test('checks raw tar names before nanotar normalizes them, and strips the GitHub root', () => {
    const tar = createTar([
      { name: 'pax_global_header', data: '' }, { name: 'r-main/one/SKILL.md', data: skill('one') },
      { name: '../escape.txt', data: 'escape' }, { name: '/absolute.txt', data: 'escape' },
      { name: 'r-main/one/../../escape.txt', data: 'escape' },
    ])
    const result = archiveEntries(gzipSync(tar), 'tar.gz', true)
    expect(result.entries.map((f) => f.path)).toEqual(['one/SKILL.md'])
    expect(result.skipped.reduce((sum, s) => sum + s.count, 0)).toBe(3)
    const zip = archiveEntries(zipSync({ 'one/SKILL.md': skill('one'), '../escape.txt': bytes('escape') }), 'zip')
    expect(zip.entries.map((f) => f.path)).toEqual(['one/SKILL.md'])
    expect(zip.skipped[0].count).toBe(1)
  })

  test('reads link types from real tar and ZIP headers', () => {
    const tar = createTar([{ name: 'one/link', data: 'target' }, { name: 'one/SKILL.md', data: skill('one') }])
    tar[156] = '2'.charCodeAt(0)
    const linkedTar = archiveEntries(gzipSync(tar), 'tgz')
    expect(linkedTar.entries.map((f) => f.path)).toEqual(['one/SKILL.md'])
    expect(linkedTar.skipped).toEqual([{ count: 1, reason: 'links are not copied' }])
    const zip = zipSync({ 'one/link': bytes('target'), 'one/SKILL.md': skill('one') })
    const view = new DataView(zip.buffer)
    const central = Array.from({ length: zip.length - 4 }, (_, i) => i).find((i) => view.getUint32(i, true) === 0x02014b50)!
    view.setUint32(central + 38, 0xa1ff << 16, true)
    const linkedZip = archiveEntries(zip, 'skill')
    expect(linkedZip.entries.map((f) => f.path)).toEqual(['one/SKILL.md'])
    expect(linkedZip.skipped).toEqual([{ count: 1, reason: 'links are not copied' }])
  })

  test('keeps PAX paths with spaces and ustar prefixes before checking them', () => {
    const path = 'methods/a long directory/SKILL.md'
    const record = `path=${path}\n`
    let length = record.length + 2
    while (String(length).length + 1 + record.length !== length) length = String(length).length + 1 + record.length
    const tar = createTar([{ name: 'pax', data: `${length} ${record}` }, { name: 'placeholder', data: skill('one') }])
    tar[156] = 'x'.charCodeAt(0)
    expect(archiveEntries(gzipSync(tar), 'tgz').entries[0].path).toBe(path)
    const prefixed = createTar([{ name: 'SKILL.md', data: skill('one') }])
    prefixed.set(bytes('methods/one'), 345)
    expect(archiveEntries(gzipSync(prefixed), 'tgz').entries[0].path).toBe('methods/one/SKILL.md')
  })

  test('accepts the caps themselves and refuses above them with the numbers', () => {
    expect(() => checkDownloadSize(50 * 1024 * 1024)).not.toThrow()
    expect(() => checkDownloadSize(50 * 1024 * 1024 + 1)).toThrow('52428801')
    expect(() => checkFileCount(2000, 'one')).not.toThrow()
    expect(() => checkFileCount(2001, 'one')).toThrow('2001')
    expect(() => discoverSkills([file('one/SKILL.md'), ...Array.from({ length: 2000 }, (_, i) => file(`one/${i}.txt`))])).toThrow('2001')
  })

  test('refuses an archive that unpacks past the limit, though its download is small', () => {
    const huge = new Uint8Array(MAX_UNPACKED + 1)
    const tgz = gzipSync(createTar([{ name: 'one/SKILL.md', data: skill('one') }, { name: 'one/zeros.bin', data: huge }]))
    expect(tgz.length).toBeLessThan(MAX_DOWNLOAD)
    expect(() => archiveEntries(tgz, 'tar.gz')).toThrow('unpacks to more than')
    const zip = zipSync({ 'one/SKILL.md': skill('one'), 'one/zeros.bin': huge })
    expect(() => archiveEntries(zip, 'zip')).toThrow('unpacks to more than')
  })

  test('distinguishes text from binary without changing valid bytes', () => {
    expect(textOf(bytes('繁體中文\n'))).toBe('繁體中文\n')
    expect(textOf(bytes('\uFEFFhello'))).toBe('\uFEFFhello')
    expect(textOf(new Uint8Array())).toBe('')
    expect(textOf(new Uint8Array([0xff, 0xfe]))).toBeNull()
    expect(textOf(new Uint8Array([0xc3, 0x28]))).toBeNull()
    expect(textOf(bytes('hello\0there'))).toBeNull()
  })
})
