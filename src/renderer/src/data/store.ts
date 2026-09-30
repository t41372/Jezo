// The renderer's state. Todos and notes come from the workspace, and
// conversations and the change history from Jezo's agent (docs/design/backend.md).
// The store applies the user's changes at once and writes them, and what comes
// back replaces them. Goals, memory, skills and the rest are still mock data.

import { generateKeyBetween } from 'fractional-indexing'
import { toast } from 'sonner'
import { create } from 'zustand'
import type { ThemeSource } from '../../../shared/bridge'
import type { Fields, Item, ItemChanges } from '../../../shared/workspace'
import i18n, { applyLanguage, storedLanguage, type LanguageSetting } from '@/i18n'
import { entities, localDate, stamp, toGoal, toMemory, toNote, toTodo, todoFields } from './entities'
import * as mock from './mock'
import type { CalendarEvent, CalendarViewName, Connection, Energy, Experiment, Goal, HistoryEntry, ISODate, Memory, Message, Note, NoteKind, NoteOutcome, NoteProposal, Session, Skill, Todo, Trigger } from './types'

export interface Nav {
  page: string
  /** A view inside the page, like one goal or one section of 更多. */
  sub: string | null
}

type Slot = NonNullable<Todo['slot']>

/** The current date, and hours from midnight. */
export interface Now {
  date: ISODate
  hour: number
}

interface State {
  now: Now
  goals: Goal[]
  todos: Todo[]
  events: CalendarEvent[]
  sessions: Session[]
  memories: Memory[]
  skills: Skill[]
  experiments: Experiment[]
  history: HistoryEntry[]
  connections: Connection[]
  notes: Note[]
  settings: { theme: ThemeSource; language: LanguageSetting }

  nav: Nav
  /** The open conversation. Null is a new one that hasn't been sent yet. */
  sessionId: string | null
  composer: string
  /** The todo open in the detail panel on 今天. */
  todayDetail: string | null
  /** The todo or event open in the panel on 行事曆. */
  calendarDetail: string | null
  /** What the calendar shows: a day in the period, and whether that's a day, a week, or a month. */
  calendarDate: ISODate
  calendarView: CalendarViewName

  navigate(page: string, sub?: string | null): void
  setComposer(text: string): void
  openSession(id: string | null, composer?: string): void
  /** Sends a message in the open conversation, or starts one. */
  send(text: string, trigger?: Trigger): void
  /** Stops the agent in the open conversation. */
  stop(): void
  pickChoice(sessionId: string, index: number, option: string): void

  setDone(id: string, done: boolean): void
  accept(ids: string[]): void
  unaccept(ids: string[]): void
  /** Drops a draft todo the user doesn't want. */
  discard(id: string): void
  /**
   * Schedules a todo, or with null puts it back in the backlog. `minutes` also
   * changes how long it takes. `before` places it in the backlog: in front of
   * that todo, or with null at the end. The backlog's order is the order here.
   */
  moveTodo(id: string, slot: Slot | null, options?: { minutes?: number; before?: string | null }): void
  proposeSlots(): void
  /** The todos the agent just proposed times for, so the calendar can bring them in one by one. */
  lastProposal: { ids: string[]; at: number } | null
  confirmSlot(id: string): void
  addTodo(title: string, slot?: Slot, minutes?: number): void
  toggleSubtask(todoId: string, index: number): void
  /** 開始: the user is working on it now. Null stops. */
  setStarted(todoId: string, startedAt: number | null): void
  /** Puts a todo back as it was, for undo. */
  restoreTodo(todo: Todo): void

  /** How the user is doing, for a day the agent is reworking. */
  chooseEnergy(sessionId: string, index: number, energy: Energy): void
  applyRework(sessionId: string, index: number): void
  undoRework(sessionId: string, index: number): void
  saveMemoryPreview(sessionId: string, index: number): void

