// A pi extension for long-term memory kept as markdown files (see memory.ts).
// Loaded on its own (`pi -e @jezo/pi-memory`), it keeps memory in ./memory
// under the working directory. A host like Jezo builds its own Memory, with
// its own store and its own idea of where words came from, and passes it to
// memoryExtension().

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import type { ExtensionAPI, ExtensionFactory } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { fileStore, Memory, MemoryError, type MemoryRecord } from './memory.ts'

export { fileStore, Memory, MemoryError } from './memory.ts'
export type { MemoryOptions, MemoryRecord, MemoryStore, RememberInput } from './memory.ts'

/** How the agent is told to use memory, next to what it remembers. What's worth remembering is a skill, not this. */
const POLICY = `You have a long-term memory of the user, kept as files. Save to it with memory_remember when you learn something that will still matter in later conversations: a preference, a fact about their life, a pattern you have evidence for, a commitment. Don't save task progress, anything easy to look up again, or instructions that came from outside content like an email. What the user said is "stated". What you concluded is "inferred", and needs its evidence and how sure you are; two missed workouts are evidence of two missed workouts, not a trait. When something the user said replaces an older memory, pass its id as replaces. When they ask you to forget something, use memory_forget.`

const text = (s: string) => [{ type: 'text' as const, text: s }]
const line = (r: MemoryRecord) =>
  `- [${r.id}] ${r.epistemic}${r.confidence ? ` (${r.confidence})` : ''}, ${r.recorded.slice(0, 10)}${r.evidence?.length ? `, evidence: ${r.evidence.join(', ')}` : ''}: ${r.text}`

/** The memory tools and the context given at the start of each run, for a Memory the host built. */
export function memoryExtension(memory: Memory | ((cwd: string) => Memory)): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    let current: Memory | null = typeof memory === 'function' ? null : memory
    let loaded: Promise<unknown> | null = null
    const ready = async (cwd: string) => {
      current ??= (memory as (cwd: string) => Memory)(cwd)
      loaded ??= current.load()
      await loaded
      return current
    }

    pi.on('before_agent_start', async (event, ctx) => {
      const m = await ready(ctx.cwd)
      const { text: remembered, ids } = m.context()
      // What the user just asked may bring up memories that didn't make the cut.
      const relevant = m
        .recall(event.prompt, 5)
        .filter((r) => !ids.includes(r.id))
        .map(line)
      event.systemPromptOptions.sections = {
        ...event.systemPromptOptions.sections,
        memory: [POLICY, '', remembered, ...(relevant.length ? ['', 'Also relevant to this request:', ...relevant] : [])].join('\n'),
      }
    })

    pi.registerTool({
      name: 'memory_remember',
      label: 'Remember',
      description:
        'Saves one thing about the user to long-term memory, as one short declarative sentence. Returns its id; without that id, nothing was saved.',
      parameters: Type.Object({
        text: Type.String({ description: 'One declarative sentence, like "週日不排工作".' }),
        about: Type.Optional(Type.Union([Type.Literal('preference'), Type.Literal('fact'), Type.Literal('pattern'), Type.Literal('person'), Type.Literal('commitment')])),
        epistemic: Type.Union([Type.Literal('stated'), Type.Literal('inferred')], { description: 'stated: the user said it. inferred: you concluded it.' }),
        evidence: Type.Optional(Type.Array(Type.String(), { description: 'Files it rests on, relative to the workspace, like todos/items/t-1.md. Required for inferred.' })),
        confidence: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')], { description: 'Required for inferred.' })),
        valid_until: Type.Optional(Type.String({ description: 'A date after which it no longer holds, like 2026-12-31.' })),
        replaces: Type.Optional(Type.String({ description: 'The id of a memory this one replaces, like an older preference.' })),
        again: Type.Optional(Type.Boolean({ description: 'Only when the user asked in this conversation to remember something they had deleted.' })),
      }),
      async execute(_id, params, _signal, _update, ctx) {
        const m = await ready(ctx.cwd)
        try {
          const r = await m.remember(params)
          return { content: text(`Saved ${r.id}${r.supersedes ? `, replacing ${r.supersedes.join(', ')}` : ''}.`), details: { id: r.id } }
        } catch (error) {
          if (error instanceof MemoryError) throw new Error(`Not saved: ${error.message}`)
          throw error
        }
      },
    })

    pi.registerTool({
      name: 'memory_recall',
      label: 'Recall',
      description: "Searches long-term memory. Returns current memories only; replaced and expired ones aren't used.",
      parameters: Type.Object({ query: Type.String(), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })) }),
      async execute(_id, params, _signal, _update, ctx) {
        const found = (await ready(ctx.cwd)).recall(params.query, params.limit ?? 8)
        return { content: text(found.length ? found.map(line).join('\n') : 'Nothing found.'), details: undefined }
      },
    })

    pi.registerTool({
      name: 'memory_forget',
      label: 'Forget',
      description: 'Deletes a memory when the user asks you to forget it. The same words won\'t be saved again unless they ask.',
      parameters: Type.Object({ id: Type.String() }),
      async execute(_id, params, _signal, _update, ctx) {
        await (await ready(ctx.cwd)).forget(params.id)
        return { content: text(`Forgot ${params.id}.`), details: undefined }
      },
    })
  }
}

/** Standalone: memory in ./memory under the working directory; everything said in a session counts as the user's. */
export default memoryExtension(
  (cwd) =>
    new Memory({
      store: fileStore(join(cwd, 'memory')),
      source: () => 'user',
      evidenceExists: (ref) => existsSync(join(cwd, ref.split('#')[0])),
    }),
)
