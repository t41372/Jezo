// Prints a conversation of Jezo's agent as a timeline, for debugging: what the
// model was given (the prompt sections as they changed, like memory and the
// calendar), what the user said, each tool call with its result, the hidden
// checks that sent a run back, and what the model answered. It reads pi's
// session file, which already keeps all of this (docs/design/backend.md).
//
//   bun scripts/trace.ts <session.jsonl | workspace dir> [--full] [--sections memory,calendar]
//
// Given a workspace, it traces the most recently changed session. Long text is
// cut to a few lines unless --full.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const full = args.includes('--full')
const sectionsArg = args.includes('--sections') ? args[args.indexOf('--sections') + 1] : undefined
const wanted = sectionsArg ? new Set(sectionsArg.split(',')) : null
let file = args.find((a) => !a.startsWith('--') && a !== sectionsArg)
if (!file) {
  console.error('Usage: bun scripts/trace.ts <session.jsonl | workspace> [--full] [--sections memory,calendar]')
  process.exit(1)
}
if (statSync(file).isDirectory()) {
  const dir = join(file, 'sessions')
  const newest = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, at: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.at - a.at)[0]
  file = join(dir, newest.f)
}

const cut = (text: string, lines = 6) => {
  if (full) return text
  const all = text.split('\n')
  const shown = all.slice(0, lines).map((l) => (l.length > 220 ? `${l.slice(0, 220)}…` : l))
  return all.length > lines ? [...shown, `… (${all.length - lines} more lines)`].join('\n') : shown.join('\n')
}
const indent = (text: string) => text.replace(/^/gm, '    ')
const time = (iso: string) => iso.slice(11, 19)

type Block = { type: string; text?: string; thinking?: string; name?: string; arguments?: unknown }
const sections = new Map<string, string>()

console.log(`# ${file}\n`)
for (const line of readFileSync(file, 'utf8').split('\n')) {
  if (!line.trim()) continue
  const entry = JSON.parse(line)
  const at = entry.timestamp ? time(entry.timestamp) : '        '
  if (entry.type === 'model_change') console.log(`${at} model: ${entry.provider}/${entry.modelId}`)
  if (entry.type === 'thinking_level_change') console.log(`${at} thinking: ${entry.thinkingLevel}`)
  if (entry.type === 'custom_message') console.log(`${at} ⚑ ${entry.customType}${entry.display ? '' : ' (hidden)'}:\n${indent(cut(String(entry.content), 12))}`)
  if (entry.type === 'compaction') console.log(`${at} ⧉ compacted: ${cut(entry.summary, 3)}`)
  if (entry.type !== 'message') continue
  const m = entry.message
  if (m.role === 'system') {
    for (const [name, value] of Object.entries((m.sections ?? {}) as Record<string, string | null>)) {
      if (sections.get(name) === value) continue
      sections.set(name, value ?? '')
      if (wanted && !wanted.has(name)) continue
      console.log(`${at} § ${name}${value === null ? ' removed' : ''}:\n${indent(cut(value ?? '', name === 'memory' || name === 'calendar' ? 20 : 4))}`)
    }
    continue
  }
  const blocks: Block[] = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : (m.content ?? [])
  if (m.role === 'user') console.log(`\n${at} ▶ user: ${blocks.map((b) => b.text ?? '').join('')}`)
  if (m.role === 'assistant') {
    for (const b of blocks) {
      if (b.type === 'thinking' && b.thinking?.trim()) console.log(`${at}   thinks: ${cut(b.thinking.trim(), 3)}`)
      if (b.type === 'text' && b.text?.trim()) console.log(`${at} ◀ agent: ${cut(b.text.trim(), 8)}`)
      if (b.type === 'toolCall') console.log(`${at}   → ${b.name} ${JSON.stringify(b.arguments)}`)
    }
    if (m.stopReason && m.stopReason !== 'stop' && m.stopReason !== 'toolUse') console.log(`${at}   (stopped: ${m.stopReason}${m.errorMessage ? `, ${m.errorMessage}` : ''})`)
  }
  if (m.role === 'toolResult') {
    const text = blocks.map((b) => b.text ?? '').join('')
    console.log(`${at}   ${m.isError ? '✗' : '←'} ${m.toolName}: ${cut(text, 5).replace(/\n/g, '\n      ')}`)
  }
}
