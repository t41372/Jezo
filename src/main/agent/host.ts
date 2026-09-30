// Runs Jezo's agent: one pi session per conversation, saved as JSONL in the
// workspace's sessions/ (docs/design/backend.md, "Jezo's agent"). It turns what
// pi records into the messages the chat draws, and each run into an entry the
// user can undo.

import { mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import type { SessionMessage, SessionView, Step, Trigger } from '../../shared/session'
import type { Config } from '../config'
import { skillRoots } from '../workspace/skills'
import type { Workspace } from '../workspace/workspace'
import { createModels, type Models } from './models'
import { digest, REQUESTS, SYSTEM_PROMPT } from './prompt'
import { type CardDetails, createTools, type RunContext, TOOL_NAMES } from './tools'
import type { UndoLog } from './undo'

interface Conversation {
  id: string
  trigger: Trigger
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
const REQUEST_MESSAGE = 'jezo.request'

export class AgentHost {
  private conversations = new Map<string, Conversation>()
  private models: Models | null = null
  private listeners = new Set<(view: SessionView) => void>()
  private timers = new Map<string, NodeJS.Timeout>()
  private settings = SettingsManager.inMemory(
    { compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 }, cacheWarming: 'off', enableInstallTelemetry: false },
    { projectTrusted: false },
  )

  constructor(
    private workspace: Workspace,
    private undo: UndoLog,
    private modelConfig: () => Config['model'],
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
        const trigger = manager.getEntries().find((e) => e.type === 'custom' && e.customType === TRIGGER_ENTRY) as { data?: { trigger?: Trigger } } | undefined
        const id = manager.getSessionId()
        this.conversations.set(id, {
          id,
          trigger: trigger?.data?.trigger ?? 'user',
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

  /** The model settings changed; the next message uses the new model. */
  resetModels() {
    this.models = null
    for (const c of this.conversations.values()) {
      if (!c.running) {
        c.session?.dispose()
        c.session = null
      }
    }
  }

  private async create(trigger: Trigger): Promise<Conversation> {
    const manager = SessionManager.create(this.workspace.root, this.dir)
    manager.appendCustomEntry(TRIGGER_ENTRY, { trigger })
    const id = manager.getSessionId()
    const conversation: Conversation = {
      id,
      trigger,
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
      await prompt(session)
      await session.waitForIdle()
      await this.undo.finish(c.context.run, firstSentence(session.getLastAssistantText() ?? ''))
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
    if (c.session) return c.session
    this.models ??= await createModels(this.modelConfig())
    // Nothing reachable a moment ago may be running now.
    if (!this.models.model) this.models = await createModels(this.modelConfig())
    const { runtime, model } = this.models
    if (!model) return null

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
    })
    await loader.reload()
    const { session } = await createAgentSession({
      cwd: this.workspace.root,
      agentDir: process.env.PI_CODING_AGENT_DIR!,
      modelRuntime: runtime,
      settingsManager: this.settings,
      resourceLoader: loader,
      model,
      thinkingLevel: 'medium',
      tools: TOOL_NAMES,
      customTools: createTools(this.workspace, () => c.context),
      sessionManager: c.manager,
    })
    await session.bindExtensions({ mode: 'json', onError: (e) => console.error('pi extension error', e) })
    session.subscribe((event) => this.onEvent(c, event))
    c.session = session
    return session
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
      ...(c.trigger === 'user' || c.trigger === 'hotkey' ? firstUser && { title: title(firstUser.text) } : {}),
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
