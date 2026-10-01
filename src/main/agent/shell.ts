// The agent's shell. Jezo's agent works like a coding agent (AGENTS.md,
// principle 2), and skills that wrap a CLI need one. What it guards against is
// damage that can't be undone (AGENTS.md, trust model), without taking away what
// a command can do (docs/design/backend.md, "The shell"):
//
// - Commands run in the OS sandbox from @anthropic-ai/sandbox-runtime. They can
//   write in the workspace, temporary folders, tool caches, and folders the user
//   named in the conversation. Anywhere else, like the rest of the home folder,
//   they can read but not write, so a wrong `rm` can't take the user's files.
// - Credentials (SSH and cloud keys, the keychain, pi's keys) can't be read, nor
//   the conversations closed to the agent after the user deleted a memory.
// - The network is open. Outside content is checked where it comes in instead.
// - What a command changes in the workspace goes into 修改紀錄 like the agent's
//   other writes, so it can be undone.
//
// If the sandbox can't be set up, the command fails: it never runs without it.

import { lstat, mkdir, readdir, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { SandboxManager } from '@anthropic-ai/sandbox-runtime'
import { type BashOperations, createLocalBashOperations } from '@earendil-works/pi-coding-agent'
import { textOf } from '../workspace/skill-source'
import type { Actor, Workspace } from '../workspace/workspace'

const home = homedir()

/** Where CLIs keep caches and installed tools. Losing or changing these loses nothing of the user's. */
const TOOL_PLACES = ['.cache', 'Library/Caches', '.npm', '.bun', '.local', '.cargo', '.rustup', '.gem', '.config'].map((p) => join(home, p))

/** Keys and passwords. A command has no use for them, and a steered one would send them out. */
const CREDENTIALS = ['.ssh', '.aws', '.gnupg', '.kube', '.docker', '.netrc', '.pi', 'Library/Keychains', '.config/gh', '.config/gcloud'].map((p) => join(home, p))

/**
 * Folders the user named by path in the conversation, which commands may also
 * write in, the way Claude Code lets a user name a directory. A path to a file
 * names its folder. Paths, not words, so it works in any language: to write
 * somewhere else the agent asks with a choice holding the path, and picking it
 * puts the path in the user's words.
 */
export function namedFolders(said: string[]): string[] {
  const folders = new Set<string>()
  for (const text of said) {
    for (const match of text.matchAll(/(?:~|\/Users\/[^/\s]+|\/Volumes)(?:\/[^\s，。、；：「」『』"'`)）]+)*/g)) {
      const path = resolve(match[0].replace(/^~/, home))
      folders.add(/\.[^/]+$/.test(path) ? dirname(path) : path)
    }
  }
  return [...folders]
}

/**
 * Text files in the workspace, to see what a command changed. Sessions, dot
 * folders and the automations' history aren't the user's items: the scheduler
 * writes the history while commands run, and it isn't undone.
 */
async function snapshot(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  const visit = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!['sessions', 'automations/history'].includes(relative(root, path))) await visit(path)
      } else if (entry.isFile() && (await lstat(path)).size <= 1024 * 1024) {
        const text = textOf(await readFile(path))
        if (text !== null) files.set(relative(root, path), text)
      }
    }
  }
  await visit(root)
  return files
}

const NOT_PERMITTED = 'Operation not permitted'

/**
 * The sandbox points TMPDIR at the folder this names, /tmp/claude unless set,
 * and doesn't create it. Jezo's own, created before each command.
 */
const TEMP = join(tmpdir(), 'jezo-shell')
process.env.CLAUDE_CODE_TMPDIR = TEMP

export function shellOperations(workspace: Workspace, context: () => { actor: Actor; heard: string[]; closed: string[] }): BashOperations {
  const local = createLocalBashOperations()
  return {
    async exec(command, cwd, options) {
      const { actor, heard, closed } = context()
      const named = namedFolders(heard)
      await mkdir(TEMP, { recursive: true })
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, {
        filesystem: { allowWrite: [workspace.root, TEMP, tmpdir(), ...TOOL_PLACES, ...named], denyRead: [...CREDENTIALS, ...closed.map((path) => join(workspace.root, path))], allowRead: [], denyWrite: [] },
      })
      const before = await snapshot(workspace.root)
      // Files written through the workspace meanwhile, by the user in the GUI, say, aren't the command's.
      const others = new Set<string>()
      const stop = workspace.onWrite((write) => others.add(write.path))
      let refused = false
      const result = await local.exec(wrapped, cwd, {
        ...options,
        onData: (data) => {
          if (data.includes(NOT_PERMITTED)) refused = true
          options.onData(data)
        },
      })
      stop()
      // What else changed in the workspace is the command's, recorded for undo as the agent's.
      const after = await snapshot(workspace.root)
      for (const path of new Set([...before.keys(), ...after.keys()])) {
        if (others.has(path)) continue
        const was = before.get(path) ?? null
        const now = after.get(path) ?? null
        if (was !== now) await workspace.changedOutside(path, was, now, actor)
      }
      if (refused && result.exitCode !== 0) {
        options.onData(
          Buffer.from(
            `\n[Jezo] Commands can write only in the workspace, temporary folders, tool caches and folders the user named in this conversation${named.length ? ` (${named.join(', ')})` : ''}. To write somewhere else, ask the user with ask_user and put the folder's full path in an option, like "Yes, write in ~/Downloads"; once they pick it, commands can write there.\n`,
          ),
        )
      }
      return result
    },
  }
}
