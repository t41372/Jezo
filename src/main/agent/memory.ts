// Jezo's long-term memory: @jezo/pi-memory, with its files in the workspace's
// memory/ and every write going through the workspace, so it's checked,
// indexed and undoable like anything else (docs/design/memory.md).

import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { ipcMain } from 'electron'
import { Memory, type MemoryRecord, type MemoryStore, type RememberInput } from '../../../packages/pi-memory/src/index.ts'
import { readIfExists } from '../workspace/files'
import { insideWorkspace, type Workspace } from '../workspace/workspace'
import { acting, currentActing } from './acting'

const DIR = 'memory'

function workspaceStore(workspace: Workspace): MemoryStore {
  return {
    read: (path) => readIfExists(workspace.abs(`${DIR}/${path}`)),
    write: (path, text) => workspace.writeFile(`${DIR}/${path}`, text, currentActing().actor),
    remove: (path) => workspace.removeFile(`${DIR}/${path}`, currentActing().actor),
    list: (dir) => readdir(workspace.abs(`${DIR}/${dir}`)).catch(() => []),
  }
}

export function createMemory(workspace: Workspace) {
  const memory = new Memory({
    store: workspaceStore(workspace),
    source: () => currentActing().source,
    // Every memory rests on the conversation it was saved in, so forgetting it can shut that conversation off.
    provenance: () => {
      const session = currentActing().session
      return session ? [session] : []
    },
    // Evidence is a path in the workspace, maybe with an anchor, like sessions/….jsonl#L42.
    evidenceExists: (ref) => {
      const path = ref.split('#')[0]
      return insideWorkspace(workspace.root, workspace.abs(path)) !== null && existsSync(workspace.abs(path))
    },
  })
  // The files are the truth: an undo, or an edit elsewhere, changes what memory knows.
  let reload: NodeJS.Timeout | null = null
  workspace.onChange(({ changed, removed }) => {
    if (!changed.some((i) => i.kind === 'memory') && !removed.some((id) => id.startsWith('m-'))) return
    if (reload) clearTimeout(reload)
    reload = setTimeout(() => void memory.load(), 100)
  })
  return memory
}

/** What the windows can do with memory: forget, and put back what they just forgot or created. */
export function serveMemory(memory: Memory) {
  const asUser = <T>(work: () => Promise<T>) => acting.run({ actor: { by: 'user' }, source: 'user' }, work)
  ipcMain.handle('memory:remember', (_, input: RememberInput) => asUser(() => memory.remember(input)))
  ipcMain.handle('memory:forget', (_, id: string) => asUser(() => memory.forget(id)))
  // Undoing a deletion the user just made: the memory comes back as it was, and so may its words.
  ipcMain.handle('memory:restore', (_, record: MemoryRecord) => asUser(() => memory.restore(record)))
  // Taking back a memory the user just created (like a note sorted into memory): gone, without blocking it.
  ipcMain.handle('memory:discard', (_, id: string) => asUser(() => memory.discard(id)))
}