  /** Jots something down in 隨手記. */
  addNote(text: string, source: Note['source']): void
  editNote(id: string, text: string): void
  deleteNote(id: string): void
  /** Puts a deleted note back, for undo. */
  restoreNote(note: Note): void
  /**
   * Hands the unsorted notes to the agent: a short session in which it proposes
   * what each becomes. Nothing is created until the user accepts. Returns the
   * session, or null when there was nothing to sort.
   */
  flushNotes(): void
  /**
   * Accepts or turns down the agent's proposal for one note. Accepting creates
   * what it proposed; turning it down puts the note back in the list. For a note
   * the agent asked about, `as` is the user's answer.
   */
  decideNote(sessionId: string, index: number, noteId: string, accept: boolean, as?: NoteKind): void
  /** Takes a decision back: removes what accepting created, and the proposal waits again. */
  undoNoteDecision(sessionId: string, index: number, noteId: string): void
  /** Puts away a fully decided proposal on the 隨手記 page. It stays in the conversation. */
  closeNoteProposal(sessionId: string): void
  /** Proposals put away on the 隨手記 page, by session. Kept in this window's storage. */
  closedProposals: string[]

  setTodayDetail(id: string | null): void
  setCalendarDetail(id: string | null): void
  setCalendarDate(date: ISODate): void
  setCalendarView(view: CalendarViewName): void

  deleteMemory(id: string): void
  restoreMemory(memory: Memory, index: number): void
  toggleSkill(id: string): void
  /** Reads the skills again; the agent may have changed them. */
  loadSkills(): void
  /** Accepts or turns down a change the agent proposed to a skill. */
  decideSkillProposal(id: string, accept: boolean): void
  /** Accepts or turns down the agent's rewrite of a goal's failing rule. */
  decideRuleProposal(goalId: string, accept: boolean): void
  connect(id: string): void
  undo(historyId: string): void
  decideExperiment(id: string, decision: NonNullable<Experiment['decision']>): void
  setTheme(theme: ThemeSource): void
  setLanguage(language: LanguageSetting): void
}

const THEME_KEY = 'jezo.theme'

function storedTheme(): ThemeSource {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Storage can be unavailable; the default is fine.
  }
  return 'system'
}


const mapTodo = (todos: Todo[], id: string, f: (t: Todo) => Todo) => todos.map((t) => (t.id === id ? f(t) : t))

const clock = (at = new Date()): Now => ({ date: localDate(at), hour: at.getHours() + at.getMinutes() / 60 })

// ─── The workspace ───

const workspace = () => window.jezo.workspace

/** A write the main process refused. The file on disk wins, so the list is read again. */
function failed(error: unknown) {
  console.error(error)
  toast.error(i18n.t('workspace.writeFailed'))
  void loadWorkspace()
}

/** The backlog's order is the todos' ranks; todos without one go last, oldest first. */
const byRank = (a: Todo, b: Todo) =>
  a.rank && b.rank ? (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) : a.rank ? -1 : b.rank ? 1 : a.id < b.id ? -1 : 1

const newestMemory = (a: Memory, b: Memory) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)

