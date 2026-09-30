// Writes a conversation the way pi saves one, for tests that start from a
// decision the agent already proposed.

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { patch } from '../src/main/workspace/frontmatter'

type Proposal = { note: string; as: 'todo' | 'goal' | 'memory' | 'keep' | 'ask'; title: string }

/** A 隨手記 sorting session whose proposal waits on the notes, as if the agent had just called notes_propose. */
export function writeSortSession(root: string, items: Proposal[]) {
  const id = '01a0f000-0000-7000-8000-000000000001'
  const at = new Date().toISOString()
  const call = 'call_sort_0'
  const lines = [
    { type: 'session', version: 3, id, timestamp: at, cwd: root },
    { type: 'custom', customType: 'jezo.session', data: { trigger: 'notes' }, id: 'e0000001', parentId: null, timestamp: at },
    {
      type: 'message',
      id: 'e0000002',
      parentId: 'e0000001',
      timestamp: at,
      message: { role: 'assistant', content: [{ type: 'toolCall', id: call, name: 'notes_propose', arguments: { items } }], stopReason: 'toolUse', timestamp: Date.now() },
    },
    {
      type: 'message',
      id: 'e0000003',
      parentId: 'e0000002',
      timestamp: at,
      message: {
        role: 'toolResult',
        toolCallId: call,
        toolName: 'notes_propose',
        content: [{ type: 'text', text: `Proposed how to sort ${items.length} notes.` }],
        details: { card: { kind: 'plugin', plugin: 'notes', type: 'sort', data: { items: items.map((i) => ({ noteId: i.note, as: i.as, title: i.title })) } } },
        isError: false,
        timestamp: Date.now(),
      },
    },
    {
      type: 'message',
      id: 'e0000004',
      parentId: 'e0000003',
      timestamp: at,
      message: { role: 'assistant', content: [{ type: 'text', text: '看完了，你看一下卡片。' }], stopReason: 'stop', timestamp: Date.now() },
    },
  ]
  writeFileSync(join(root, 'sessions', `${at.replace(/[:.]/g, '-')}_${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
  for (const item of items) {
    const path = join(root, 'notes/items', `${item.note}.md`)
    writeFileSync(path, patch(readFileSync(path, 'utf8'), { state: 'sorting', proposal: { as: item.as, title: item.title, session: id } }))
  }
}
