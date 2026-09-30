// The agent's tools. File writes go through the workspace, so they're checked,
// indexed and recorded for undo like any other write. The typed tools make
// common changes easy for any model and name what the chat should draw as a
// card (docs/design/backend.md, "Tools").

import { access, readFile } from 'node:fs/promises'
import {
  createEditToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  defineTool,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { generateKeyBetween } from 'fractional-indexing'
import { Type } from 'typebox'
import type { SessionMessage } from '../../shared/session'
import type { Fields } from '../../shared/workspace'
import { FrontmatterError, parse } from '../workspace/frontmatter'
import { insideWorkspace, type Workspace } from '../workspace/workspace'

/** The run the tools are working for. The session updates it before each prompt. */
export interface RunContext {
  run: string
  session: string
  /** A check refused a write; the history counts these. */
  refused(): void
}

/** What a tool result asks the chat to draw, kept in the result's details. */
export interface CardDetails {
  card: Extract<SessionMessage, { kind: 'plan' | 'choices' | 'plugin' }>
}

// Tool schemas stay plain: no patterns, no nullable unions. Local model servers
// turn schemas into grammars for tool calls, and a pattern inside a union left
// LM Studio able to send only null (seen on 2026-09-29). Formats are checked
// when the tool runs instead, with a message the model can act on.
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
const text = (s: string) => [{ type: 'text' as const, text: s }]

function checkTime(value: string | undefined) {
  if (value && !LOCAL_TIME.test(value)) throw new Error(`"${value}" isn't a local time. Write it like 2026-09-29T09:30.`)
}

/** A todo as a tool result reports it, so the model sees what its call actually did. */
function describe(data: Record<string, unknown>) {
  const when = typeof data.scheduled === 'string' ? `scheduled ${data.scheduled}${data.proposed ? ' (proposed)' : ''}` : 'in the backlog'
  return `${data.id} "${data.title}": ${data.state}, ${when}, ${data.estimate ?? '?'} min`
}

export function createTools(workspace: Workspace, context: () => RunContext): ToolDefinition[] {
  const root = workspace.root
  const actor = () => ({ by: 'agent' as const, run: context().run })

  /** Where the agent may write, relative to the workspace. Throws with a message the agent can act on. */
  const writable = (absolute: string) => {
    const path = insideWorkspace(root, absolute)
    if (path === null) throw new Error("Jezo's agent writes only inside the workspace.")
    if (path.startsWith('sessions/')) throw new Error('Conversations are written by the app. Leave sessions/ alone.')
    return path
  }

  /** An item file must still match its manifest after the write. */
  const check = (path: string, content: string) => {
    const manifest = workspace.kindAt(path)
    if (!manifest) return
    let problems: string[]
    try {
      problems = manifest.check(parse(content).data)
    } catch (error) {
      problems = [error instanceof FrontmatterError ? `The frontmatter doesn't parse: ${error.message}` : String(error)]
    }
    if (problems.length) {
      context().refused()
      throw new Error(`Not written, because ${path} would not match ${manifest.dir}/manifest.yaml:\n- ${problems.join('\n- ')}\nFix it and write again.`)
    }
  }

  const writeOps = {
    writeFile: async (absolute: string, content: string) => {
      const path = writable(absolute)
      check(path, content)
      await workspace.writeFile(path, content, actor())
    },
    mkdir: async () => {
      // The workspace creates directories as it writes.
    },
  }
  const editOps = {
    ...writeOps,
    readFile: (absolute: string) => readFile(absolute),
    access: (absolute: string) => access(absolute),
  }

  const todoInput = Type.Object({
    title: Type.String({ description: 'What to do, starting with a verb.' }),
    estimate: Type.Integer({ minimum: 1, description: 'Minutes, based on how long similar todos actually took.' }),
    scheduled: Type.Optional(Type.String({ description: 'Local time, like 2026-09-29T09:30. Leave out to put it in the backlog.' })),
    goal: Type.Optional(Type.String({ description: 'The id of the goal it serves.' })),
    cue: Type.Optional(Type.String({ description: 'The situation it gets done in.' })),
    why: Type.Optional(Type.String({ description: 'Your reasoning for when and how long, in one sentence to the user.' })),
  })

  const todosPropose = defineTool({
    name: 'todos_propose',
    label: 'Propose todos',
    description:
      'Proposes new todos as drafts, shown to the user as one plan they can accept, tweak, or turn down. Nothing counts until they accept. Returns the new ids.',
    parameters: Type.Object({
      title: Type.String({ description: "The plan's name as the user would say it, like 今天的安排." }),
      todos: Type.Array(todoInput, { minItems: 1 }),
    }),
    async execute(_id, params) {
      const lastRank = workspace
        .list()
        .filter((i) => i.kind === 'todo')
        .reduce<string | null>((max, i) => (typeof i.data.rank === 'string' && (!max || i.data.rank > max) ? i.data.rank : max), null)
      for (const todo of params.todos) checkTime(todo.scheduled)
      let rank = lastRank
      const ids: string[] = []
      const lines: string[] = []
      for (const todo of params.todos) {
        rank = generateKeyBetween(rank, null)
        const fields: Fields = { title: todo.title, state: 'draft', estimate: todo.estimate, rank, created: nowLocal() }
        if (todo.scheduled) Object.assign(fields, { scheduled: todo.scheduled, proposed: true })
        for (const key of ['goal', 'cue', 'why'] as const) if (todo[key]) fields[key] = todo[key]
        const item = await workspace.create('todo', fields, '', actor())
        ids.push(item.id)
        lines.push(`- ${describe(item.data)}`)
      }
      const details: CardDetails = { card: { kind: 'plan', title: params.title, todoIds: ids } }
      return { content: text(`Proposed ${ids.length} drafts. The user sees them as one plan and decides:\n${lines.join('\n')}`), details }
    },
  })

  const todosUpdate = defineTool({
    name: 'todos_update',
    label: 'Update a todo',
    description:
      "Changes an existing todo. Give only the fields to change. Scheduling or moving it marks the time as your proposal until the user confirms it, unless they asked for that exact time. Set scheduled to an empty string to put it back in the backlog. You can't accept a draft for the user or mark something done that they didn't do.",
    parameters: Type.Object({
      id: Type.String(),
      title: Type.Optional(Type.String()),
      estimate: Type.Optional(Type.Integer({ minimum: 1 })),
      scheduled: Type.Optional(Type.String({ description: 'Local time, like 2026-09-29T09:30, or "" for the backlog.' })),
      userAskedForThisTime: Type.Optional(Type.Boolean({ description: 'True when the user named this time themselves; then it is theirs, not a proposal.' })),
      goal: Type.Optional(Type.String({ description: 'A goal id, or "" for none.' })),
      cue: Type.Optional(Type.String({ description: 'The situation it gets done in, or "" for none.' })),
      why: Type.Optional(Type.String()),
    }),
    async execute(_id, params) {
      const { id, userAskedForThisTime, ...change } = params
      const item = workspace.get(id)
      if (item?.kind !== 'todo') throw new Error(`There is no todo ${id}.`)
      checkTime(change.scheduled)
      // An empty string clears the field.
      const fields: Fields = Object.fromEntries(Object.entries(change).map(([k, v]) => [k, v === '' ? null : v]))
      if (change.scheduled !== undefined) fields.proposed = change.scheduled && !userAskedForThisTime ? true : null
      const updated = await workspace.update(id, fields, actor())
      return { content: text(`Now: ${describe(updated.data)}`), details: undefined }
    },
  })

  const notesPropose = defineTool({
    name: 'notes_propose',
    label: 'Propose how to sort notes',
    description:
      'Proposes what each unsorted note becomes. The user accepts, turns down, or answers each one on a card; nothing is created until they accept. Call it once with every note you sorted.',
    parameters: Type.Object({
      items: Type.Array(
        Type.Object({
          note: Type.String({ description: 'The note id.' }),
          as: Type.Union([Type.Literal('todo'), Type.Literal('goal'), Type.Literal('memory'), Type.Literal('keep'), Type.Literal('ask')]),
          title: Type.String({ description: 'The todo, goal idea or memory as you would write it; for ask, your question.' }),
        }),
        { minItems: 1 },
      ),
    }),
    async execute(_id, params) {
      const { session } = context()
      for (const item of params.items) {
        if (workspace.get(item.note)?.kind !== 'note') throw new Error(`There is no note ${item.note}.`)
      }
      for (const item of params.items) {
        await workspace.update(item.note, { state: 'sorting', proposal: { as: item.as, title: item.title, session }, became: null }, actor())
      }
      const details: CardDetails = {
        card: { kind: 'plugin', plugin: 'notes', type: 'sort', data: { items: params.items.map((i) => ({ noteId: i.note, as: i.as, title: i.title })) } },
      }
      return { content: text(`Proposed how to sort ${params.items.length} notes. The user decides on the card.`), details }
    },
  })

  const askUser = defineTool({
    name: 'ask_user',
    label: 'Ask the user',
    description:
      'Asks the user to pick one of a few short answers, shown as buttons under your message. Say the question in your reply first. Your turn ends here; their pick comes back as their next message.',
    parameters: Type.Object({ options: Type.Array(Type.String(), { minItems: 2, maxItems: 5 }) }),
    async execute(_id, params) {
      const details: CardDetails = { card: { kind: 'choices', options: params.options } }
      return { content: text('Asked. Wait for the answer.'), details, terminate: true }
    },
  })

  return [
    createReadToolDefinition(root),
    createLsToolDefinition(root),
    createWriteToolDefinition(root, { operations: writeOps }),
    createEditToolDefinition(root, { operations: editOps }),
    todosPropose,
    todosUpdate,
    notesPropose,
    askUser,
  ] as ToolDefinition[]
}

export const TOOL_NAMES = ['read', 'ls', 'write', 'edit', 'todos_propose', 'todos_update', 'notes_propose', 'ask_user']

function nowLocal(at = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}
