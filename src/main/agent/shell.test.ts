// Written before shell.ts's sandbox settings, from the ways the agent's shell
// can go wrong. These run real commands in the real macOS sandbox against real
// folders; nothing is mocked.
//
// 1. A command deletes or overwrites the user's files outside the workspace (a wrong `rm`).
// 2. A folder the user named by path, or granted by picking a choice holding its path, can't be written.
// 3. A command reads SSH keys, cloud keys or pi's keys.
// 4. A command reads a conversation the agent was closed off from after the user deleted a memory.
// 5. The workspace, temporary folders or tool caches can't be written, so ordinary CLIs break.
// 6. The network is cut, so skills that fetch things break.
// 7. A command's change in the workspace isn't recorded, so undo can't take it back; or a
//    file it deletes or creates isn't.
// 8. A refused write gives the agent nothing to act on.
// 9. A file the user saves in the GUI while a command runs is taken for the command's, so
//    undoing the agent's run would undo the user.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Write } from '../workspace/workspace'
import { Workspace } from '../workspace/workspace'
import { namedFolders, shellOperations } from './shell'

const outside = mkdtempSync(join(homedir(), '.jezo-shell-test-'))
const named = mkdtempSync(join(homedir(), '.jezo-shell-named-'))
const root = join(mkdtempSync(join(homedir(), '.jezo-shell-ws-')), 'workspace')
let workspace: Workspace
const writes: Write[] = []
let heard: string[] = []
let closed: string[] = []

beforeAll(async () => {
  execFileSync('bun', ['scripts/fixture.ts', root], { cwd: join(import.meta.dirname, '../../..') })
  workspace = new Workspace(root)
  await workspace.open()
  workspace.onWrite((w) => writes.push(w))
  writeFileSync(join(outside, 'keep.txt'), 'the user’s file\n')
})
afterAll(() => {
  for (const dir of [outside, named, join(root, '..')]) rmSync(dir, { recursive: true, force: true })
})

async function run(command: string) {
  const ops = shellOperations(workspace, () => ({ actor: { by: 'agent', run: 'r-test' }, heard, closed }))
  let output = ''
  const { exitCode } = await ops.exec(command, root, { onData: (d) => (output += d.toString()) })
  return { exitCode, output }
}

describe('what a command can change', () => {
  test('1. files outside the workspace survive rm and overwrite', async () => {
    const r = await run(`rm -f ${outside}/keep.txt; echo gone > ${outside}/new.txt`)
    expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('the user’s file\n')
    expect(existsSync(join(outside, 'new.txt'))).toBe(false)
    // 8. The agent is told why, and what to do instead.
    expect(r.output).toContain('full path in an option')
  })

  test('2. a folder the user named can be written', async () => {
    heard = [`幫我把報告存到 ${named.replace(homedir(), '~')}`]
    await run(`echo done > ${named}/report.txt`)
    expect(readFileSync(join(named, 'report.txt'), 'utf8')).toBe('done\n')
    heard = []
  })

  test('5. the workspace and temporary folders can be written', async () => {
    const r = await run('echo hi > $TMPDIR/jezo-shell-tmp.txt && cat $TMPDIR/jezo-shell-tmp.txt && echo ok > notes/items/shell.md')
    expect(r.output).toContain('hi')
    expect(existsSync(join(root, 'notes/items/shell.md'))).toBe(true)
  })
})

describe('what a command can read', () => {
  test('3. credentials are closed', async () => {
    mkdirSync(join(homedir(), '.ssh'), { recursive: true })
    const r = await run('ls ~/.ssh >/dev/null 2>&1 && echo READ || echo denied')
    expect(r.output).toContain('denied')
  })

  test('4. a closed conversation is closed to the shell too', async () => {
    mkdirSync(join(root, 'sessions'), { recursive: true })
    writeFileSync(join(root, 'sessions/old.jsonl'), '{"said":"吉他課"}\n')
    closed = ['sessions/old.jsonl']
    const r = await run('cat sessions/old.jsonl || echo denied')
    expect(r.output).not.toContain('吉他課')
    closed = []
  })

  test('6. the network is open', async () => {
    const r = await run('curl -s -o /dev/null -w "%{http_code}" https://example.com')
    expect(r.output).toContain('200')
  })
})

describe('undo', () => {
  test('7. changes, creations and deletions in the workspace are recorded as the agent’s', async () => {
    writes.length = 0
    const item = workspace.list().find((i) => i.kind === 'todo')!
    const before = readFileSync(join(root, item.path), 'utf8')
    writeFileSync(join(root, 'notes/items/shell.md'), 'to remove\n')
    await run(`printf 'x\\n' >> ${item.path} && echo new > notes/made-by-shell.md && rm notes/items/shell.md`)
    const byPath = new Map(writes.map((w) => [w.path, w]))
    expect(byPath.get(item.path)).toMatchObject({ before, after: `${before}x\n`, actor: { by: 'agent', run: 'r-test' } })
    expect(byPath.get('notes/made-by-shell.md')).toMatchObject({ before: null, after: 'new\n' })
    expect(byPath.get('notes/items/shell.md')).toMatchObject({ after: null })
  })
})

test('9. a file the user saves while a command runs stays the user’s', async () => {
  writes.length = 0
  const command = run('sleep 0.5; echo agent > notes/by-agent.md')
  await new Promise((r) => setTimeout(r, 150))
  await workspace.writeFile('notes/by-user.md', 'mine\n', { by: 'user' })
  await command
  const byUser = writes.filter((w) => w.path === 'notes/by-user.md')
  expect(byUser.map((w) => w.actor.by)).toEqual(['user'])
  expect(writes.find((w) => w.path === 'notes/by-agent.md')?.actor).toEqual({ by: 'agent', run: 'r-test' })
})

test('named folders come from paths and from folders named by what they are', () => {
  const home = homedir()
  expect(namedFolders(['Yes, write in ~/Downloads'])).toEqual([join(home, 'Downloads')])
  expect(namedFolders(['放到 ~/Projects/jezo/out.md 就好'])).toEqual([join(home, 'Projects/jezo')])
  expect(namedFolders(['今天好累'])).toEqual([])
})
