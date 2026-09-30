// Runs Jezo's agent: one pi session per conversation, saved as JSONL in the
// workspace's sessions/ (docs/design/backend.md, "Jezo's agent"). It turns what
// pi records into the messages the chat draws, and each run into an entry the
// user can undo.

import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  type ExtensionAPI,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { SessionMessage, SessionView, Step, Trigger } from '../../shared/session'
import { calendarExtension } from '../calendar/agent'
import type { Calendars } from '../calendar/calendars'
import { skillRoots } from '../workspace/skills'
import type { Workspace } from '../workspace/workspace'
import { type Memory, memoryExtension } from '../../../packages/pi-memory/src/index.ts'
import { acting } from './acting'
import type { Providers } from './providers'
import { CLAIMED_WITHOUT_CHANGE, CLAIMS_ACTION, digest, REQUESTS, SYSTEM_PROMPT } from './prompt'
import { type CardDetails, createTools, type RunContext, TOOL_NAMES } from './tools'
import type { UndoLog } from './undo'

interface Conversation {
  id: string
  trigger: Trigger
  /** The automation that started it, and its name, for sessions Jezo starts on its own. */
  automation?: { id: string; name: string }
  /** When it started, as a Date. */
  started: Date
  manager: SessionManager
  session: AgentSession | null
  context: RunContext
  /** The assistant message being streamed, not yet in the session's entries. */
  partial: unknown | null
  running: boolean
  /** Messages shown for this conversation that pi doesn't record, like "no model", and where they go. */
  extra: { at: number; message: SessionMessage }[]
}

const TRIGGER_ENTRY = 'jezo.session'
const CHECK_MESSAGE = 'jezo.check'
const REQUEST_MESSAGE = 'jezo.request'