const byCreated = (a: Note, b: Note) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`) || a.id.localeCompare(b.id)

/** Replaces the entities that changed, leaving the others, which may have writes of their own on the way. */
function upsert<T extends { id: string }>(list: T[], changed: T[], removed: string[], order: (a: T, b: T) => number) {
  const next = new Map(list.map((x) => [x.id, x]))
  for (const id of removed) next.delete(id)
  for (const x of changed) next.set(x.id, x)
  return [...next.values()].sort(order)
}

/** Goal files, kept as they are: a goal is counted again whenever its todos change. */
let goalItems = new Map<string, Item>()

const deriveGoals = (todos: Todo[], today: ISODate) => [...goalItems.values()].map((item) => toGoal(item, todos, today)).sort((a, b) => a.id.localeCompare(b.id))

function applyChanges({ changed, removed }: ItemChanges) {
  for (const id of removed) goalItems.delete(id)
  for (const item of changed) if (item.kind === 'goal' && !item.id.startsWith('?')) goalItems.set(item.id, item)
  useStore.setState((s) => {
    const todos = upsert(s.todos, entities(changed, 'todo', toTodo), removed, byRank)
    const memories = upsert(s.memories, entities(changed, 'memory', toMemory).filter((m): m is Memory => m !== null), removed, newestMemory)
    // A memory that was just replaced comes back as superseded; it leaves the list.
    const replaced = changed.filter((i) => i.kind === 'memory' && i.data.status === 'superseded').map((i) => i.id)
    return {
      todos,
      notes: upsert(s.notes, entities(changed, 'note', toNote), removed, byCreated),
      goals: deriveGoals(todos, s.now.date),
      memories: memories.filter((m) => !replaced.includes(m.id)),
    }
  })
}

const newestFirst = (a: Session, b: Session) => (a.date + a.time < b.date + b.time ? 1 : -1)

function applySession(view: Session) {
  useStore.setState((s) => ({ sessions: [view, ...s.sessions.filter((x) => x.id !== view.id)].sort(newestFirst) }))
}

async function loadHistory() {
  useStore.setState({ history: await window.jezo.history.list() })
}

const CLOSED_KEY = 'jezo.closedProposals'

function storedClosed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]')
  } catch {
    return []
  }
}

async function loadWorkspace() {
  const items: Item[] = await workspace().list()
  goalItems = new Map(items.filter((i) => i.kind === 'goal' && !i.id.startsWith('?')).map((i) => [i.id, i]))
  const todos = entities(items, 'todo', toTodo).sort(byRank)
  useStore.setState((s) => ({
    todos,
    notes: entities(items, 'note', toNote).sort(byCreated),
    goals: deriveGoals(todos, s.now.date),
    memories: entities(items, 'memory', toMemory)
      .filter((m): m is Memory => m !== null)
      .sort(newestMemory),
  }))
}

/** Reads the workspace and follows its changes. Called once, when the window opens. */
export async function connectWorkspace() {
  workspace().onChange(applyChanges)
  window.jezo.agent.onChange(applySession)
  window.jezo.history.onChange(() => void loadHistory())
  await Promise.all([
    loadWorkspace(),
    loadHistory(),
    window.jezo.agent.list().then((sessions) => useStore.setState({ sessions })),
    useStore.getState().loadSkills(),
  ])
  // The clock moves on; the day changes at midnight.
  window.setInterval(() => useStore.setState({ now: clock() }), 30_000)
}

/** Changes a todo right away and writes it. */
function writeTodo(id: string, change: Partial<Todo>) {
  useStore.setState((s) => {
    const todos = mapTodo(s.todos, id, (t) => ({ ...t, ...change })).sort(byRank)
    return { todos, goals: deriveGoals(todos, s.now.date) }
  })
  workspace().update(id, todoFields(change)).catch(failed)
}

function writeNote(id: string, fields: Fields, body?: string) {
  workspace().update(id, fields, body === undefined ? {} : { body }).catch(failed)
}

/** A rank that puts a todo in front of `before`, or last. */
function rankBefore(todos: Todo[], id: string, before: string | null) {
  const rest = todos.filter((t) => t.id !== id)
  const at = before === null ? rest.length : rest.findIndex((t) => t.id === before)
  if (at < 0) return undefined
  const prev = rest[at - 1]?.rank ?? null
  const next = rest[at]?.rank ?? null
  // Todos written without a rank sort last; a rank can't go between them, so it goes after the ranked ones.
  if (prev === null && at > 0) return generateKeyBetween(lastRank(rest), null)
  return generateKeyBetween(prev, next !== null && (prev === null || prev < next) ? next : null)
}

const lastRank = (todos: Todo[]) => todos.reduce<string | null>((max, t) => (t.rank && (!max || t.rank > max) ? t.rank : max), null)

/** All the fields of a todo, to write it back as it was. */
const allTodoFields = (todo: Todo): Fields => ({
  title: todo.title,
  state: todo.state,
  ...todoFields({ goalId: todo.goalId, cue: todo.cue, estimateMinutes: todo.estimateMinutes, slot: todo.slot, subtasks: todo.subtasks, why: todo.why, startedAt: todo.startedAt, rank: todo.rank }),
})

/** Changes one message of one session. */
function mapMessage(sessions: Session[], sessionId: string, index: number, f: (m: Message) => Message) {
  return sessions.map((s) => (s.id === sessionId ? { ...s, messages: s.messages.map((m, i) => (i === index ? f(m) : m)) } : s))
}

export const useStore = create<State>()((set, get) => ({
  now: clock(),
  goals: [],
  todos: [],
  events: mock.events,
  sessions: [],
  memories: [],
  notes: [],
  skills: [],
  experiments: mock.experiments,
  history: [],
  connections: mock.connections,
  settings: { theme: storedTheme(), language: storedLanguage() },

  nav: { page: 'chat', sub: null },
  sessionId: null,
  closedProposals: storedClosed(),
  composer: '',
  todayDetail: null,
  calendarDetail: null,
  calendarDate: localDate(new Date()),
  calendarView: 'week',

  navigate: (page, sub = null) => set({ nav: { page, sub } }),
  setComposer: (composer) => set({ composer }),
  openSession: (sessionId, composer = '') => set({ sessionId, composer, nav: { page: 'chat', sub: null } }),

  send: (text, trigger = 'user') => {
    const { sessionId, sessions } = get()
    const id = sessionId && sessions.some((s) => s.id === sessionId) ? sessionId : null
    set({ composer: '' })
    window.jezo.agent.send(id, text, trigger).then((opened) => {
      if (!id) set({ sessionId: opened })
    }, failed)
  },
  stop: () => {
    const { sessionId } = get()
    if (sessionId) void window.jezo.agent.abort(sessionId)
  },

  pickChoice: (sessionId, index, option) => {
    const message = get().sessions.find((x) => x.id === sessionId)?.messages[index]
    if (message?.kind !== 'choices' || message.picked) return
    window.jezo.agent.send(sessionId, option).catch(failed)
  },

  // A done todo keeps when it was started, so how long it took can be counted against its estimate.
  setDone: (id, done) => {
    writeTodo(id, done ? { state: 'done', completedAt: Date.now() } : { state: 'open', startedAt: undefined, completedAt: undefined })
  },
  accept: (ids) => {
    for (const t of get().todos) {
      if (ids.includes(t.id) && t.state === 'draft') writeTodo(t.id, { state: 'open', slot: t.slot && { ...t.slot, proposed: false } })
    }
  },
  unaccept: (ids) => {
    for (const t of get().todos) if (ids.includes(t.id) && t.state === 'open') writeTodo(t.id, { state: 'draft' })
  },
  discard: (id) => {
    const todo = get().todos.find((t) => t.id === id)
    if (todo?.state !== 'draft') return
    set((s) => ({
      todos: s.todos.filter((t) => t.id !== id),
      todayDetail: s.todayDetail === id ? null : s.todayDetail,
      calendarDetail: s.calendarDetail === id ? null : s.calendarDetail,
    }))
    workspace().remove(id).catch(failed)
  },
  // Moving a todo yourself settles it: the time is yours, and a draft becomes a real todo.
  moveTodo: (id, slot, { minutes, before } = {}) => {
    const todo = get().todos.find((t) => t.id === id)
    if (!todo) return
    const rank = before === undefined ? undefined : rankBefore(get().todos, id, before)
    writeTodo(id, {
      slot,
      ...(minutes !== undefined && { estimateMinutes: minutes }),
      ...(todo.state === 'draft' && { state: 'open' }),
      ...(rank && { rank }),
    })
    if (!slot) set((s) => ({ calendarDetail: s.calendarDetail === id ? null : s.calendarDetail }))
  },
  proposeSlots: () => {
    const ids = get().todos.filter((t) => !t.slot && mock.suggestedSlots[t.id]).map((t) => t.id)
    for (const id of ids) {
      const suggestion = mock.suggestedSlots[id]
      writeTodo(id, { slot: { date: suggestion.date, start: suggestion.start, proposed: true }, why: suggestion.why })
    }
    set({ lastProposal: { ids, at: Date.now() } })
  },
  lastProposal: null,
  confirmSlot: (id) => {
    const todo = get().todos.find((t) => t.id === id)
    if (todo?.slot) writeTodo(id, { slot: { ...todo.slot, proposed: false } })
  },
  addTodo: (title, slot, minutes = 30) => {
    const fields = { title, state: 'open', ...todoFields({ estimateMinutes: minutes, slot: slot ?? null, rank: generateKeyBetween(lastRank(get().todos), null) }) }
    workspace().create('todo', { ...fields, created: stamp() }).catch(failed)
  },

  toggleSubtask: (todoId, index) => {
    const todo = get().todos.find((t) => t.id === todoId)
    if (!todo?.subtasks) return
    writeTodo(todoId, { subtasks: todo.subtasks.map((sub, i) => (i === index ? { ...sub, done: !sub.done } : sub)) })
  },
  setStarted: (todoId, startedAt) => writeTodo(todoId, { startedAt: startedAt ?? undefined }),
  restoreTodo: (todo) => {
    if (get().todos.some((t) => t.id === todo.id)) writeTodo(todo.id, todo)
    else workspace().create('todo', { id: todo.id, ...allTodoFields(todo) }).catch(failed)
  },

  chooseEnergy: (sessionId, index, energy) =>
    set((s) => ({ sessions: mapMessage(s.sessions, sessionId, index, (m) => (m.kind === 'rework' ? { ...m, energy } : m)) })),
  applyRework: (sessionId, index) => {
    const s = get()
    const message = s.sessions.find((x) => x.id === sessionId)?.messages[index]
    if (message?.kind !== 'rework' || !message.energy) return
    const plan = mock.reworkPlans[message.energy]
    const changes = new Map([...plan.keep, ...plan.move, ...plan.drop].map((item) => [item.todoId, item.change]))
    for (const [id, change] of changes) if (s.todos.some((t) => t.id === id)) writeTodo(id, change)
    set({
      sessions: mapMessage(s.sessions, sessionId, index, (m) => ({
        ...m,
        applied: true,
        before: s.todos.filter((t) => changes.has(t.id)),
      })),
    })
  },
  undoRework: (sessionId, index) => {
    const s = get()
    const message = s.sessions.find((x) => x.id === sessionId)?.messages[index]
    if (message?.kind !== 'rework' || !message.before) return
    for (const todo of message.before) writeTodo(todo.id, todo)
    set({
      sessions: mapMessage(s.sessions, sessionId, index, (m) => ({ ...m, applied: false, before: undefined })),
    })
  },

  saveMemoryPreview: (sessionId, index) =>
    set((s) => ({ sessions: mapMessage(s.sessions, sessionId, index, (m) => (m.kind === 'memory-preview' ? { ...m, saved: true } : m)) })),

  setTodayDetail: (todayDetail) => set({ todayDetail }),
  setCalendarDetail: (calendarDetail) => set({ calendarDetail }),
  setCalendarDate: (calendarDate) => set({ calendarDate }),
  setCalendarView: (calendarView) => set({ calendarView }),

  addNote: (text, source) => {
    workspace().create('note', { created: stamp(), source, state: 'new' }, `${text}\n`).catch(failed)
  },
  editNote: (id, text) => {
    set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, text } : n)) }))
    writeNote(id, {}, `${text}\n`)
  },
  deleteNote: (id) => {
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }))
    workspace().remove(id).catch(failed)
  },
  restoreNote: (note) => {
    const created = `${note.date}T${String(Math.floor(note.time)).padStart(2, '0')}:${String(Math.round((note.time % 1) * 60)).padStart(2, '0')}`
    const fields = { id: note.id, created, source: note.source, state: note.state, proposal: note.proposal, became: note.became }
    workspace().create('note', fields, `${note.text}\n`).catch(failed)
  },
  flushNotes: () => {
    if (!get().notes.some((n) => n.state === 'new')) return
    window.jezo.agent.start('notes').catch(failed)
  },
  decideNote: (sessionId, _index, noteId, accept, as) => {
    const note = get().notes.find((n) => n.id === noteId)
    const proposal = note?.proposal
    if (!note || !proposal || proposal.session !== sessionId || proposal.decision) return
    const kind = as ?? (proposal.as === 'ask' ? undefined : proposal.as)
    if (accept && !kind) return
    // The user's own answer to a question keeps their words.
    const title = as ? note.text : proposal.title
    const decided: NoteProposal = { ...proposal, decision: accept ? 'accepted' : 'rejected', ...(accept && as && { as, title, question: proposal.title }) }
    const settle = (became: NoteOutcome | null) => {
      set((s) => ({ notes: s.notes.map((n) => (n.id === noteId ? { ...n, state: accept ? 'sorted' : 'new', proposal: decided, became: became ?? undefined } : n)) }))
      writeNote(noteId, { state: accept ? 'sorted' : 'new', proposal: decided, became })
    }
    if (!accept) return settle(null)
    if (kind === 'todo') {
      const fields = { title, state: 'open', estimate: 30, why: i18n.t('notes:fromNote', { text: note.text }), rank: generateKeyBetween(lastRank(get().todos), null), created: stamp() }
      workspace()
        .create('todo', fields)
        .then((todo) => settle({ kind: 'todo', ref: todo.id }), failed)
    } else if (kind === 'memory') {
      // The note is the user's own words, and it's the evidence.
      window.jezo.memory
        .remember({ text: title, epistemic: 'stated', evidence: [`notes/items/${noteId}.md`] })
        .then((m) => settle({ kind: 'memory', ref: m.id }), failed)
    } else {
      settle(kind === 'goal' ? { kind: 'goal', title } : { kind: 'keep' })
    }
  },
  undoNoteDecision: (_sessionId, _index, noteId) => {
    const note = get().notes.find((n) => n.id === noteId)
    if (!note?.proposal) return
    const { became, proposal } = note
    if (became?.kind === 'todo' && became.ref) workspace().remove(became.ref).catch(failed)
    // Taking back a note just sorted into memory isn't deleting a memory: its words may be saved again later.
    if (became?.kind === 'memory' && became.ref) window.jezo.memory.discard(became.ref).catch(failed)
    // An answered question goes back to being a question.
    const { decision: _, question, ...rest } = proposal
    const reopened: NoteProposal = question ? { as: 'ask', title: question, session: proposal.session } : rest
    set((s) => ({ notes: s.notes.map((n) => (n.id === noteId ? { ...n, state: 'sorting', proposal: reopened, became: undefined } : n)) }))
    writeNote(noteId, { state: 'sorting', proposal: reopened, became: null })
  },
  closeNoteProposal: (sessionId) => {
    const closedProposals = [...get().closedProposals, sessionId].slice(-50)
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(closedProposals))
    } catch {
      // Forgetting it only means the card shows again.
    }
    set({ closedProposals })
  },
  deleteMemory: (id) => {
    set((s) => ({ memories: s.memories.filter((m) => m.id !== id) }))
    window.jezo.memory.forget(id).catch(failed)
  },
  restoreMemory: (memory) => {
    if (memory.record) window.jezo.memory.restore(memory.record).catch(failed)
  },
  toggleSkill: (id) => {
    const skill = get().skills.find((k) => k.id === id)
    if (!skill) return
    set((s) => ({ skills: s.skills.map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k)) }))
    window.jezo.skills.setEnabled(id, !skill.enabled).then((skills) => set({ skills }), failed)
  },
  loadSkills: () => {
    window.jezo.skills.list().then((skills) => set({ skills }), failed)
  },
  decideSkillProposal: (id, accept) =>
    set((s) => ({
      skills: s.skills.map((k) =>
        k.id === id && k.proposal
          ? { ...k, instructions: accept ? k.proposal.after : k.instructions, proposal: undefined, reviewed: accept || k.reviewed }
          : k,
      ),
    })),
  // Accepting rewrites the rule; either way the proposal is gone. How often the new rule works is counted from here.
  decideRuleProposal: (goalId, accept) => {
    const goal = get().goals.find((g) => g.id === goalId)
    const p = goal?.ruleProposal
    if (!goal || !p) return
    const rules = goal.rules.map((r, i) => (accept && i === p.ruleIndex ? { cue: p.cue, action: p.action } : { cue: r.cue, action: r.action }))
    workspace().update(goalId, { rules, rule_proposal: null }).catch(failed)
  },
  connect: (id) =>
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, connected: true, detail: undefined } : c)) })),
  undo: (id) => {
    window.jezo.history.undo(id).then(({ kept }) => {
      if (kept.length) toast(i18n.t('more:history.kept', { count: kept.length }))
    }, failed)
  },
  decideExperiment: (id, decision) =>
    set((s) => ({ experiments: s.experiments.map((x) => (x.id === id ? { ...x, decision } : x)) })),
  setTheme: (theme) => {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // Not remembering the theme is acceptable.
    }
    set((s) => ({ settings: { ...s.settings, theme } }))
  },
  setLanguage: (language) => {
    applyLanguage(language)
    set((s) => ({ settings: { ...s.settings, language } }))
  },
}))

export const goalById = (goals: Goal[], id: string | null) => goals.find((g) => g.id === id)
