// The agent's tools. File writes go through the workspace, so they're checked,
// indexed and recorded for undo like any other write. The typed tools make
// common changes easy for any model and name what the chat should draw as a
// card (docs/design/backend.md, "Tools").

import { access, readFile } from 'node:fs/promises'
import {
  createBashToolDefinition,
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
import { currentActing } from './acting'
import { installer } from '../install/installer'
import { shellOperations } from './shell'
import type { CommandCheckpoints } from './undo'
import { listSkills } from '../workspace/skills'
import { insideWorkspace, type Workspace } from '../workspace/workspace'
import { dateOf, deadlineEnd, epochOf, formatTime, moveTo, place, readTime, stamp, todayIn, type Zone } from '../../shared/time'
import { deviceZone } from '../clock'
import { dueWords, whenText } from './prompt'
import { ruleProblem, upcoming } from '../workspace/rrule'

/** The run the tools are working for. The session updates it before each prompt. */
export interface RunContext {
  run: string
  session: string
  /** What the user said to start this run, or '' when Jezo started it. */
  said: string
  /** A tool completed an action outside workspace file history. */
  acted: boolean
  /** The zone the user is planning in, when it isn't the device's: times are read and shown there. */
  zone?: Zone
  /**
   * A tool that may change something started in this run. Set before the tool runs,
   * so a run that fails afterwards is never taken for one that did nothing.
   */
  effects: boolean
  /** The agent asked the user with ask_user, which ends the turn waiting for them. */
  asked: boolean
  /** Everything the user said in this conversation, for the folders they named (shell.ts). */
  heard: string[]
  /** Conversations closed to the agent because the user deleted a memory from them, as workspace paths. */
  closed: string[]
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
const text = (s: string) => [{ type: 'text' as const, text: s }]

const deadlineParam = Type.Optional(
  Type.String({
    description:
      'The deadline the user gave, when it has to be done by: a day like 2026-10-09 ("by Friday"), or a day and a clock like 2026-10-09 17:00, plus a zone only when they named a place. It is not when to do it; that is date and time, which go before it. Leave it out to keep the deadline; "" removes it.',
  }),
)

/**
 * A deadline as a tool call gives it, as written to the file: a day alone, or a
 * day and a clock fixed to the user's zone. Throws with real dates to copy.
 */
function dueText(input: string, here: Zone): string {
  const today = todayIn(here)
  const example = `deadline is a day like ${today.add({ days: 3 })}, or a day and a clock like ${today.add({ days: 3 })} 17:00, with a zone after it only when the user named a place.`
  const [date, clock, zone] = input.trim().split(/[ T]+/)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || (clock && !/^\d{1,2}:\d{2}$/.test(clock)) || (zone && !clock)) throw new Error(example)
  let placed
  try {
    Temporal.PlainDate.from(date)
    if (!clock) return date
    placed = place(date, clock.padStart(5, '0'), zone ?? here)
  } catch (error) {
    throw new Error(`${(error as Error).message} ${example}`)
  }
  if (placed.gap) throw new Error(`${date} ${clock} doesn't exist${zone ? ` in ${zone}` : ''}: the clocks skip it that day. ${formatTime(placed.value).slice(11, 16)} is the time after the gap.`)
  return formatTime(placed.value)
}

/** A series' `due_after`: how long after the planned time its deadline is, in whole days when the deadline is a day. */
function dueAfter(scheduled: string, due: string) {
  const plan = readTime(scheduled)
  const deadline = readTime(due, 'deadline')
  if (!plan || plan.kind !== 'zoned' || !deadline) return 'P0D'
  if (deadline.kind === 'day') return `P${Math.max(0, plan.wall.toPlainDate().until(deadline.date).days)}D`
  return plan.wall.toZonedDateTime(plan.zone).until(deadline.kind === 'zoned' ? deadline.wall.toZonedDateTime(deadline.zone) : deadline.kind === 'moment' ? deadline.at : plan.wall.toZonedDateTime(plan.zone)).toString()
}

/** Said when a todo's planned time ends after its deadline: a fact to act on, not a refusal (sometimes late is the plan). */
function pastDue(data: Record<string, unknown>, zone: Zone) {
  const scheduled = readTime(data.scheduled)
  const due = readTime(data.due, 'deadline')
  if (!scheduled || !due) return ''
  const end = (epochOf(scheduled, zone) ?? 0) + (Number(data.estimate) || 30) * 60_000
  return end > deadlineEnd(due, zone) ? `\n  It's planned to end after its deadline${dueWords(data.due, zone).replace(', deadline', '')}. Move it before then unless the user wants it late.` : ''
}

/** The time fields of the todo tools: a day and a clock, and a zone only when the user named a place. */
const timeParams = (backlog: string) => ({
  date: Type.Optional(Type.String({ description: `The day, like 2026-09-29. ${backlog}` })),
  time: Type.Optional(Type.String({ description: "The clock, like 09:30, in the user's zone (the time note names it), or in zone when you give one." })),
  zone: Type.Optional(
    Type.String({ description: 'Only when the user names a place for this time, like America/New_York for "9am New York time". Leave it out otherwise.' }),
  ),
})

/**
 * The time a tool call names, as written to the file. `date` and `time` are read
 * in `zone` when the user named a place, and otherwise in the device's zone, and
 * the time is fixed to that zone. A moved time keeps its zone, so a call fixed to
 * New York stays in New York. A `zone` alone keeps an existing time's clock in
 * that zone: 07:00 Phoenix becomes 07:00 Tokyo. Throws with a message the model
 * can act on, with real dates to copy: a small model wrote "Tomorrow 19:00", and
 * after a fixed example it gave up and asked the user.
 */
function scheduleText(input: { date?: string; time?: string; zone?: string }, here: Zone, previous?: unknown, moving = false): { text: string; note: string } {
  const today = todayIn(here)
  const example = `For example date ${today}, time 19:00 is today at 19:00, and date ${today.add({ days: 1 })}, time 09:30 tomorrow morning.`
  const before = readTime(previous)
  if (input.zone && !input.date && !input.time && (before?.kind === 'zoned' || before?.kind === 'moment')) {
    const [date, time] = (before.kind === 'zoned' ? before.wall : before.at.withTimeZone(here).toPlainDateTime()).toString({ smallestUnit: 'minute' }).split('T')
    input = { ...input, date, time }
  }
  if (!input.date || !input.time) {
    throw new Error(`${moving ? 'Give both date and time to move it, or only zone to keep its clock in another zone. Leave all three out to keep its time.' : 'Give both date and time, or neither to leave it in the backlog.'} ${example}`)
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{1,2}:\d{2}$/.test(input.time)) throw new Error(`date is like ${today} and time like 19:00. ${example}`)
  const clock = input.time.padStart(5, '0')
  let placed
  try {
    placed = input.zone ? place(input.date, clock, input.zone) : before ? moveTo(before, input.date, clock, here) : place(input.date, clock, here)
  } catch (error) {
    throw new Error(`${(error as Error).message} ${example}`)
  }
  if (placed.gap) throw new Error(`${input.date} ${clock} doesn't exist${input.zone ? ` in ${input.zone}` : ''}: the clocks skip it that day. ${formatTime(placed.value).slice(11, 16)} is the time after the gap.`)
  const note = placed.twice ? ` ${clock} happens twice that day; this is the first one.` : ''
  return { text: formatTime(placed.value), note }
}

/** A todo as a tool result reports it, so the model sees what its call actually did, in the device's zone. */
function describe(data: Record<string, unknown>, zone: Zone) {
  const value = readTime(data.scheduled)
  const when = value ? `scheduled ${value.kind === 'day' ? value.date : `${dateOf(value, zone)} ${whenText(data.scheduled, zone)}`}${data.proposed ? ' (proposed)' : ''}` : 'in the backlog'
  return `${data.id} "${data.title}": ${data.state}, ${when}, ${data.estimate ?? '?'} min${dueWords(data.due, zone)}`
}

/** Calendar events that overlap a todo's slot, described for the agent, and the calendars that couldn't be checked. */
export type Clashes = (scheduled: string, minutes: number) => Promise<{ found: string[]; unchecked: string[] }>

/** The todos of the latest plan card in this conversation that holds a todo, for revising it. */
export type Plans = (todoId: string) => string[] | undefined

export function createTools(
  workspace: Workspace,
  context: () => RunContext,
  blocked: (path: string) => boolean,
  clashes: Clashes = async () => ({ found: [], unchecked: [] }),
  plans: Plans = () => undefined,
  checkpoints?: CommandCheckpoints,
): ToolDefinition[] {
  const root = workspace.root
  const actor = () => ({ by: 'agent' as const, run: context().run })
  /** Where times are read: the device's zone, or the one the user is planning in. */
  const here = () => context().zone ?? deviceZone()

  /** Where the agent may write, relative to the workspace. Throws with a message the agent can act on. */
  const writable = (absolute: string) => {
    const path = insideWorkspace(root, absolute)
    if (path === null) throw new Error("Jezo's agent writes only inside the workspace.")
    if (path.startsWith('sessions/')) throw new Error('Conversations are written by the app. Leave sessions/ alone.')
    return path
  }

  /** An item file must still match its manifest after the write, and keep its id. */
  const check = (path: string, content: string) => {
    // A model wrote an automation as items/<id>.yaml, which the app never reads as an item.
    const dir = /^([^/]+)\/items\/[^/]+$/.exec(path)?.[1]
    if (dir && !path.endsWith('.md') && workspace.kindAt(`${dir}/items/x.md`)) {
      context().refused()
      throw new Error(`Not written: items are markdown files named after their id, like ${dir}/items/<id>.md.`)
    }
    const manifest = workspace.kindAt(path)
    if (!manifest) return
    let problems: string[]
    let data: Record<string, unknown> = {}
    try {
      data = parse(content).data
      problems = manifest.check(data)
    } catch (error) {
      problems = [error instanceof FrontmatterError ? `The frontmatter doesn't parse: ${error.message}` : String(error)]
    }
    if (problems.length) {
      context().refused()
      throw new Error(`Not written, because ${path} would not match ${manifest.dir}/manifest.yaml:\n- ${problems.join('\n- ')}\nFix it and write again.`)
    }
    const id = workspace.at(path)?.id
    if (id && !id.startsWith('?') && data.id !== id) {
      context().refused()
      throw new Error(`Not written, because it changes the id of ${path}. Its id is ${id}, and an id never changes.`)
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

  /**
   * A field name the model garbled ("estimate /") would otherwise be dropped
   * without a word, and the change it meant would silently not happen. It's
   * said in the result rather than refused: refusing made a local model send
   * the same garbled name again and again.
   */
  const unknownFields = (params: object, known: string[]) => {
    const unknown = Object.keys(params).filter((k) => !known.includes(k))
    return unknown.length
      ? `\n  Ignored ${unknown.map((k) => JSON.stringify(k)).join(', ')}: not a field. The fields are ${known.join(', ')}; call again if you meant one of them.`
      : ''
  }

  /**
   * Says when a todo's slot runs into something on the user's calendar, so a
   * slip in the arithmetic is caught (AGENTS.md, principle 8). It doesn't refuse:
   * sometimes overlapping is what the user wants.
   */
  const overlaps = async (data: Record<string, unknown>) => {
    if (typeof data.scheduled !== 'string' || !data.scheduled) return ''
    const { found, unchecked } = await clashes(data.scheduled, Number(data.estimate) || 30).catch(() => ({ found: [], unchecked: ['the calendar'] }))
    const clash = found.length ? `\n  It overlaps ${found.join('; ')} on the user's calendar. Move it unless they want that.` : ''
    const unknown = unchecked.length ? `\n  Couldn't check ${unchecked.join(', ')} just now, so don't tell the user that time is free.` : ''
    return clash + unknown
  }

  const todoInput = Type.Object({
    id: Type.Optional(Type.String({ description: 'When revising, the id of the draft this one keeps. Leave out for a new todo.' })),
    title: Type.String({ description: 'What to do, starting with a verb.' }),
    estimate: Type.Integer({ minimum: 1, description: 'Minutes, based on how long similar todos actually took.' }),
    ...timeParams('Leave date and time out to put it in the backlog.'),
    deadline: deadlineParam,
    repeat: Type.Optional(
      Type.String({
        description:
          'When the user wants it done again and again: an RRULE like FREQ=WEEKLY;BYDAY=MO, FREQ=DAILY, FREQ=MONTHLY;BYMONTHDAY=1. Its date and time are the first time; the app writes each next one. Leave it out for a one-off.',
      }),
    ),
    goal: Type.Optional(Type.String({ description: 'The id of the goal it serves.' })),
    cue: Type.Optional(Type.String({ description: 'The situation it gets done in.' })),
    why: Type.Optional(Type.String({ description: 'Your reasoning for when and how long, in one sentence to the user.' })),
  })

  const todosPropose = defineTool({
    name: 'todos_propose',
    label: 'Propose todos',
    description:
      'Proposes new todos as drafts, shown to the user as one plan they can accept, tweak, or turn down. Nothing counts until they accept. Returns the new ids. To change a plan you proposed, call it again with revise and the whole new list. Give each draft you keep its id. A draft you leave out of the list is deleted: that is how to drop one from the plan. When the user says when something has to be done by, give it as deadline on each todo for it, and date and time before then: the app shows what is due from the deadline, so one said only in your reply is lost.',
    parameters: Type.Object({
      title: Type.Optional(Type.String({ description: "The plan's name as the user would say it, like 今天的安排." })),
      revise: Type.Optional(Type.String({ description: 'One id: any one draft from the plan being changed.' })),
      todos: Type.Array(todoInput, { minItems: 1 }),
    }),
    async execute(_id, params) {
      const lastRank = workspace
        .list()
        .filter((i) => i.kind === 'todo')
        .reduce<string | null>((max, i) => (typeof i.data.rank === 'string' && (!max || i.data.rank > max) ? i.data.rank : max), null)
      const same = (a: unknown) => String(a).replace(/\s+/g, '').toLowerCase()
      // Iterating on a plan had no way to drop a draft, and proposing again was refused as a duplicate.
      // A small model listed the plan again without revise, twice, then gave up: when every title it
      // repeats is a draft of one plan, that's the plan it means.
      const repeated = workspace.list().filter((i) => i.data.state === 'draft' && params.todos.some((t) => t.id === i.id || same(t.title) === same(i.data.title)))
      // Given several ids anyway, any one of them names the plan.
      const named = params.revise?.split(/[\s,]+/).find((id) => plans(id))
      const inferred = !params.revise && repeated.length ? plans(repeated[0].id) : undefined
      const revise = named ?? (inferred && repeated.every((i) => inferred.includes(i.id)) ? repeated[0].id : undefined)
      const revised = revise ? plans(revise) : undefined
      if (params.revise && !revised) throw new Error(`No plan in this conversation has ${params.revise}. Give the id of a draft from the plan to change. Nothing was proposed.`)
      const drafts = (revised ?? []).flatMap((id) => {
        const item = workspace.get(id)
        return item?.data.state === 'draft' ? [item] : []
      })
      const draftFor = (todo: (typeof params.todos)[number]) => drafts.find((d) => d.id === todo.id) ?? drafts.find((d) => same(d.data.title) === same(todo.title))
      // Every time is checked before anything is written, so a bad one changes nothing.
      // A kept draft is moved, not placed anew, so it keeps its zone: a New York call given back as 22:00 in Tokyo stays 09:00 New York.
      const times = params.todos.map((todo) => (todo.date || todo.time ? scheduleText(todo, here(), draftFor(todo)?.data.scheduled) : null))
      // Left out, a deadline stays as it was; "" removes it.
      for (const todo of params.todos) if (todo.repeat && ruleProblem(todo.repeat.trim())) throw new Error(`${ruleProblem(todo.repeat.trim())} Nothing was proposed.`)
      const dues = params.todos.map((todo) => (todo.deadline === undefined ? undefined : todo.deadline.trim() ? dueText(todo.deadline, here()) : null))
      // Asked to schedule a todo from the backlog, a small model proposed a new one with the same name.
      const open = workspace.list().filter((i) => i.kind === 'todo' && i.data.state !== 'done' && i.data.state !== 'dropped' && !drafts.some((d) => d.id === i.id))
      const existing = params.todos.flatMap((t) => open.filter((i) => same(i.data.title) === same(t.title)))
      // Revising, a model listed a todo from another plan alongside this plan's: that one is left as it is, and the rest goes ahead.
      const skipped = revised ? existing : []
      if (existing.length && !revised) {
        const why = (i: (typeof existing)[number]) =>
          i.data.state === 'draft'
            ? `"${i.data.title}" is already a draft you proposed (${i.id}); to change that plan, call todos_propose with revise: ${i.id} and the whole new list`
            : `"${i.data.title}" is already a todo (${i.id}${i.data.scheduled ? '' : ', in the backlog'}); to schedule or change it, use todos_update with its id`
        throw new Error(`Not proposed: ${existing.map(why).join('; ')}. Propose only todos that don't exist yet.`)
      }
      let rank = lastRank
      const ids: string[] = []
      const lines: string[] = []
      const changes = { added: [] as string[], changed: [] as string[], removed: [] as string[] }
      for (const [index, todo] of params.todos.entries()) {
        if (skipped.some((i) => same(i.data.title) === same(todo.title))) continue
        const time = times[index]
        const fields: Fields = { title: todo.title, estimate: todo.estimate, scheduled: time?.text ?? null, proposed: time ? true : null, ...(dues[index] !== undefined && { due: dues[index] }) }
        for (const key of ['goal', 'cue', 'why'] as const) fields[key] = todo[key] || null
        const draft = draftFor(todo)
        let item
        if (draft) {
          item = await workspace.update(draft.id, fields, actor())
          if (draft.data.scheduled !== item.data.scheduled || draft.data.estimate !== item.data.estimate) changes.changed.push(item.id)
        } else {
          rank = generateKeyBetween(rank, null)
          item = await workspace.create('todo', { ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null)), state: 'draft', rank, created: stamp(deviceZone()) }, '', actor())
          changes.added.push(item.id)
        }
        // A repeating one: its series, which writes each next time once this first one is accepted.
        let repeats = ''
        if (todo.repeat && !draft) {
          const series = await workspace.create('repeat', {
            title: todo.title,
            state: 'draft',
            rule: todo.repeat.trim(),
            start: time?.text ?? dues[index] ?? todayIn(here()).toString(),
            estimate: todo.estimate,
            ...(todo.goal && { goal: todo.goal }),
            ...(todo.cue && { cue: todo.cue }),
            ...(dues[index] && time && { due_after: dueAfter(time.text, dues[index]!) }),
            last: (readTime(time?.text) ? dateOf(readTime(time!.text)!, here()) : todayIn(here())).toString(),
            created: stamp(deviceZone()),
          }, '', actor())
          item = await workspace.update(item.id, { series: series.id, occurrence: String(series.data.last) }, actor())
          const dates = upcoming(String(series.data.rule), readTime(series.data.start, 'deadline')!, todayIn(here()))
          repeats = `\n  Repeats ${series.data.rule} (${series.id}): ${dates.map((d) => `${d.toLocaleString('en-US', { weekday: 'short' })} ${d}`).join(', ')}, … If that isn't what the user said, fix the rule in its file.`
        }
        ids.push(item.id)
        lines.push(`- ${describe(item.data, here())}${repeats}${time?.note ?? ''}${pastDue(item.data, here())}${await overlaps(item.data)}${unknownFields(todo, Object.keys(todoInput.properties))}`)
      }
      // Drafts are the agent's own proposals, so leaving one out removes it; undo brings it back.
      for (const draft of drafts.filter((d) => !ids.includes(d.id))) {
        await workspace.removeFile(draft.path, actor())
        changes.removed.push(String(draft.data.title))
      }
      // A small model left the plan's name out; the first todo names it then.
      const title = params.title || params.todos[0].title
      const details: CardDetails = { card: { kind: 'plan', title, todoIds: ids, ...(revised && { revises: revised, changes }) } }
      const removed = changes.removed.length ? `\nRemoved: ${changes.removed.map((t) => `"${t}"`).join(', ')}.` : ''
      const left = skipped.length ? `\nLeft as they are, since they aren't in this plan: ${skipped.map((i) => `"${i.data.title}" (${i.id})`).join(', ')}. Use todos_update to change them.` : ''
      return {
        content: text(`${revised ? `Revised the plan${params.revise ? '' : ' (its drafts were listed again, so this is taken as a new version)'}` : 'Proposed the plan'}: ${ids.length} drafts. The user sees it as one plan and decides:\n${lines.join('\n')}${removed}${left}\nTo change it, call todos_propose with revise: ${ids[0]} and the whole new list, each kept draft with its id. A draft left out is deleted.`),
        details,
      }
    },
  })

  const todosUpdateParams = Type.Object({
    id: Type.String(),
    title: Type.Optional(Type.String()),
    // A local model scheduled "45 minutes next Wednesday" and left the 20-minute estimate, so the clash check missed the overlap.
    estimate: Type.Optional(Type.Integer({ minimum: 1, description: 'Minutes. Set it whenever the user says how long it takes.' })),
    ...timeParams('Give both to move it. To put it back in the backlog, set backlog to true instead.'),
    backlog: Type.Optional(Type.Boolean({ description: 'true takes it off the calendar, back to the backlog.' })),
    deadline: deadlineParam,
    userAskedForThisTime: Type.Boolean({
      description:
        'true only when the user\'s own message named this exact time, like "排到明天晚上八點": then the time is theirs, not your proposal. false when you chose the time, even because the user asked you to find one, and when you are not changing the time.',
    }),
    goal: Type.Optional(Type.String({ description: 'A goal id, or "" for none.' })),
    cue: Type.Optional(Type.String({ description: 'The situation it gets done in, or "" for none.' })),
    why: Type.Optional(Type.String()),
  })

  const todosUpdate = defineTool({
    name: 'todos_update',
    label: 'Update a todo',
    description:
      "Changes an existing todo. Give only the fields to change, plus userAskedForThisTime. Scheduling or moving it marks the time as your proposal until the user confirms it, unless they asked for that exact time. When the user says when it has to be done by, set deadline: the app shows what's due from it, so one said only in your reply is lost. You can't accept a draft for the user or mark something done that they didn't do.",
    parameters: todosUpdateParams,
    async execute(_id, params) {
      const ignored = unknownFields(params, Object.keys(todosUpdateParams.properties))
      const { id, userAskedForThisTime, date, time, zone, backlog, deadline, ...change } = Object.fromEntries(
        Object.entries(params).filter(([k]) => k in todosUpdateParams.properties),
      ) as typeof params
      const item = workspace.get(id)
      if (item?.kind !== 'todo') throw new Error(`There is no todo ${id}.`)
      const scheduled = backlog ? null : date || time || zone ? scheduleText({ date, time, zone }, here(), item.data.scheduled, true) : undefined
      // An empty string clears the field.
      const fields: Fields = Object.fromEntries(Object.entries(change).map(([k, v]) => [k, v === '' ? null : v]))
      if (deadline !== undefined) fields.due = deadline.trim() ? dueText(deadline, here()) : null
      if (scheduled !== undefined) {
        fields.scheduled = scheduled?.text ?? null
        fields.proposed = scheduled && !userAskedForThisTime ? true : null
      }
      const updated = await workspace.update(id, fields, actor())
      return { content: text(`Now: ${describe(updated.data, here())}${scheduled?.note ?? ''}${pastDue(updated.data, here())}${scheduled || change.estimate ? await overlaps(updated.data) : ''}${ignored}`), details: undefined }
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
          // A plain string, read leniently: a small model wrote "Todo" and "Goal Idea".
          as: Type.String({ description: 'One of: todo, goal, memory, keep, ask.' }),
          title: Type.String({ description: 'The todo, goal idea or memory as you would write it; for ask, your question.' }),
        }),
        { minItems: 1 },
      ),
    }),
    async execute(_id, params) {
      const { session } = context()
      const kinds = ['todo', 'goal', 'memory', 'keep', 'ask'] as const
      const notes = workspace.list().filter((i) => i.kind === 'note' && i.data.state === 'new')
      const items = params.items.map((item) => {
        const as = kinds.find((k) => item.as.toLowerCase().includes(k))
        if (!as) throw new Error(`"${item.as}" for ${item.note} isn't a kind. Use one of: ${kinds.join(', ')}. Nothing was proposed.`)
        // The note's file path works as well as its id; a small model sent paths.
        const note = item.note.replace(/^.*\//, '').replace(/\.md$/, '')
        if (workspace.get(note)?.kind !== 'note') {
          throw new Error(`There is no note ${item.note}. The notes waiting are ${notes.map((n) => n.id).join(', ')}. Nothing was proposed.`)
        }
        return { ...item, note, as }
      })
      for (const item of items) {
        await workspace.update(item.note, { state: 'sorting', proposal: { as: item.as, title: item.title, session }, became: null }, actor())
      }
      const details: CardDetails = {
        card: { kind: 'plugin', plugin: 'notes', type: 'sort', data: { items: items.map((i) => ({ noteId: i.note, as: i.as, title: i.title })) } },
      }
      return { content: text(`Proposed how to sort ${items.length} notes. The user decides on the card.`), details }
    },
  })

  const todosList = defineTool({
    name: 'todos_list',
    annotations: { readOnlyHint: true },
    label: 'List todos',
    description:
      'Lists todos in one compact table, instead of reading their files one by one: everything not done or dropped, plus what was done in the given days. Read a todo file only when you need its steps or notes.',
    parameters: Type.Object({
      doneSince: Type.Optional(Type.String({ description: 'Also list todos done on or after this date, like 2026-09-22.' })),
    }),
    async execute(_id, params) {
      const rows = workspace
        .list()
        .filter((i) => i.kind === 'todo')
        .filter((i) => (i.data.state !== 'done' && i.data.state !== 'dropped') || (i.data.state === 'done' && params.doneSince && doneOn(i, here()) >= params.doneSince))
        // By when they happen, not by how their time is spelled; the backlog last.
        .sort((a, b) => (epochOf(readTime(a.data.scheduled), deviceZone()) ?? Infinity) - (epochOf(readTime(b.data.scheduled), deviceZone()) ?? Infinity))
        .map((i) => {
          const d = i.data
          const extra = [d.goal && `goal ${d.goal}`, d.cue && `cue ${d.cue}`, d.amount !== undefined && `amount ${d.amount}`].filter(Boolean).join(', ')
          return `- ${describe(d, here())}${extra ? ` (${extra})` : ''}`
        })
      return { content: text(rows.length ? rows.join('\n') : 'No todos.'), details: undefined }
    },
  })

  const itemLinks = defineTool({
    name: 'item_links',
    annotations: { readOnlyHint: true },
    label: 'Links',
    description: 'Shows what an item links to and what links to it: todos, goals, notes and the rest, with their titles.',
    parameters: Type.Object({ id: Type.String() }),
    async execute(_id, params) {
      const item = workspace.get(params.id)
      if (!item) throw new Error(`There is no item ${params.id}.`)
      const line = (i: { id: string; kind: string; path: string; data: Record<string, unknown> }) =>
        `- ${i.kind} ${i.id} "${i.data.title ?? i.data.name ?? ''}" (${i.path})`
      const out = (item.links ?? []).flatMap((id) => workspace.get(id) ?? [])
      const back = workspace.backlinks(item.id)
      const text = [`Links from ${item.id}:`, ...(out.length ? out.map(line) : ['- none']), `Links to ${item.id}:`, ...(back.length ? back.map(line) : ['- none'])]
      return { content: [{ type: 'text' as const, text: text.join('\n') }], details: undefined }
    },
  })

  const skillInstall = defineTool({
    name: 'install_from_address',
    label: 'Install',
    description: "Installs a skill, pi package or MCP server, only when the user asks to install one. Accepts a GitHub or archive address, npm:name@version, an MCP URL, a command, or mcpServers JSON. Skills already installed are listed in your instructions: to use one, read its SKILL.md and follow it; don't install it. If several skills are found, returns their paths without installing; call again with path. Use replace only when the user asked to replace an existing installation.",
    parameters: Type.Object({
      source: Type.String({ description: 'A GitHub or archive address, local folder or archive path, npm:name@version, MCP URL, command with arguments, or mcpServers JSON.' }),
      path: Type.Optional(Type.String({ description: 'The method directory in the source, from the list returned by this tool. An empty string selects the root.' })),
      replace: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params) {
      // A skill is lasting instructions. Outside content, such as email or a
      // calendar invite, must not get an unattended run to install one.
      const acting = currentActing()
      if (acting.actor.by !== 'agent' || acting.source !== 'user') throw new Error('Skills can only be installed when the user asks in the conversation.')
      // A small model called this to use a skill it already had, passing its SKILL.md.
      const named = (await listSkills(workspace.root)).find((k) => `${params.source} ${params.path ?? ''}`.includes(k.name))
      if (named && !/^(https?:\/\/|npm:)/.test(params.source.trim())) {
        throw new Error(`"${params.source}" is the skill ${named.name}, which is already installed. To use it, read ${named.id}/SKILL.md and do what it says.`)
      }
      const outcome = await installer(workspace).agentInstall(params.source, params.path, params.replace)
      if (outcome.summary) {
        context().acted = true
        return { content: text(outcome.summary), details: undefined }
      }
      const skipped = outcome.skipped ?? outcome.result?.skipped ?? []
      const warnings = skipped.map((s) => `${s.count} skipped: ${s.reason}`).join('; ')
      if (outcome.choices) return { content: text(`Nothing installed. Choose a method and call install_from_address again with its path:\n${outcome.choices.map((s) => `- path: ${JSON.stringify(s.path)}, name: ${s.name}, description: ${s.description}`).join('\n')}${warnings ? `\n${warnings}` : ''}`), details: undefined }
      return {
        content: text(`${outcome.result!.installed.map((s) => `Installed "${s.title}" at ${s.directory}/ (${s.files} files). The skill is on.`).join('\n')}${warnings ? `\n${warnings}` : ''}\nIt will be used from the next conversation.`),
        details: undefined,
      }
    },
  })

  const askUser = defineTool({
    name: 'ask_user',
    annotations: { readOnlyHint: true },
    label: 'Ask the user',
    description:
      'Asks the user to pick one of a few short answers, shown as buttons under your message. Say the question in your reply first. Your turn ends here; their pick comes back as their next message.',
    parameters: Type.Object({ options: Type.Array(Type.String(), { minItems: 2, maxItems: 5 }) }),
    async execute(_id, params) {
      const details: CardDetails = { card: { kind: 'choices', options: params.options } }
      context().asked = true
      return { content: text('Asked. Wait for the answer.'), details, terminate: true }
    },
  })

  // A conversation the user deleted a memory from isn't there to read.
  const readOps = {
    readFile: async (absolute: string) => {
      const path = insideWorkspace(root, absolute)
      if (path && blocked(path)) throw new Error('This conversation is closed to you: the user deleted a memory that came from it.')
      return readFile(absolute)
    },
    access: (absolute: string) => access(absolute),
  }

  return [
    createReadToolDefinition(root, { operations: readOps }),
    createLsToolDefinition(root),
    createBashToolDefinition(root, {
      operations: shellOperations(workspace, () => ({ actor: actor(), heard: context().heard, closed: context().closed }), checkpoints),
      exposeSessionEnvironment: false,
    }),
    createWriteToolDefinition(root, { operations: writeOps }),
    createEditToolDefinition(root, { operations: editOps }),
    todosList,
    todosPropose,
    todosUpdate,
    notesPropose,
    itemLinks,
    askUser,
    skillInstall,
  ] as ToolDefinition[]
}

export const TOOL_NAMES = ['read', 'ls', 'bash', 'write', 'edit', 'todos_list', 'todos_propose', 'todos_update', 'notes_propose', 'item_links', 'ask_user', 'memory_remember', 'memory_recall', 'memory_forget', 'calendar_events', 'install_from_address']

/** The date a done todo was done, from where the device is; its scheduled day when it has no record. */
function doneOn(item: { data: Record<string, unknown> }, zone: Zone) {
  const value = readTime(item.data.completed, 'record') ?? readTime(item.data.scheduled)
  return value ? dateOf(value, zone).toString() : ''
}