export class AgentHost {
  private conversations = new Map<string, Conversation>()
  private listeners = new Set<(view: SessionView) => void>()
  private finishedListeners = new Set<(id: string, automation?: { id: string; name: string }) => void>()
  private timers = new Map<string, NodeJS.Timeout>()
  private settings = SettingsManager.inMemory(
    { compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 }, cacheWarming: 'off', enableInstallTelemetry: false },
    { projectTrusted: false },
  )

  constructor(
    private workspace: Workspace,
    private undo: UndoLog,
    private providers: Providers,
    private memory: Memory,
    private calendars: Calendars,
  ) {}

  private get dir() {
    return join(this.workspace.root, 'sessions')
  }

  /** Reads the conversations saved in the workspace. */
  async open() {
    await mkdir(this.dir, { recursive: true })
    for (const name of await readdir(this.dir)) {
      if (!name.endsWith('.jsonl')) continue
      try {
        const manager = SessionManager.open(join(this.dir, name), this.dir, this.workspace.root)
        const header = manager.getHeader()
        const trigger = manager.getEntries().find((e) => e.type === 'custom' && e.customType === TRIGGER_ENTRY) as
          | { data?: { trigger?: Trigger; automation?: { id: string; name: string } } }
          | undefined
        const id = manager.getSessionId()
        this.conversations.set(id, {
          id,
          trigger: trigger?.data?.trigger ?? 'user',
          automation: trigger?.data?.automation,
          started: new Date(header?.timestamp ?? (await stat(join(this.dir, name))).mtime),
          manager,
          session: null,
          context: this.contextFor(id),
          partial: null,
          running: false,
          extra: [],
        })
      } catch (error) {
        console.error(`Can't read the conversation ${name}:`, error)
      }
    }
  }

  onChange(listener: (view: SessionView) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Called when a run ends with an answer, with the automation that started it, if one did. */
  onFinished(listener: (id: string, automation?: { id: string; name: string }) => void) {
    this.finishedListeners.add(listener)
    return () => this.finishedListeners.delete(listener)
  }

  list(): SessionView[] {
    return [...this.conversations.values()].map((c) => this.view(c)).sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))
  }

  /** Sends the user's message, starting a conversation when `id` is null. Returns the conversation's id. */
  async send(id: string | null, text: string, trigger: Trigger = 'user') {
    const conversation = id ? this.conversations.get(id) : await this.create(trigger)
    if (!conversation) throw new Error(`There is no conversation ${id}.`)
    void this.run(conversation, (session) => session.prompt(text), text)
    return conversation.id
  }

  /** Starts a conversation Jezo asks for, like sorting notes. The request isn't shown to the user. */
  /** Runs an automation: its body is the request, and the session remembers which automation it was. */
  async startAutomation(automation: { id: string; name: string; trigger?: Trigger; request: string }) {
    const conversation = await this.create(automation.trigger ?? 'automation', { id: automation.id, name: automation.name })
    void this.run(conversation, (session) =>
      session.sendCustomMessage({ customType: REQUEST_MESSAGE, content: automation.request, display: false }, { triggerTurn: true }),
    )
    return conversation.id
  }

  /** When each automation last started a session. */
  lastRuns() {
    const runs = new Map<string, Date>()
    for (const c of this.conversations.values()) {
      if (c.automation && (!runs.has(c.automation.id) || runs.get(c.automation.id)! < c.started)) runs.set(c.automation.id, c.started)
    }
    return runs
  }

  async start(trigger: Trigger) {
    const request = REQUESTS[trigger]
    if (!request) throw new Error(`Nothing starts a session for ${trigger}.`)
    const conversation = await this.create(trigger)
    void this.run(conversation, (session) =>
      session.sendCustomMessage({ customType: REQUEST_MESSAGE, content: request, display: false }, { triggerTurn: true }),
    )
    return conversation.id
  }

  async abort(id: string) {
    await this.conversations.get(id)?.session?.abort()
  }

  private async create(trigger: Trigger, automation?: { id: string; name: string }): Promise<Conversation> {
    const manager = SessionManager.create(this.workspace.root, this.dir)
    manager.appendCustomEntry(TRIGGER_ENTRY, { trigger, ...(automation && { automation }) })
    const id = manager.getSessionId()
    const conversation: Conversation = {
      id,
      trigger,
      automation,
      started: new Date(),
      manager,
      session: null,
      context: this.contextFor(id),
      partial: null,
      running: false,
      extra: [],
    }
    this.conversations.set(id, conversation)
    return conversation
  }

  private contextFor(session: string): RunContext {
    const context: RunContext = { run: '', session, refused: () => this.undo.refused(context.run) }
    return context
  }

  /** One run: the agent works until it's done with this message. */
  private async run(c: Conversation, prompt: (session: AgentSession) => Promise<void>, userText?: string) {
    c.running = true
    this.emit(c)
    try {
      const session = await this.sessionFor(c)
      if (!session) {
        if (userText) this.note(c, { kind: 'user', text: userText })
        this.note(c, { kind: 'error', code: 'no-model' })
        return
      }
      c.context.run = `r-${Date.now().toString(36)}`
      this.undo.start({ id: c.context.run, session: c.id, trigger: c.trigger, at: localTime(new Date()) })
      // Everything this run does, however deep, is the agent's, acting on the user's words or on what Jezo asked.
      const source = c.trigger === 'user' || c.trigger === 'hotkey' ? 'user' : 'agent'
      const file = c.manager.getSessionFile()
      const sessionPath = file ? `sessions/${basename(file)}` : undefined
      await acting.run({ actor: { by: 'agent', run: c.context.run }, source, session: sessionPath }, async () => {
        await prompt(session)
        await session.waitForIdle()
      })
      await this.undo.finish(c.context.run, firstSentence(session.getLastAssistantText() ?? ''))
      for (const listener of this.finishedListeners) listener(c.id, c.automation)
    } catch (error) {
      console.error(error)
      this.note(c, { kind: 'error', text: String(error instanceof Error ? error.message : error) })
    } finally {
      c.running = false
      c.partial = null
      this.emit(c, true)
    }
  }

  /** Adds a message pi doesn't record, after what's there now. */
  private note(c: Conversation, message: SessionMessage) {
    c.extra.push({ at: this.view(c).messages.length, message })
  }

  private async sessionFor(c: Conversation): Promise<AgentSession | null> {
    // What the user starts uses the main model; what Jezo starts on its own uses the background one.
    const role = c.trigger === 'user' || c.trigger === 'hotkey' ? 'main' : 'background'
    let model = this.providers.model(role)
    // A local server that wasn't running a moment ago may be now.
    if (!model) {
      await this.providers.refreshServers()
      model = this.providers.model(role)
    }
    if (!model) return null
    if (c.session) {
      // The user may have picked another model, or another thinking level, since this conversation started.
      if (c.session.model?.provider !== model.provider || c.session.model?.id !== model.id) await c.session.setModel(model)
      c.session.setThinkingLevel(this.providers.thinking(model) as ThinkingLevel)
      return c.session
    }
    const runtime = this.providers.runtime

    const loader = new DefaultResourceLoader({
      cwd: this.workspace.root,
      agentDir: process.env.PI_CODING_AGENT_DIR!,
      settingsManager: this.settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: await this.skillDirs(),
      systemPromptOverride: () => SYSTEM_PROMPT,
      appendSystemPromptOverride: () => [digest(this.workspace.list())],
      extensionFactories: [
        { name: 'jezo-checks', factory: (pi) => this.checks(pi, c) },
        { name: 'jezo-memory', factory: memoryExtension(this.memory) },
        { name: 'jezo-calendar', factory: calendarExtension(this.calendars) },
      ],
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: this.workspace.root,
      agentDir: process.env.PI_CODING_AGENT_DIR!,
      modelRuntime: runtime,
      settingsManager: this.settings,
      resourceLoader: loader,
      model,
      thinkingLevel: this.providers.thinking(model) as ThinkingLevel,
      tools: TOOL_NAMES,
      customTools: createTools(
        this.workspace,
        () => c.context,
        (path) => this.blocked(path),
        async (scheduled, minutes) => (await this.calendars.overlapping(scheduled, minutes)).map((e) => `"${e.title}" ${e.start.slice(11)}–${e.end.slice(11)}`),
      ),
      sessionManager: c.manager,
    })
    await session.bindExtensions({ mode: 'json', onError: (e) => console.error('pi extension error', e) })
    session.subscribe((event) => this.onEvent(c, event))
    c.session = session
    return session
  }

  /**
   * Checks at the end of a run, before it settles (AGENTS.md, principle 7). A
   * reply that says something was done when no file changed goes back to the
   * agent once, to do it or to say it didn't.
   */
  private checks(pi: ExtensionAPI, c: Conversation) {
    let sentBack = ''
    pi.on('agent_before_settle', () => {
      const run = c.context.run
      const text = c.session?.getLastAssistantText() ?? ''
      if (sentBack === run || this.undo.changed(run) || !CLAIMS_ACTION.test(text)) return
      sentBack = run
      this.undo.claimedWithoutChange(run)
      return { entries: [{ type: 'custom_message', customType: CHECK_MESSAGE, content: CLAIMED_WITHOUT_CHANGE, display: false }], continue: true }
    })
  }

  /**
   * Conversations a deleted memory came from. The agent can't read them, so
   * what the user deleted doesn't come back from where it was first said.
   */
  private blocked(path: string) {
    return this.memory.deleted().some((f) => f.evidence?.includes(path))
  }

  /** Skills live in the workspace: its own skills/, and each plugin directory's. */
  private async skillDirs() {
    return (await skillRoots(this.workspace.root)).map((dir) => join(this.workspace.root, dir))
  }

  private onEvent(c: Conversation, event: AgentSessionEvent) {
    if (event.type === 'message_update' && event.message.role === 'assistant') c.partial = event.message
    if (event.type === 'message_end') c.partial = null
    if (event.type === 'message_update' || event.type === 'message_end' || event.type === 'tool_execution_end' || event.type === 'tool_execution_start') {
      this.emit(c)
    }
  }

  /** Tells the windows. Streaming text arrives often, so updates go out at most every 50 ms. */
  private emit(c: Conversation, now = false) {
    const send = () => {
      this.timers.delete(c.id)
      const view = this.view(c)
      for (const listener of this.listeners) listener(view)
    }
    if (now) {
      clearTimeout(this.timers.get(c.id))
      return send()
    }
    if (!this.timers.has(c.id)) this.timers.set(c.id, setTimeout(send, 50))
  }

  private view(c: Conversation): SessionView {
    const entries: unknown[] = [...c.manager.getEntries()]
    if (c.partial) entries.push({ type: 'message', message: c.partial })
    const messages = toMessages(entries, this.workspace.root)
    for (const { at, message } of c.extra) messages.splice(Math.min(at, messages.length), 0, message)
    if (c.partial) {
      const last = messages.at(-1)
      if (last?.kind === 'agent') last.streaming = true
    }
    const firstUser = messages.find((m) => m.kind === 'user') as { text: string } | undefined
    return {
      id: c.id,
      ...(c.trigger === 'user' || c.trigger === 'hotkey'
        ? firstUser && { title: title(firstUser.text) }
        : c.trigger === 'automation' && c.automation
          ? { title: c.automation.name }
          : {}),
      trigger: c.trigger,
      date: localTime(c.started).slice(0, 10),
      time: c.started.getHours() + c.started.getMinutes() / 60,
      messages,
      ...(c.running && { running: true }),
    }
  }
}

