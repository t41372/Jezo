// The renderer's state. For now it holds mock data; when the backend exists,
// the entities come from the index over IPC and the actions become writes.

import { create } from 'zustand'
import type { ThemeSource } from '../../../shared/bridge'
import * as mock from './mock'
import { applyLanguage, storedLanguage, type LanguageSetting } from '@/i18n'
import { applyChoice, replyTo, sortNote, sortSteps, sortSummary } from './mock-agent'
import type { CalendarEvent, CalendarViewName, Connection, Energy, Experiment, Goal, HistoryEntry, ISODate, Memory, Message, Note, NoteKind, NoteOutcome, Session, Skill, SortItem, Todo, Trigger } from './types'

export interface Nav {
  page: string
  /** A view inside the page, like one goal or one section of 更多. */
  sub: string | null
}

type Slot = NonNullable<Todo['slot']>

interface State {
  now: typeof mock.NOW
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
  settings: { theme: ThemeSource; language: LanguageSetting; model: 'local' | 'cloud' }

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
  /** Puts a deleted note back where it was, for undo. */
  restoreNote(note: Note, index: number): void
  /**
   * Hands the unsorted notes to the agent: a short session in which it proposes
   * what each becomes. Nothing is created until the user accepts. Returns the
   * session, or null when there was nothing to sort.
   */
  flushNotes(): string | null
  /**
   * Accepts or turns down the agent's proposal for one note. Accepting creates
   * what it proposed; turning it down puts the note back in the list. For a note
   * the agent asked about, `as` is the user's answer.
   */
  decideNote(sessionId: string, index: number, noteId: string, accept: boolean, as?: NoteKind): void
  /** Takes a decision back: removes what accepting created, and the proposal waits again. */
  undoNoteDecision(sessionId: string, index: number, noteId: string): void
  /** Puts away a fully decided proposal on the 隨手記 page. It stays in the conversation. */
  closeNoteProposal(sessionId: string, index: number): void

  setTodayDetail(id: string | null): void
  setCalendarDetail(id: string | null): void
  setCalendarDate(date: ISODate): void
  setCalendarView(view: CalendarViewName): void

