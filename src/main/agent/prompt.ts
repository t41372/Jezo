// What Jezo's agent is told. This is product content: it's written for the
// agent inside the app, not for whoever builds Jezo.

import type { Item } from '../../shared/workspace'
import type { Trigger } from '../../shared/session'

export const SYSTEM_PROMPT = `You are Jezo, a personal agent that helps one person manage their life: their todos, goals, calendar and habits. The user sets the direction. You plan, propose, and follow up. The user does the work.

How you work:
- You propose; the user decides. A todo you create is a draft until the user accepts it, and a time you suggest is a proposal until they confirm it. Never present a plan as progress: planning something is not doing it.
- Everything lives in the workspace, a directory of markdown files. Read the directory's AGENTS.md before changing items in it. The files are the truth: when you say you did something, the files must show it.
- Prefer the tools made for a job (todos_list, todos_propose, todos_update, notes_propose, ask_user) over reading and editing files by hand; todos_list shows every todo at once. Edit files directly for anything the tools don't cover, like a goal's note or a proposed rule change.
- Act without asking permission for changes inside the workspace. The user can undo anything you change there. Ask only when different readings would lead to different plans, and then use ask_user with short options.
- Be brief and plain. Talk like a thoughtful friend, not a coach and not a boss. No lists of tips, no cheerleading, no guilt. When something didn't get done, adjust the plan; don't lecture.
- Write everything the user reads in the language they write in, including short notes between steps. If they haven't written anything, use the language of their notes and todos. Titles and text you write into files follow the same rule.
- Methods for planning (how to estimate, when to schedule, how to break goals down) are skills. Use the ones that apply; the user chose them.`

/**
 * Words that say something was done: scheduled, added, changed, removed,
 * remembered. A reply that says one of them when no file changed has probably
 * claimed a change it never made (docs/design/backend.md, "Checks").
 */
export const CLAIMS_ACTION = /(排好|排到|排進|排在|排了|加好|加進|加到|加了|改好|改成|改到|改了|移到|挪到|刪掉|刪了|記下|記住了|建好|建了|已經(幫你)?(排|加|改|移|挪|刪|記|建))|\b(scheduled|added|moved|updated|changed|deleted|removed|saved|created)\b/i

/** Sent back to the agent when its reply claims a change that no file shows. The user doesn't see it. */
export const CLAIMED_WITHOUT_CHANGE =
  "Your reply says you changed something, but nothing in the workspace changed in this turn. If you meant to make the change, make it now with the tools. If you didn't, tell the user plainly that nothing was changed yet."

/**
 * The request a session Jezo starts sends to the agent. The user doesn't see
 * it. Scheduled sessions are automations, whose requests are their files'
 * bodies (automations/items/*.md).
 */
export const REQUESTS: Partial<Record<Trigger, string>> = {
  notes: 'The user handed you their unsorted notes (隨手記). Sort them with the sort-notes skill, then propose what each becomes with notes_propose.',
}

const pad = (n: number) => String(n).padStart(2, '0')
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/**
 * A short picture of where things stand, given at the start of every session so
 * the agent doesn't have to guess where to look (docs/design/concept.md, "Session 模型").
 */
export function digest(items: Item[], now = new Date()) {
  const today = localDate(now)
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' })
  const todos = items.filter((i) => i.kind === 'todo')
  const line = (t: Item) => {
    const d = t.data
    const when = typeof d.scheduled === 'string' ? d.scheduled.slice(11) : 'no time'
    const flags = [d.state !== 'open' && d.state, d.proposed && 'time proposed'].filter(Boolean).join(', ')
    return `- ${when} ${d.title} (${t.id}, ${d.estimate ?? '?'} min${flags ? `, ${flags}` : ''})`
  }
  const todayTodos = todos.filter((t) => typeof t.data.scheduled === 'string' && t.data.scheduled.startsWith(today))
  todayTodos.sort((a, b) => String(a.data.scheduled).localeCompare(String(b.data.scheduled)))
  const backlog = todos.filter((t) => !t.data.scheduled && t.data.state !== 'done')
  const waitingNotes = items.filter((i) => i.kind === 'note' && i.data.state === 'new').length
  const goals = items.filter((i) => i.kind === 'goal' && i.data.state === 'active')
  const goalLine = (g: Item) => {
    const d = g.data as { name: string; due?: string; measure?: { unit: string; total: number }; rules?: { cue: string; action: string }[] }
    const rules = (d.rules ?? []).map((r) => `${r.cue} → ${r.action}`).join('; ')
    return `- ${d.name} (${g.id}${d.due ? `, due ${d.due}` : ''}${d.measure ? `, ${d.measure.total} ${d.measure.unit}` : ''})${rules ? `: ${rules}` : ''}`
  }
  const problems = items.filter((i) => i.problems?.length)

  return [
    `Now: ${weekday} ${today} ${pad(now.getHours())}:${pad(now.getMinutes())} (local time).`,
    '',
    todayTodos.length ? `Today's todos:\n${todayTodos.map(line).join('\n')}` : 'Nothing is scheduled today.',
    '',
    backlog.length ? `Backlog (${backlog.length}, not scheduled):\n${backlog.slice(0, 15).map(line).join('\n')}` : 'The backlog is empty.',
    '',
    goals.length ? `Active goals (progress is counted from done todos; read goals/AGENTS.md):\n${goals.map(goalLine).join('\n')}` : 'No active goals.',
    '',
    `Notes waiting to be sorted: ${waitingNotes}.`,
    ...(problems.length
      ? ['', `Files with problems:\n${problems.map((p) => `- ${p.path}: ${p.problems!.join('; ')}`).join('\n')}`]
      : []),
    '',
    'The workspace is the current directory. Its AGENTS.md describes the layout.',
  ].join('\n')
}
