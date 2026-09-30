// Entities the UI works with. They follow docs/design/storage.md, so the mock
// store can later be replaced by the real index without reshaping the UI.

import type { DiffLine, HistoryEntry, ISODate, SessionMessage, SessionView, Step, Trigger } from '../../../shared/session'

export type { DiffLine, HistoryEntry, ISODate, Step, Trigger }

/**
 * A goal as the UI draws it: what its file says, and what the app counts from
 * the todos. Progress is never written by hand (docs/design/goals.md).
 */
export interface Goal {
  id: string
  name: string
  /** Hue for the goal's color, in oklch. */
  hue: number
  state: 'active' | 'paused' | 'done'
  /** Why it matters and what done means, in the user's words. */
  why?: string
  due?: ISODate
  /** What happens on the due date: "送出", "台北馬". */
  dueNote?: string
  progress: { done: number; total: number; unit: string }
  /** This week, in the goal's unit: what was done, and what's scheduled and not done yet. */
  week: { done: number; planned: number }
  /** The agent's own read on how the goal is going. */
  agentNote?: string
  /** The if-then rules the agent schedules by, with how often they worked. */
  rules: { cue: string; action: string; hits: number; tries: number }[]
  /** Recent times, in minutes: what was planned and what it actually took. */
  samples: { estimated: number; actual: number }[]
  report?: { range: string; lines: Finding[] }
  /** A change to a rule the agent proposes because the rule keeps failing. The user decides. */
  ruleProposal?: { ruleIndex: number; cue: string; action: string; why: string }
}

/** Something the agent concluded, and what it's based on: the user's word or a number of records. */
export interface Finding {
  text: string
  basis?: 'stated' | { records: number }
}

/**
 * A todo the agent proposed is a draft until the user accepts it. Drafts never
 * count as progress, because a plan is not the same as doing the work.
 */
export type TodoState = 'draft' | 'open' | 'done'

export interface Todo {
  id: string
  title: string
  goalId: string | null
  state: TodoState
  /** The situation it gets done in: "到公司倒完咖啡". */
  cue?: string
  estimateMinutes: number
  /**
   * When it's scheduled, in hours from midnight. Null means it's in the backlog.
   * A proposed slot is a time the agent suggested and the user hasn't accepted.
   */
  slot: { date: ISODate; start: number; proposed?: boolean } | null
  subtasks?: { text: string; done: boolean }[]
  /** The agent's reasoning for when and how long. */
  why?: string
  /** Set when the todo mirrors an event on the user's calendar. */
  fromCalendar?: boolean
  /** When the user pressed 開始, in milliseconds since the epoch. Cleared when they stop. */
  startedAt?: number
  /** Where it sits in the backlog, as a fractional index. Lower comes first. */
  rank?: string
  /** How much of its goal's measure it moves when done. 1 if not set. */
  amount?: number
  /** When it was done, in milliseconds since the epoch. */
  completedAt?: number
}

/**
 * Something jotted down in 隨手記: a thought, a goal idea, a thing to do, all
 * without sorting. The agent sorts it later, when the user hands the list over.
 */
export interface Note {
  id: string
  text: string
  date: ISODate
  /** Hours from midnight. */
  time: number
  /** Typed on the page, or sent from the ⌥X window. */
  source: 'page' | 'hotkey'
  /**
   * `new` waits to be sorted. `sorting` has a proposal from the agent the user
   * hasn't decided on. `sorted` is done, and `became` says what it turned into.
   */
  state: 'new' | 'sorting' | 'sorted'
  /**
   * What the agent proposed it becomes. It stays after the user decides, so
   * taking the decision back shows the proposal again.
   */
  proposal?: NoteProposal
  became?: NoteOutcome
}

/** What a note can become. `keep` stays a note: a thought worth keeping, nothing to do. */
export type NoteKind = 'todo' | 'goal' | 'memory' | 'keep'

/** What a note became: for a todo or a memory, `ref` is its id; for a goal idea, `title` is the idea. */
export interface NoteOutcome {
  kind: NoteKind
  ref?: string
  title?: string
}

export interface NoteProposal {
  as: NoteKind | 'ask'
  /** The todo, goal or memory as the agent would write it; for `ask`, the question. */
  title: string
  /** For a question the user answered: the question, so taking the answer back asks it again. */
  question?: string
  /** The session that proposed it. */
  session?: string
  decision?: 'accepted' | 'rejected'
}

/** One note in the agent's proposal: what it thinks the note becomes, or a question when it can't tell. */
export interface SortItem {
  noteId: string
  as: NoteKind | 'ask'
  /** The todo, goal or memory as the agent would write it; for `ask`, the question. */
  title: string
  /** For a question the user answered: the question, so taking the answer back asks it again. */
  question?: string
  decision?: 'accepted' | 'rejected'
}

/** How much of the calendar shows at once. */
export type CalendarViewName = 'day' | 'week' | 'month'

/** An event from a connected calendar. Read-only in Jezo. */
export interface CalendarEvent {
  id: string
  title: string
  date: ISODate
  start: number
  hours: number
  /** An all-day event starts at 0 and lasts whole days, so its hours are 24 per day. */
  allDay?: boolean
  source: string
}

/**
 * What a conversation shows. Most kinds come from the agent's session
 * (src/shared/session.ts); the rest are still drawn from mock data.
 */
export type Message =
  | SessionMessage
  /** Something the agent saved to memory. */
  | { kind: 'memory'; text: string }
  /**
   * The agent reworking a day that went badly. The user says how they're doing,
   * the agent drafts what to keep, move, and drop, and nothing changes until
   * they accept. `before` holds the todos as they were, for undo.
   */
  | { kind: 'rework'; energy?: Energy; applied?: boolean; before?: Todo[] }
  /**
   * What a session is about to write to memory, shown before it's written.
   * Inferences without enough evidence are listed as not written.
   */
  | { kind: 'memory-preview'; stated: string[]; skipped: { text: string; why: string }[]; plan: string[]; saved?: boolean }

export type Energy = 'low' | 'some' | 'plenty'

export interface Session extends Omit<SessionView, 'messages'> {
  messages: Message[]
}

export interface Memory {
  id: string
  text: string
  /** Stated by the user, or inferred by the agent from evidence. */
  kind: 'stated' | 'inferred'
  /** When it was stated or last inferred. */
  date: ISODate
  /** The session it came from, for stated memories. */
  via?: Trigger
  /** How many records an inference rests on, and how sure the agent is. */
  evidence?: number
  confidence?: 'low' | 'medium' | 'high'
}

export interface Skill {
  id: string
  title: string
  description: string
  enabled: boolean
  /** The skill's instructions to the agent: its SKILL.md. */
  instructions: string
  /** A change the agent wants to make to the skill, with its reasons. The user decides. */
  proposal?: { why: string; evidence: string[]; diff: DiffLine[]; after: string }
  /** Set once the user has looked at and accepted the agent's change. */
  reviewed?: boolean
}

export interface Connection {
  id: string
  name: string
  connected: boolean
  /** What the connector says about itself, like when it last synced. */
  detail?: string
  /** What connecting lets Jezo read and write, as the connector describes it. */
  access?: { reads: string; writes?: string }
}

export interface Experiment {
  id: string
  title: string
  weeks: number
  /** The week it's in, while running. */
  week?: number
  finished: boolean
  arms?: { label: string; value: string; metric: string; highlight?: boolean }[]
  conclusion?: string
  decision?: 'adopt' | 'rerun' | 'drop'
}