  deleteMemory(id: string): void
  restoreMemory(memory: Memory, index: number): void
  toggleSkill(id: string): void
  /** Accepts or turns down a change the agent proposed to a skill. */
  decideSkillProposal(id: string, accept: boolean): void
  /** Accepts or turns down the agent's rewrite of a goal's failing rule. */
  decideRuleProposal(goalId: string, accept: boolean): void
  connect(id: string): void
  undo(historyId: string): void
  decideExperiment(id: string, decision: NonNullable<Experiment['decision']>): void
  setTheme(theme: ThemeSource): void
  setLanguage(language: LanguageSetting): void
  setModel(model: 'local' | 'cloud'): void
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

const appendTo = (sessions: Session[], id: string, messages: Message[]) =>
  sessions.map((s) => (s.id === id ? { ...s, messages: [...s.messages, ...messages] } : s))

/** The mock agent answers after a beat, so the conversation reads like one. */
function replyLater(sessionId: string, messages: Message[]) {
  window.setTimeout(() => useStore.setState((s) => ({ sessions: appendTo(s.sessions, sessionId, messages) })), 600)
}

const mapTodo = (todos: Todo[], id: string, f: (t: Todo) => Todo) => todos.map((t) => (t.id === id ? f(t) : t))

/** Moves one todo in front of another, or with null to the end. */
function placeBefore(todos: Todo[], id: string, before: string | null) {
  const todo = todos.find((t) => t.id === id)
  if (!todo || before === id) return todos
  const rest = todos.filter((t) => t.id !== id)
  const at = before === null ? rest.length : rest.findIndex((t) => t.id === before)
  return at < 0 ? todos : [...rest.slice(0, at), todo, ...rest.slice(at)]
}

/** Changes one message of one session. */
function mapMessage(sessions: Session[], sessionId: string, index: number, f: (m: Message) => Message) {
  return sessions.map((s) => (s.id === sessionId ? { ...s, messages: s.messages.map((m, i) => (i === index ? f(m) : m)) } : s))
}

export const useStore = create<State>()((set, get) => ({
  now: mock.NOW,
  goals: mock.goals,
  todos: mock.todos,
  events: mock.events,
  sessions: mock.sessions,
  memories: mock.memories,
  notes: mock.notes,
  skills: mock.skills,
  experiments: mock.experiments,
  history: mock.history,
  connections: mock.connections,
  settings: { theme: storedTheme(), language: storedLanguage(), model: 'local' },

  nav: { page: 'chat', sub: null },
  sessionId: 's1',
  composer: '',
  todayDetail: null,
  calendarDetail: null,
  calendarDate: mock.NOW.date,
  calendarView: 'week',

  navigate: (page, sub = null) => set({ nav: { page, sub } }),
  setComposer: (composer) => set({ composer }),
  openSession: (sessionId, composer = '') => set({ sessionId, composer, nav: { page: 'chat', sub: null } }),

  send: (text, trigger = 'user') => {
    const { sessionId, sessions, now } = get()
    const user: Message = { kind: 'user', text }
    let id = sessionId
    if (id && sessions.some((s) => s.id === id)) {
      set({ composer: '', sessions: appendTo(sessions, id, [user]) })
    } else {
      const session: Session = {
        id: `s-${Date.now()}`,
        title: text.length > 14 ? `${text.slice(0, 14)}…` : text,
        trigger,
        date: now.date,
        time: now.hour,
        messages: [user],
      }
      id = session.id
      set({ composer: '', sessionId: id, sessions: [session, ...sessions] })
    }
    replyLater(id, replyTo(text))
  },

  pickChoice: (sessionId, index, option) => {
    const s = get()
    const session = s.sessions.find((x) => x.id === sessionId)
    const msg = session?.messages[index]
    if (!session || msg?.kind !== 'choices') return

    const todos = applyChoice(option, s.todos, s.now.date)
    const messages: Message[] = session.messages.map((m, i) => (i === index ? { ...m, picked: option } : m))
    set({
      todos,
      sessions: s.sessions.map((x) => (x.id === sessionId ? { ...x, messages: [...messages, { kind: 'user', text: option }] } : x)),
    })
    replyLater(sessionId, replyTo(option))
  },

  setDone: (id, done) =>
    set((s) => ({ todos: mapTodo(s.todos, id, (t) => ({ ...t, state: done ? 'done' : 'open', startedAt: undefined })) })),
  accept: (ids) =>
    set((s) => ({
      todos: s.todos.map((t) =>
        ids.includes(t.id) && t.state === 'draft' ? { ...t, state: 'open', slot: t.slot && { ...t.slot, proposed: false } } : t,
      ),
    })),
  unaccept: (ids) =>
    set((s) => ({ todos: s.todos.map((t) => (ids.includes(t.id) && t.state === 'open' ? { ...t, state: 'draft' } : t)) })),
  discard: (id) =>
    set((s) => ({
      todos: s.todos.filter((t) => !(t.id === id && t.state === 'draft')),
      todayDetail: s.todayDetail === id ? null : s.todayDetail,
      calendarDetail: s.calendarDetail === id ? null : s.calendarDetail,
    })),
  // Moving a todo yourself settles it: the time is yours, and a draft becomes a real todo.
  moveTodo: (id, slot, { minutes, before } = {}) =>
    set((s) => {
      const todos = mapTodo(s.todos, id, (t) => ({
        ...t,
        slot,
        estimateMinutes: minutes ?? t.estimateMinutes,
        state: t.state === 'draft' ? 'open' : t.state,
      }))
      return { todos: before === undefined ? todos : placeBefore(todos, id, before), calendarDetail: slot ? s.calendarDetail : null }
    }),
  proposeSlots: () =>
    set((s) => {
      const ids = s.todos.filter((t) => !t.slot && mock.suggestedSlots[t.id]).map((t) => t.id)
      return {
        todos: s.todos.map((t) => {
          const suggestion = ids.includes(t.id) ? mock.suggestedSlots[t.id] : undefined
          return suggestion ? { ...t, slot: { date: suggestion.date, start: suggestion.start, proposed: true }, why: suggestion.why } : t
        }),
        lastProposal: { ids, at: Date.now() },
      }
    }),
  lastProposal: null,
  confirmSlot: (id) => set((s) => ({ todos: mapTodo(s.todos, id, (t) => ({ ...t, slot: t.slot && { ...t.slot, proposed: false } })) })),
  addTodo: (title, slot, minutes = 30) =>
    set((s) => ({
      todos: [...s.todos, { id: `n-${Date.now()}`, title, goalId: null, state: 'open', estimateMinutes: minutes, slot: slot ?? null }],
    })),

  toggleSubtask: (todoId, index) =>
    set((s) => ({
      todos: mapTodo(s.todos, todoId, (t) => ({
        ...t,
        subtasks: t.subtasks?.map((sub, i) => (i === index ? { ...sub, done: !sub.done } : sub)),
      })),
    })),
  setStarted: (todoId, startedAt) =>
    set((s) => ({ todos: mapTodo(s.todos, todoId, (t) => ({ ...t, startedAt: startedAt ?? undefined })) })),
  restoreTodo: (todo) =>
    set((s) => ({ todos: s.todos.some((t) => t.id === todo.id) ? mapTodo(s.todos, todo.id, () => todo) : [...s.todos, todo] })),

  chooseEnergy: (sessionId, index, energy) =>
    set((s) => ({ sessions: mapMessage(s.sessions, sessionId, index, (m) => (m.kind === 'rework' ? { ...m, energy } : m)) })),
  applyRework: (sessionId, index) => {
    const s = get()
    const message = s.sessions.find((x) => x.id === sessionId)?.messages[index]
    if (message?.kind !== 'rework' || !message.energy) return
    const plan = mock.reworkPlans[message.energy]
    const changes = new Map([...plan.keep, ...plan.move, ...plan.drop].map((item) => [item.todoId, item.change]))
    set({
      todos: s.todos.map((t) => (changes.has(t.id) ? { ...t, ...changes.get(t.id) } : t)),
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
    const before = new Map(message.before.map((t) => [t.id, t]))
    set({
      todos: s.todos.map((t) => before.get(t.id) ?? t),
      sessions: mapMessage(s.sessions, sessionId, index, (m) => ({ ...m, applied: false, before: undefined })),
    })
  },

  saveMemoryPreview: (sessionId, index) =>
    set((s) => ({ sessions: mapMessage(s.sessions, sessionId, index, (m) => (m.kind === 'memory-preview' ? { ...m, saved: true } : m)) })),

  setTodayDetail: (todayDetail) => set({ todayDetail }),
  setCalendarDetail: (calendarDetail) => set({ calendarDetail }),
  setCalendarDate: (calendarDate) => set({ calendarDate }),
  setCalendarView: (calendarView) => set({ calendarView }),

  addNote: (text, source) =>
    set((s) => ({
      notes: [...s.notes, { id: `n-${Date.now()}`, text, date: s.now.date, time: s.now.hour, source, state: 'new' }],
    })),
  editNote: (id, text) => set((s) => ({ notes: s.notes.map((n) => (n.id === id ? { ...n, text } : n)) })),
  deleteNote: (id) => set((s) => ({ notes: s.notes.filter((n) => n.id !== id) })),
  restoreNote: (note, index) => set((s) => ({ notes: [...s.notes.slice(0, index), note, ...s.notes.slice(index)] })),
  flushNotes: () => {
    const s = get()
    const batch = s.notes.filter((n) => n.state === 'new')
    if (!batch.length) return null
    const items: SortItem[] = batch.map((n) => ({ noteId: n.id, ...sortNote(n.text) }))
    const session: Session = {
      id: `s-notes-${Date.now()}`,
      trigger: 'notes',
      date: s.now.date,
      time: s.now.hour,
      messages: [
        { kind: 'steps', summary: sortSteps(batch.length), lines: [`讀 notes/items/*.md · ${batch.length} 則`, '讀 notes/skills/整理隨手記/SKILL.md'] },
        { kind: 'agent', text: sortSummary(items) },
        { kind: 'plugin', plugin: 'notes', type: 'sort', data: { items } },
      ],
    }
    set({
      sessions: [session, ...s.sessions],
      notes: s.notes.map((n) => (batch.includes(n) ? { ...n, state: 'sorting' } : n)),
    })
    return session.id
  },
  decideNote: (sessionId, index, noteId, accept, as) =>
    set((s) => {
      const message = s.sessions.find((x) => x.id === sessionId)?.messages[index]
      const note = s.notes.find((n) => n.id === noteId)
      if (message?.kind !== 'plugin' || !note) return {}
      const items = (message.data as { items: SortItem[] }).items
      const item = items.find((i) => i.noteId === noteId)
      const kind = as ?? (item?.as === 'ask' ? undefined : item?.as)
      if (!item || item.decision || (accept && !kind)) return {}

      // What the note becomes. The user's own answer to a question keeps their words.
      const title = as ? note.text : item.title
      const stamp = Date.now()
      let { todos, memories } = s
      let became: NoteOutcome | undefined
      if (accept && kind === 'todo') {
        const todoId = `t-${stamp}`
        todos = [{ id: todoId, title, goalId: null, state: 'open', estimateMinutes: 30, slot: null, why: `從隨手記：「${note.text}」` }, ...todos]
        became = { kind: 'todo', todoId }
      } else if (accept && kind === 'memory') {
        const memoryId = `m-${stamp}`
        memories = [{ id: memoryId, text: title, kind: 'stated', date: s.now.date, via: 'notes' }, ...memories]
        became = { kind: 'memory', memoryId }
      } else if (accept && kind === 'goal') {
        became = { kind: 'goal', title }
      } else if (accept) {
        became = { kind: 'keep' }
      }
      const decided: SortItem = { ...item, decision: accept ? 'accepted' : 'rejected', ...(accept && as ? { as, title, question: item.title } : {}) }
      return {
        todos,
        memories,
        notes: s.notes.map((n) => (n.id !== noteId ? n : accept ? { ...n, state: 'sorted', became } : { ...n, state: 'new', became: undefined })),
        sessions: mapMessage(s.sessions, sessionId, index, () => ({ ...message, data: { items: items.map((i) => (i.noteId === noteId ? decided : i)) } })),
      }
    }),
  undoNoteDecision: (sessionId, index, noteId) =>
    set((s) => {
      const message = s.sessions.find((x) => x.id === sessionId)?.messages[index]
      const note = s.notes.find((n) => n.id === noteId)
      if (message?.kind !== 'plugin' || !note) return {}
      const items = (message.data as { items: SortItem[] }).items
      const became = note.became
      return {
        todos: became?.kind === 'todo' ? s.todos.filter((t) => t.id !== became.todoId) : s.todos,
        memories: became?.kind === 'memory' ? s.memories.filter((m) => m.id !== became.memoryId) : s.memories,
        notes: s.notes.map((n) => (n.id === noteId ? { ...n, state: 'sorting', became: undefined } : n)),
        sessions: mapMessage(s.sessions, sessionId, index, () => ({
          ...message,
          // An answered question goes back to being a question.
          data: {
            items: items.map((i) =>
              i.noteId !== noteId ? i : i.question ? { noteId, as: 'ask', title: i.question } : { ...i, decision: undefined },
            ),
          },
        })),
      }
    }),
  closeNoteProposal: (sessionId, index) =>
    set((s) => ({
      sessions: mapMessage(s.sessions, sessionId, index, (m) => (m.kind === 'plugin' ? { ...m, data: { ...(m.data as object), closed: true } } : m)),
    })),
  deleteMemory: (id) => set((s) => ({ memories: s.memories.filter((m) => m.id !== id) })),
  restoreMemory: (memory, index) =>
    set((s) => ({ memories: [...s.memories.slice(0, index), memory, ...s.memories.slice(index)] })),
  toggleSkill: (id) => set((s) => ({ skills: s.skills.map((k) => (k.id === id ? { ...k, enabled: !k.enabled } : k)) })),
  decideSkillProposal: (id, accept) =>
    set((s) => ({
      skills: s.skills.map((k) =>
        k.id === id && k.proposal
          ? { ...k, instructions: accept ? k.proposal.after : k.instructions, proposal: undefined, reviewed: accept || k.reviewed }
          : k,
      ),
    })),
  decideRuleProposal: (goalId, accept) =>
    set((s) => ({
      goals: s.goals.map((g) => {
        const p = g.ruleProposal
        if (g.id !== goalId || !p) return g
        const rules = accept ? g.rules.map((r, i) => (i === p.ruleIndex ? { cue: p.cue, action: p.action, hits: 0, tries: 0 } : r)) : g.rules
        return { ...g, rules, ruleProposal: undefined }
      }),
    })),
  connect: (id) =>
    set((s) => ({ connections: s.connections.map((c) => (c.id === id ? { ...c, connected: true, detail: undefined } : c)) })),
  undo: (id) => set((s) => ({ history: s.history.map((h) => (h.id === id ? { ...h, undone: true } : h)) })),
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
  setModel: (model) => set((s) => ({ settings: { ...s.settings, model } })),
}))

export const goalById = (goals: Goal[], id: string | null) => goals.find((g) => g.id === id)