// ─── From pi's entries to the chat's messages ───

interface Block {
  type: string
  text?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
}

/**
 * What the user sees of a conversation: their messages, what the agent said,
 * what it did (folded into steps), and the cards its tools asked for. Requests
 * Jezo sent on the user's behalf and the agent's thinking aren't shown.
 */
export function toMessages(entries: unknown[], root: string): SessionMessage[] {
  const out: SessionMessage[] = []
  const steps = new Map<string, Step>()
  for (const entry of entries as { type: string; message?: Record<string, unknown> }[]) {
    if (entry.type !== 'message' || !entry.message) continue
    const m = entry.message
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : (m.content as Block[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      out.push({ kind: 'user', text })
    } else if (m.role === 'assistant') {
      for (const block of (m.content as Block[]) ?? []) {
        const last = out.at(-1)
        if (block.type === 'text' && block.text?.trim()) {
          if (last?.kind === 'agent') last.text += block.text
          else out.push({ kind: 'agent', text: block.text })
        } else if (block.type === 'toolCall' && block.id && block.name) {
          const step: Step = { tool: block.name, ...target(block.name, block.arguments ?? {}, root) }
          steps.set(block.id, step)
          if (last?.kind === 'steps') last.steps.push(step)
          else out.push({ kind: 'steps', steps: [step] })
        }
      }
      if (m.stopReason === 'error' && typeof m.errorMessage === 'string') out.push({ kind: 'error', text: m.errorMessage })
    } else if (m.role === 'toolResult') {
      const step = steps.get(m.toolCallId as string)
      if (step && m.isError) step.error = true
      const card = (m.details as CardDetails | undefined)?.card
      if (card && !m.isError) out.push(structuredClone(card))
    }
  }
  // A choice the user answered shows as their message; the buttons go away.
  for (const [i, m] of out.entries()) {
    const next = out[i + 1]
    if (m.kind === 'choices' && next?.kind === 'user' && m.options.includes(next.text)) m.picked = next.text
  }
  return out
}

/** What a tool call touched, for the steps list. */
function target(tool: string, args: Record<string, unknown>, root: string): { target?: string } {
  if (typeof args.path === 'string') return { target: args.path.startsWith(root) ? args.path.slice(root.length + 1) : args.path }
  if (typeof args.id === 'string') return { target: args.id }
  for (const key of ['todos', 'items'] as const) if (Array.isArray(args[key])) return { target: String((args[key] as unknown[]).length) }
  return {}
}

const title = (text: string) => (text.length > 16 ? `${text.slice(0, 16)}…` : text)

function firstSentence(text: string) {
  // Chinese sentences end without a space after the stop.
  const m = /^.+?(?:[。！？]|[.!?](?=\s|$))/s.exec(text.trim())
  return (m ? m[0] : text).trim().slice(0, 120)
}

function localTime(at: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}
