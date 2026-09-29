// Entities the UI works with. They follow docs/design/storage.md, so the mock
// store can later be replaced by the real index without reshaping the UI.

/** A date without a time, like "2026-09-29". */
export type ISODate = string

export interface Goal {
  id: string
  name: string
  /** Hue for the goal's color, in oklch. */
  hue: number
  /** When the goal is due, as the user would say it: "11/15 送出 · 還有 7 週". */
  dueLabel: string
  progress: { done: number; total: number; unit: string }
  /** Short progress line for the goal card: "這週 1 / 2 段". */
  weekShort: string
  /** Longer progress line for the goal page. */
  weekLong: string
  /** The agent's own read on how the goal is going. */
  agentNote: string
  /** The if-then rules the agent schedules by, with how often they worked. */
  rules: { cue: string; action: string; hits: number; tries: number }[]
  /** How much is scheduled this week but not done yet, in the same unit as progress. */
  plannedThisWeek: number
  estimates: {
    summary: string
    lines: Finding[]
    /** Recent times, in minutes: what the user estimated and what it actually took. */
    samples?: { estimated: number; actual: number }[]
  }
  report: { range: string; lines: Finding[] }
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
  became?: NoteOutcome
}

/** What a note can become. `keep` stays a note: a thought worth keeping, nothing to do. */
export type NoteKind = 'todo' | 'goal' | 'memory' | 'keep'

export type NoteOutcome =
  | { kind: 'todo'; todoId: string }
  | { kind: 'goal'; title: string }
  | { kind: 'memory'; memoryId: string }
  | { kind: 'keep' }

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

export type Message =
  | { kind: 'agent'; text: string }
  | { kind: 'user'; text: string }
  /** What the agent looked at or changed, folded away by default. */
  | { kind: 'steps'; summary: string; lines: string[] }
  /** A plan the agent proposed. Its todos are drafts until accepted. */
  | { kind: 'plan'; title: string; todoIds: string[] }
  | { kind: 'choices'; options: string[]; picked?: string }
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
  /**
   * A message of a kind a plugin brings, drawn by the view the plugin
   * registered as "<plugin>.<type>". The core doesn't look inside `data`.
   */
  | { kind: 'plugin'; plugin: string; type: string; data: unknown }

export type Energy = 'low' | 'some' | 'plenty'

/** One line of a change to a file, as a diff shows it. */
export interface DiffLine {
  kind: 'add' | 'remove' | 'context'
  text: string
}

/** What started a session, or made a change. */
export type Trigger = 'morning' | 'evening' | 'weekly' | 'hotkey' | 'user' | 'notes'

export interface Session {
  id: string
  /** Scheduled sessions are named after their trigger and have no title of their own. */
  title?: string
  trigger: Trigger
  date: ISODate
  /** Hours from midnight. */
  time: number
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

export interface HistoryEntry {
  id: string
  date: ISODate
  time: number
  /** Who made the change. Only the agent's own changes can be undone (docs/design/undo.md). */
  source: Trigger | 'you'
  summary: string
  /** Set when a check caught a problem with this change. */
  check?: { level: 'warn'; retries: number } | { level: 'error'; kind: 'claimed-without-change' }
  /** The files the change touched, and how. */
  files?: { path: string; lines: DiffLine[]; note?: string }[]
  undone?: boolean
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
