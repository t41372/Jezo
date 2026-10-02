// Runs Jezo's agent: one pi session per conversation, saved as JSONL in the
// workspace's sessions/ (docs/design/backend.md, "Jezo's agent"). It turns what
// pi records into the messages the chat draws, and each run into an entry the
// user can undo.

import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PiAgentMessage, PiClient, PiClientEvent, PiClientEventBody, PiSendMessageInput, PiThreadMetadata } from '@assistant-ui/react-pi'
import { shownCustom, typedText, UNCHANGED_ENTRY, type ChatSnapshot } from '../../shared/chat'
import {
  type AgentSession,
  type AgentSessionEvent,
  createAgentSession,
  createCodemodeExtension,
  createToolSearchExtension,
  DefaultResourceLoader,
  type ExtensionAPI,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import type { AgentMessage, ThinkingLevel } from '@earendil-works/pi-agent-core'
import type { ArgumentSuggestion, SessionMessage, SessionView, SlashCommand, Step, Trigger } from '../../shared/session'
import { calendarExtension, HELD_MESSAGE } from '../calendar/agent'
import { type Held, type OutsideContent, outsideToolResults } from './outside'
import type { Calendars } from '../calendar/calendars'
import { newId } from '../workspace/files'
import { listSkills, skillRoots } from '../workspace/skills'
import type { Workspace } from '../workspace/workspace'
import { type Memory, memoryExtension } from '../../../packages/pi-memory/src/index.ts'
import { acting } from './acting'
import { ExtensionUI } from './extension-ui'
import { installer } from '../install/installer'
import type { Providers } from './providers'
import { appleCompactionOverrides } from './foundation-models/provider'
import { deviceZone } from '../clock'
import { now, type Zone } from '../../shared/time'
import { eventWhen } from '../calendar/agent'
import { digest, JUMP_MS, jumpNote, NOTHING_CHANGED, REQUESTS, SYSTEM_PROMPT, timeNote } from './prompt'
import { type CardDetails, createTools, type RunContext, TOOL_NAMES } from './tools'
import type { UndoLog } from './undo'

interface Conversation {
  id: string
  trigger: Trigger
  /** The automation that started it, and its name, for sessions Jezo starts on its own. */
  automation?: { id: string; name: string }
  /** The zone the user is planning in, when they started it from a calendar showing another zone. */
  zone?: Zone
  /** The small model is naming it right now. */
  naming?: boolean
  /** When it started, as a Date. */
  started: Date
  manager: SessionManager
  session: AgentSession | null
  context: RunContext
  /** The assistant message being streamed, not yet in the session's entries. */
  partial: unknown | null
  running: boolean
  /** Messages shown for this conversation that pi doesn't record, like "no model", and where they go. */
  extra: { at: number; leafId: string | null; message: SessionMessage }[]
  /** Tools whose last call in this run failed, with the error, until a later call of the same tool works. */
  failed: Map<string, string>
  seq: number
  publishedEntries: number
  turn: number
  update?: Extract<PiClientEventBody, { type: 'message_update' }>
  liveAssistantId?: string
  initializing?: Promise<AgentSession | null>
  completion?: Promise<void>
  /** How the last run ended, for an automation's history (docs/design/automations.md, "Attempts"). */
  outcome?: Outcome
  finishing?: boolean
  aborted?: boolean
  projection?: { leafId: string | null; messages: SessionMessage[]; entryIds: Set<string> }
  catalogChanged?: boolean
}

/**
 * How a run ended. `unreachable` is a failure before anything happened: no
 * model, or one that didn't answer, so the run can be tried again.
 */
/** How a run ended. `interrupted` is Jezo quitting mid-run; a crash is found to be one at the next launch. */
export type Outcome = 'completed' | 'waiting' | 'failed' | 'unreachable' | 'stopped' | 'interrupted'

const TRIGGER_ENTRY = 'jezo.session'
const CHECK_MESSAGE = 'jezo.check'
const REQUEST_MESSAGE = 'jezo.request'
const TIME_MESSAGE = 'jezo.time'
const NUDGE_MESSAGE = 'jezo.nudge'

export class AgentHost {
  private conversations = new Map<string, Conversation>()
  /** Jezo is quitting: runs it cuts off are interrupted, not finished. */
  private closing = false
  /** Called before a run in an automation's conversation (the scheduler takes its time back, if it had given it up). */
  private retryHook: ((session: string) => Promise<void>) | null = null

  beforeRetry(hook: (session: string) => Promise<void>) {
    this.retryHook = hook
  }

  /** The user is chatting: a conversation they started is running. Background work waits for it. */
  userBusy() {
    return [...this.conversations.values()].some((c) => c.running && (c.trigger === 'user' || c.trigger === 'hotkey'))
  }
  private listeners = new Set<(view: SessionView, catalogChanged: boolean) => void>()
  private eventListeners = new Set<(event: PiClientEvent) => void>()
  private entryIds = new WeakMap<object, string>()
  private finishedListeners = new Set<(id: string, automation: { id: string; name: string } | undefined, outcome: Outcome | undefined) => void>()
  private timers = new Map<string, NodeJS.Timeout>()
  /** The resources the "/" menu last read, for its argument suggestions. */
  private commandLoader?: DefaultResourceLoader
  private ui = new ExtensionUI((id, question) => {
    const c = this.conversations.get(id)
    if (!c) return
    c.manager.appendCustomEntry('jezo.extension-ui', structuredClone(question))
    this.emit(c, true)
  })

  constructor(
    private workspace: Workspace,
    private undo: UndoLog,
    private providers: Providers,
    private memory: Memory,
    private calendars: Calendars,
    private outside: OutsideContent,
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
          | { data?: { trigger?: Trigger; automation?: { id: string; name: string }; zone?: Zone } }
          | undefined
        const id = manager.getSessionId()
        const context = this.contextFor(id)
        context.zone = trigger?.data?.zone
        this.conversations.set(id, {
          id,
          trigger: trigger?.data?.trigger ?? 'user',
          automation: trigger?.data?.automation,
          zone: trigger?.data?.zone,
          started: new Date(header?.timestamp ?? (await stat(join(this.dir, name))).mtime),
          manager,
          session: null,
          context,
          partial: null,
          running: false,
          extra: [],
          failed: new Map(),
          seq: 0,
          publishedEntries: manager.getEntries().length,
          turn: 0,
        })
      } catch (error) {
        console.error(`Can't read the conversation ${name}:`, error)
      }
    }
  }

  onChange(listener: (view: SessionView, catalogChanged: boolean) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onEvent(listener: (event: PiClientEvent) => void) {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  private conversation(id: string) {
    const c = this.conversations.get(id)
    if (!c) throw new Error(`There is no conversation ${id}.`)
    return c
  }

  private metadata(c: Conversation): PiThreadMetadata {
    const model = this.providers.model(c.trigger === 'user' || c.trigger === 'hotkey' ? 'main' : 'background')
    const queuedMessages = [
      ...(c.session?.getSteeringMessages() ?? []).map((content, i) => ({ id: `steer:${i}`, mode: 'steer' as const, content })),
      ...(c.session?.getFollowUpMessages() ?? []).map((content, i) => ({ id: `followUp:${i}`, mode: 'followUp' as const, content })),
    ]
    return {
      id: c.id, title: c.manager.getSessionName() || this.view(c).title,
      workspacePath: this.workspace.root,
      status: c.running ? 'running' : 'idle',
      createdAt: c.started.toISOString(), sessionFile: c.manager.getSessionFile(),
      queuedMessages,
      ...(model && { config: { provider: model.provider, modelId: model.id, thinkingLevel: this.providers.thinking(model) } }),
    }
  }

  listThreads() {
    return [...this.conversations.values()].map((c) => this.metadata(c))
  }

  async createThread(input?: Parameters<PiClient['createThread']>[0]) {
    const c = await this.create('user')
    if (input?.title) c.manager.appendSessionInfo(input.title)
    if (input?.initialMessage) await this.sendMessage(c.id, input.initialMessage)
    this.emit(c, true)
    return this.getThread(c.id)
  }

  /** Reading an old conversation doesn't create a model session. */
  getThread(id: string): ChatSnapshot {
    const c = this.conversation(id)
    const branch = c.manager.getBranch()
    const entryIds = new Set(branch.map((entry) => entry.id))
    const asked = new Set<string>()
    const messages: PiAgentMessage[] = branch.flatMap((entry) => {
      const message = entry.type === 'message' ? entry.message
        : entry.type === 'custom_message' ? { role: 'custom', ...entry, timestamp: new Date(entry.timestamp).getTime() }
        : shownCustom(entry as ChatSnapshot['tree']['entries'][number], asked)
      return message ? [{ ...message, jezoEntryId: entry.id } as PiAgentMessage] : []
    })
    if (c.partial) messages.push(c.partial as PiAgentMessage)
    for (const { message, leafId } of c.extra) {
      if (leafId && !entryIds.has(leafId)) continue
      messages.push({ role: 'custom', customType: 'jezo.error', content: '', display: true, details: message, timestamp: c.started.getTime(), jezoEntryId: message.id, jezoLeafId: leafId })
    }
    const flatten = (nodes: ReturnType<SessionManager['getTree']>): ChatSnapshot['tree']['entries'] =>
      nodes.flatMap((node) => [node.entry as ChatSnapshot['tree']['entries'][number], ...flatten(node.children)])
    return { metadata: this.metadata(c), messages, seq: c.seq, tree: { entries: flatten(c.manager.getTree()), leafId: c.manager.getLeafId() } }
  }

  async sendMessage(id: string, input: PiSendMessageInput): Promise<void> {
    const c = this.conversation(id)
    if (c.running) {
      if (c.finishing && c.completion) {
        await c.completion
        return this.sendMessage(id, input)
      }
      const session = c.session ?? await this.sessionFor(c)
      if (!session) throw new Error('No model is available.')
      // An extension's command runs now, even while the agent works; pi won't queue one.
      if (command(session, input.content)) return session.prompt(input.content)
      if (input.streamingBehavior === 'steer') await session.steer(input.content, input.attachments)
      else await session.followUp(input.content, input.attachments)
      return
    }
    this.launch(c, (session) => session.prompt(input.content, { images: input.attachments }), input.content)
  }

  clearQueue(id: string) {
    const cleared = this.conversation(id).session?.clearQueue() ?? { steering: [], followUp: [] }
    this.emit(this.conversation(id), true)
    return cleared
  }

  /** Navigation changes model context, never workspace files or the undo log. */
  async navigate(id: string, leafId: string) {
    const c = this.conversation(id)
    if (c.running) throw new Error('Wait until the agent stops before switching versions.')
    const session = c.session
    const entry = c.manager.getEntry(leafId)
    if (session && entry?.type === 'message' && entry.message.role === 'user') {
      // Pi treats a user target as an edit. Browse its continuation instead.
      c.manager.branch(leafId)
      const continuation = c.manager.appendCustomEntry('jezo.branch', {})
      await session.navigateTree(continuation, { summarize: false })
    } else if (session) await session.navigateTree(leafId, { summarize: false })
    else c.manager.branch(leafId)
    // A custom entry makes the selected leaf survive reopening the JSONL.
    c.manager.appendCustomEntry('jezo.branch', {})
    this.publishEntries(c)
    this.publish(c, { type: 'snapshot', snapshot: this.getThread(id) })
    this.emit(c, true)
  }

  async edit(id: string, entryId: string, text: string, retry = false) {
    const c = this.conversation(id)
    if (c.running) throw new Error('Wait until the agent stops before editing a message.')
    const entry = c.manager.getEntry(entryId)
    if (entry?.type !== 'message' || entry.message.role !== 'user') throw new Error('This is not a user message.')
    const cold = !c.session
    if (cold) {
      if (entry.parentId) c.manager.branch(entry.parentId)
      else c.manager.resetLeaf()
      if (retry) c.manager.appendCustomEntry('jezo.retry', { userEntryId: entryId })
    }
    this.launch(c, async (session) => {
      if (!cold) {
        const result = await session.navigateTree(entryId, { summarize: false })
        if (result.cancelled) return
        // Retried input is the same displayed user turn, with another answer.
        if (retry) c.manager.appendCustomEntry('jezo.retry', { userEntryId: entryId })
      }
      this.publish(c, { type: 'snapshot', snapshot: this.getThread(id) })
      await session.prompt(text)
    }, text)
  }

  async retry(id: string, userEntryId: string | null) {
    const c = this.conversation(id)
    if (!userEntryId) {
      if (c.running) throw new Error('Wait until the agent stops before retrying.')
      const request = c.manager.getBranch().find((entry) => entry.type === 'custom_message' && entry.customType === REQUEST_MESSAGE)
      if (request?.type !== 'custom_message') throw new Error('There is no request to retry.')
      this.launch(c, async (session) => {
        const result = await session.navigateTree(request.id, { summarize: false })
        if (result.cancelled || c.aborted) return
        this.publish(c, { type: 'snapshot', snapshot: this.getThread(id) })
        await session.sendCustomMessage({ customType: REQUEST_MESSAGE, content: timed(withoutRunNote(String(request.content)), c.zone), display: false }, { triggerTurn: true })
      })
      return
    }
    const entry = c.manager.getEntry(userEntryId)
    if (entry?.type !== 'message' || entry.message.role !== 'user') throw new Error('This is not a user message.')
    const content = entry.message.content
    const text = typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
    return this.edit(id, userEntryId, text, true)
  }

  /**
   * Names a conversation the user started, after its first run, with the small
   * model: a few words from what they asked. Until then, and if it fails, the
   * title is the start of their first message. A name the user gave is kept.
   */
  private async name(c: Conversation) {
    if ((c.trigger !== 'user' && c.trigger !== 'hotkey') || c.manager.getSessionName() || c.naming) return
    const first = c.manager.getEntries().find((e) => e.type === 'message' && e.message.role === 'user')
    const content = first?.type === 'message' && first.message.role === 'user' ? first.message.content : undefined
    const asked = typeof content === 'string' ? content : content?.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')
    const model = this.providers.small()
    if (!asked || !model) return
    c.naming = true
    try {
      const reply = await this.providers.runtime.completeSimple(model, {
        messages: [{ role: 'user', content: `${NAME_REQUEST}\n\n<message>\n${asked.slice(0, 1000)}\n</message>`, timestamp: Date.now() }],
      }, { signal: AbortSignal.timeout(30_000) })
      const name = reply.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('').trim().replace(/^["「『]|["」』。.]$/g, '').split('\n')[0]
      if (reply.stopReason === 'error' || reply.stopReason === 'aborted' || !name || name.length > 40 || c.manager.getSessionName()) return
      c.manager.appendSessionInfo(name)
      this.publish(c, { type: 'session_info_changed', name })
      this.emit(c, true)
    } catch (error) {
      console.error('Naming the conversation failed:', error)
    } finally {
      c.naming = false
    }
  }

  rename(id: string, name: string) {
    const c = this.conversation(id)
    c.manager.appendSessionInfo(name)
    this.publish(c, { type: 'session_info_changed', name })
    this.emit(c, true)
  }

  /** Called whenever a run ends, however it ends, with the automation that started the conversation, if one did. */
  onFinished(listener: (id: string, automation: { id: string; name: string } | undefined, outcome: Outcome | undefined) => void) {
    this.finishedListeners.add(listener)
    return () => this.finishedListeners.delete(listener)
  }

  list(): SessionView[] {
    return [...this.conversations.values()].map((c) => this.view(c)).sort((a, b) => b.started - a.started)
  }

  /** Sends the user's message, starting a conversation when `id` is null. Returns the conversation's id. */
  async send(id: string | null, text: string, trigger: Trigger = 'user', streamingBehavior?: 'followUp' | 'steer') {
    const conversation = id ? this.conversations.get(id) : await this.create(trigger)
    if (!conversation) throw new Error(`There is no conversation ${id}.`)
    await this.sendMessage(conversation.id, { content: text, streamingBehavior })
    return conversation.id
  }

  /** Starts a conversation Jezo asks for, like sorting notes. The request isn't shown to the user. */
  /**
   * Runs an automation: its body is the request, after `note`, what the
   * scheduler says about this run, like how late it is. The session remembers
   * which automation it was. `done` settles when the run ends, however it ends.
   */
  /**
   * Starts an automation's conversation. `claim` is awaited after the conversation
   * exists and before anything is asked of the model, so the history can name it.
   */
  async startAutomation(automation: { id: string; name: string; trigger?: Trigger; request: string; note?: string; claim?: (session: string) => Promise<void> }) {
    const conversation = await this.create(automation.trigger ?? 'automation', { id: automation.id, name: automation.name })
    await automation.claim?.(conversation.id)
    const request = automation.note ? `${automation.note}\n\nRequest:\n${automation.request}` : automation.request
    this.launch(conversation, (session) =>
      session.sendCustomMessage({ customType: REQUEST_MESSAGE, content: timed(request, conversation.zone), display: false }, { triggerTurn: true }),
    )
    const done = conversation.completion!.then(() => conversation.outcome ?? 'failed')
    return { id: conversation.id, done }
  }

  /** Stops a run, as the user's Stop does. */
  stop(id: string) {
    return this.abort(id)
  }

  /** Starts a request of Jezo's own. `zone` is the zone the calendar shows, when the user started it from one showing another. */
  async start(trigger: Trigger, zone?: Zone) {
    const request = REQUESTS[trigger]?.(this.workspace.list())
    if (!request) throw new Error(`Nothing starts a session for ${trigger}.`)
    const conversation = await this.create(trigger, undefined, zone && zone !== deviceZone() ? zone : undefined)
    this.launch(conversation, (session) =>
      session.sendCustomMessage({ customType: REQUEST_MESSAGE, content: timed(request, conversation.zone), display: false }, { triggerTurn: true }),
    )
    return conversation.id
  }

  async abort(id: string) {
    this.ui.cancel(id)
    const c = this.conversation(id)
    c.aborted = true
    this.clearQueue(id)
    await c.session?.abort()
    await c.completion
  }

  /**
   * The user's 請它動手 under a run that changed nothing: a hidden message
   * asking the agent to make the change it described, or say that nothing needed one.
   */
  nudge(id: string) {
    const c = this.conversation(id)
    if (c.running) throw new Error('Wait until the agent stops.')
    this.launch(c, (session) => session.sendCustomMessage({ customType: NUDGE_MESSAGE, content: NOTHING_CHANGED, display: false }, { triggerTurn: true }), '')
  }

  answerExtension(id: string, request: string, value?: string | boolean) { this.ui.answer(id, request, value) }

  async close() {
    this.closing = true
    this.ui.close()
    await Promise.all([...this.conversations.values()].map(async (c) => {
      if (!c.session) return
      try {
        await c.session.abort()
        // The run settles as interrupted before the session goes away.
        await c.completion
        await c.session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' })
      } finally { c.session.dispose() }
    }))
  }

  private async create(trigger: Trigger, automation?: { id: string; name: string }, zone?: Zone): Promise<Conversation> {
    const manager = SessionManager.create(this.workspace.root, this.dir)
    manager.appendCustomEntry(TRIGGER_ENTRY, { trigger, ...(automation && { automation }), ...(zone && { zone }) })
    const id = manager.getSessionId()
    const conversation: Conversation = {
      id,
      trigger,
      ...(zone && { zone }),
      automation,
      started: new Date(),
      manager,
      session: null,
      context: this.contextFor(id),
      partial: null,
      running: false,
      extra: [],
      failed: new Map(),
      seq: 0,
      publishedEntries: 0,
      turn: 0,
    }
    conversation.context.zone = zone
    this.conversations.set(id, conversation)
    return conversation
  }

  private contextFor(session: string): RunContext {
    const context: RunContext = { run: '', session, said: '', acted: false, effects: false, asked: false, heard: [], closed: [], refused: () => this.undo.refused(context.run) }
    return context
  }

  /** One run: the agent works until it's done with this message. */
  private launch(c: Conversation, prompt: (session: AgentSession) => Promise<void>, userText?: string) {
    c.completion = this.run(c, prompt, userText)
  }

  private async run(c: Conversation, prompt: (session: AgentSession) => Promise<void>, userText?: string) {
    c.running = true
    c.finishing = false
    c.aborted = false
    this.emit(c)
    let recording = false
    try {
      // A run in an automation's conversation may be the user retrying a time it gave up.
      if (c.automation) await this.retryHook?.(c.id)
      const session = await this.sessionFor(c)
      if (c.aborted) return
      // An extension's command needs no model: pi runs its code, not the agent.
      const byExtension = session && userText !== undefined && command(session, userText)
      if (!session || (!session.model && !byExtension)) {
        if (userText) c.manager.appendMessage({ role: 'user', content: userText, timestamp: Date.now() })
        this.note(c, { kind: 'error', code: 'no-model' })
        c.outcome = 'unreachable'
        return
      }
      c.outcome = undefined
      c.context.run = newId('r')
      c.context.said = userText ?? ''
      c.context.acted = false
      c.context.effects = false
      c.context.asked = false
      c.context.heard = [...heard(c.manager.getEntries()), ...(userText ? [userText] : [])]
      c.context.closed = this.memory.deleted().flatMap((f) => f.evidence ?? [])
      c.failed.clear()
      this.undo.start({ id: c.context.run, session: c.id, trigger: c.trigger, at: localTime(new Date()) })
      recording = true
      // Everything this run does, however deep, is the agent's, acting on the user's words or on what Jezo asked.
      const source = userText !== undefined ? 'user' : 'agent'
      const file = c.manager.getSessionFile()
      const sessionPath = file ? `sessions/${basename(file)}` : undefined
      await acting.run({ actor: { by: 'agent', run: c.context.run }, source, session: sessionPath }, async () => {
        await prompt(session)
        await session.waitForIdle()
        c.finishing = true
      })
      // Cut off by Quit, the run stays unfinished in the undo history, so the next launch lists it as 沒跑完.
      if (this.closing && !c.aborted) {
        c.outcome = 'interrupted'
        return
      }
      await this.undo.finish(c.context.run, firstSentence(session.getLastAssistantText() ?? ''))
      recording = false
      const last = [...session.messages].reverse().find((m) => m.role === 'assistant') as { stopReason?: string } | undefined
      // Only a run that never got as far as a tool that can change something is safe to start again on its own.
      const nothingDone = !this.undo.changed(c.context.run) && !c.context.effects
      // A reply cut off by its output limit ('length') or aborted by something other than Stop didn't finish.
      c.outcome = c.aborted ? 'stopped'
        : last?.stopReason === 'error' ? (nothingDone ? 'unreachable' : 'failed')
        : last?.stopReason === 'length' || last?.stopReason === 'aborted' ? 'failed'
        : c.context.asked ? 'waiting' : 'completed'
      // Said so under the reply, so a reply that claims a change the run never made is easy to see (docs/design/frontend.md, "Chat").
      if (!c.aborted && !byExtension && !this.undo.changed(c.context.run) && !c.context.acted) c.manager.appendCustomEntry(UNCHANGED_ENTRY, {})
    } catch (error) {
      console.error(error)
      this.note(c, { kind: 'error', text: String(error instanceof Error ? error.message : error) })
      c.outcome = c.aborted ? 'stopped' : this.closing ? 'interrupted' : 'failed'
      // What it changed before failing is in the undo history, like any finished run.
      if (recording && !this.closing) await this.undo.finish(c.context.run, '').catch(console.error)
    } finally {
      for (const listener of this.finishedListeners) listener(c.id, c.automation, c.outcome)
      void this.name(c)
      this.ui.cancel(c.id)
      c.running = false
      c.partial = null
      this.publishEntries(c)
      this.publish(c, { type: 'snapshot', snapshot: this.getThread(c.id) })
      this.emit(c, true)
    }
  }

  /** Adds a message pi doesn't record, after what's there now. */
  private note(c: Conversation, message: SessionMessage) {
    message.id = `notice:${randomUUID()}`
    c.extra.push({ at: this.view(c).messages.length, leafId: c.manager.getLeafId(), message })
  }

  private async sessionFor(c: Conversation): Promise<AgentSession | null> {
    if (c.initializing) return c.initializing
    c.initializing = this.loadSession(c)
    try { return await c.initializing } finally { c.initializing = undefined }
  }

  private async loadSession(c: Conversation): Promise<AgentSession | null> {
    // What the user starts uses the main model; what Jezo starts on its own uses the background one.
    const role = c.trigger === 'user' || c.trigger === 'hotkey' ? 'main' : 'background'
    let model = this.providers.model(role)
    // A local server that wasn't running a moment ago may be now.
    if (!model) {
      await this.providers.refreshServers()
      model = this.providers.model(role)
    }
    if (c.session) {
      // The user may have picked another model, or another thinking level, since this conversation started.
      if (model) {
        if (c.session.model?.provider !== model.provider || c.session.model?.id !== model.id) await c.session.setModel(model)
        c.session.setThinkingLevel(this.providers.thinking(model) as ThinkingLevel)
      }
      return c.session
    }
    const runtime = this.providers.runtime
    const installs = installer(this.workspace)
    const settings = installs.settings

    // The prompt's picture of the day is from now; each message says the time again (timeNote).
    const promptTime = nowHere(c.zone)
    const loader = new DefaultResourceLoader({
      ...await this.resourcePaths(),
      // The workspace's AGENTS.md is its map, as a project's is for a coding agent. Only that one:
      // pi would also read every AGENTS.md above it, and the workspace may sit inside someone's repository.
      agentsFilesOverride: () => {
        const path = join(this.workspace.root, 'AGENTS.md')
        return { agentsFiles: existsSync(path) ? [{ path, content: readFileSync(path, 'utf8') }] : [] }
      },
      systemPromptOverride: () => SYSTEM_PROMPT,
      appendSystemPromptOverride: () => [digest(this.workspace.list(), promptTime, deviceZone())],
      extensionFactories: [
        { name: 'codemode', factory: createCodemodeExtension({ mode: 'on' }), replaceable: true },
        { name: 'tool-search', factory: createToolSearchExtension(), replaceable: true },
        { name: 'mcp', factory: await installs.mcpExtension(), replaceable: true },
        { name: 'jezo-checks', factory: (pi) => this.checks(pi, c) },
        { name: 'jezo-time', factory: (pi) => this.time(pi, promptTime, c) },
        { name: 'jezo-memory', factory: memoryExtension(this.memory) },
        { name: 'jezo-calendar', factory: calendarExtension(this.calendars, this.outside, () => c.zone ?? deviceZone()) },
        // Tools the user installed that bring in other people's text: MCP servers.
        { name: 'jezo-outside', factory: outsideToolResults(this.outside, (tool) => tool.startsWith('mcp__')) },
      ],
    })
    await loader.reload()
    // reload() reads settings from disk and clears applyOverrides().
    settings.applyOverrides({
      compaction: {
        enabled: true,
        // pi's default 16K reserve exceeds the Apple model's entire context.
        modelOverrides: appleCompactionOverrides(settings.getSettings().compaction?.modelOverrides),
      },
      retry: { enabled: true, maxRetries: 2 }, cacheWarming: 'off', defaultTools: TOOL_NAMES,
    })
    const { session } = await createAgentSession({
      cwd: this.workspace.root,
      agentDir: process.env.PI_CODING_AGENT_DIR!,
      modelRuntime: runtime,
      settingsManager: settings,
      resourceLoader: loader,
      model: model ?? undefined,
      thinkingLevel: model ? this.providers.thinking(model) as ThinkingLevel : 'off',
      customTools: createTools(
        this.workspace,
        () => c.context,
        (path) => this.blocked(path),
        async (scheduled, minutes) => {
          const { events, unchecked } = await this.calendars.overlapping(scheduled, minutes)
          const found = await Promise.all(
            events.map(async (e) => {
              const when = eventWhen(e, deviceZone())
              return `${(await this.outside.screen(e.title, `the calendar, ${when}`)).text} ${when}`
            }),
          )
          return { found, unchecked }
        },
        (todoId) => this.planOf(c, todoId),
        { begin: (run, files) => this.undo.beginCommand(run, files), end: (run, id) => this.undo.endCommand(run, id) },
      ),
      sessionManager: c.manager,
    })
    session.subscribe((event) => this.onSessionEvent(c, event))
    c.session = session
    await session.bindExtensions({ mode: 'json', uiContext: await this.ui.context(c.id), shutdownHandler: () => { void this.abort(c.id) }, onError: (e) => console.error('pi extension error', e) })
    return session
  }

  /**
   * The time, with each of the user's messages (prompt.ts, timeNote). pi puts a
   * message from before_agent_start after the user's, so the model's last input
   * would be the clock rather than what the user asked; it's moved in front of
   * it for the model, and kept after it in the session file.
   */
  private time(pi: ExtensionAPI, promptTime: Temporal.ZonedDateTime, c: Conversation) {
    const zone = c.zone
    pi.on('before_agent_start', () => ({ message: { customType: TIME_MESSAGE, content: timeNote(nowHere(zone), promptTime, deviceZone()), display: false } }))
    // Notes said when time jumped between two model calls of one run, kept where they were said.
    // A run starts with its own time note, so each run starts them afresh: a jump from an
    // earlier run, or from another branch after a retry, never shows up in this one. A run is
    // told apart by its id, since a request Jezo sends doesn't go through before_agent_start.
    let jumps: { at: number; note: AgentMessage }[] = []
    let last: Temporal.ZonedDateTime | null = null
    let run = ''
    pi.on('context', (event) => {
      if (c.context.run !== run) {
        run = c.context.run
        jumps = []
        last = null
      }
      const now = nowHere(zone)
      // A short sleep across midnight counts too: the model would still be on yesterday's date.
      if (last && (now.timeZoneId !== last.timeZoneId || now.epochMilliseconds - last.epochMilliseconds > JUMP_MS || !now.toPlainDate().equals(last.toPlainDate()))) {
        jumps.push({ at: event.messages.length, note: { role: 'custom', customType: TIME_MESSAGE, content: jumpNote(last, now), display: false, timestamp: now.epochMilliseconds } as AgentMessage })
      }
      last = now
      const messages = [...event.messages]
      for (let i = 1; i < messages.length; i++) {
        const note = messages[i] as { role: string; customType?: string }
        if (note.role === 'custom' && note.customType === TIME_MESSAGE && messages[i - 1].role === 'user') [messages[i - 1], messages[i]] = [messages[i], messages[i - 1]]
      }
      for (const jump of [...jumps].reverse()) if (jump.at <= messages.length) messages.splice(jump.at, 0, jump.note)
      return { messages }
    })
  }

  /**
   * Checks at the end of a run, before it settles (AGENTS.md, principle 8). They
   * look at what the tools did, never at the words of the reply, so they hold in
   * any language (docs/design/backend.md, "Checks").
   */
  private checks(pi: ExtensionAPI, c: Conversation) {
    let failedSentBack = ''
    pi.on('agent_before_settle', () => {
      const run = c.context.run
      // A call that failed and was never made to work, whatever the reply says about it.
      // A small model answered "I've proposed the plan" after two failed calls.
      // Only when nothing changed: a failed call is often followed by the right one (todos_update after a refused todos_propose).
      if (c.failed.size && failedSentBack !== run && !this.undo.changed(run) && !c.context.acted) {
        failedSentBack = run
        const content = [
          "Before you finish: these tool calls failed and weren't made to work, so nothing they were for happened.",
          ...[...c.failed].map(([tool, error]) => `- ${tool}: ${error.split('\n')[0]}`),
          'Fix the call and make it again, or tell the user plainly that it wasn\'t done.',
        ].join('\n')
        return { entries: [{ type: 'custom_message', customType: CHECK_MESSAGE, content, display: false }], continue: true }
      }
    })
  }

  /**
   * Conversations a deleted memory came from. The agent can't read them, so
   * what the user deleted doesn't come back from where it was first said.
   */
  private blocked(path: string) {
    return this.memory.deleted().some((f) => f.evidence?.includes(path))
  }

  /**
   * The latest plan card holding a todo, in this conversation first: the morning's
   * plan can be tweaked from another one too.
   */
  private planOf(c: Conversation, todoId: string) {
    const latest = (conversation: Conversation) => {
      let found: string[] | undefined
      for (const entry of conversation.manager.getEntries()) {
        const m = (entry as { message?: { role?: string; isError?: boolean; details?: CardDetails } }).message
        const card = m?.role === 'toolResult' && !m.isError ? m.details?.card : undefined
        if (card?.kind === 'plan' && card.todoIds.includes(todoId)) found = card.todoIds
      }
      return found
    }
    return latest(c) ?? [...this.conversations.values()].map(latest).find(Boolean)
  }

  /** Skills live in the workspace: its own skills/, and each plugin directory's. */
  /** Where the loader finds skills, prompt templates and extensions: the workspace's, and what the user installed. */
  private async resourcePaths() {
    const installs = installer(this.workspace)
    const resources = await installs.resources()
    return {
      cwd: this.workspace.root,
      agentDir: process.env.PI_CODING_AGENT_DIR!,
      settingsManager: installs.settings,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: [...await this.skillDirs(), ...resources.skills.filter((r) => r.enabled).map((r) => r.path)],
      additionalExtensionPaths: resources.extensions.filter((r) => r.enabled).map((r) => r.path),
      additionalPromptTemplatePaths: resources.prompts.filter((r) => r.enabled).map((r) => r.path),
    }
  }

  /**
   * What the "/" menu offers: skills, prompt templates and the commands installed
   * extensions register, as pi runs them from a message (docs/design/frontend.md,
   * "Slash commands"). Read without a conversation, since a new one has no session yet.
   */
  async commands(): Promise<SlashCommand[]> {
    const loader = new DefaultResourceLoader(await this.resourcePaths())
    await loader.reload()
    this.commandLoader = loader
    const titles = new Map((await listSkills(this.workspace.root)).map((s) => [s.name, s.title]))
    return [
      ...loader.getSkills().skills.map((s) => ({ name: `skill:${s.name}`, title: titles.get(s.name), description: s.description, source: 'skill' as const })),
      ...loader.getPrompts().prompts.map((p) => ({ name: p.name, description: p.description, hint: p.argumentHint, source: 'prompt' as const })),
      ...loader.getExtensions().extensions.flatMap((e) =>
        [...e.commands.values()].map((c) => ({ name: c.name, description: c.description, source: 'extension' as const, completes: !!c.getArgumentCompletions })),
      ),
    ]
  }

  /**
   * What an extension command suggests for its arguments so far, as pi's own
   * editor asks (getArgumentCompletions), from the extensions the menu last read.
   */
  async argumentSuggestions(name: string, typed: string): Promise<ArgumentSuggestion[]> {
    if (!this.commandLoader) await this.commands()
    const command = this.commandLoader!.getExtensions().extensions.flatMap((e) => [...e.commands.values()]).find((c) => c.name === name)
    if (!command?.getArgumentCompletions) return []
    // An extension's own code: one that hangs or throws mustn't hold up the box.
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
    const items = await Promise.race([Promise.resolve(command.getArgumentCompletions(typed)).catch(() => null), timeout])
    return (items ?? []).slice(0, 50).map((i) => ({ value: i.value, label: i.label, ...(i.description && { description: i.description }) }))
  }

  private async skillDirs() {
    return (await skillRoots(this.workspace.root)).map((dir) => join(this.workspace.root, dir))
  }

  private onSessionEvent(c: Conversation, event: AgentSessionEvent) {
    this.forwardEvent(c, event)
    if (event.type === 'message_start' && event.message.role === 'user') {
      const content = event.message.content
      const text = typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
      if (text !== c.context.said) c.context.said += `\n${text}`
      // The owner can join an automation with a queued instruction. Delivery
      // happens after its previous tools finish; later work is on their words.
      const scope = acting.getStore()
      if (scope) scope.source = 'user'
    }
    if (event.type === 'tool_execution_start' && !readOnly(c.session?.getAllTools().find((t) => t.name === event.toolName))) c.context.effects = true
    if (event.type === 'tool_execution_end') {
      if (!event.isError) {
        c.failed.delete(event.toolName)
        // External actions need not write a workspace file. Read-only tools
        // and the discovery/orchestration tools still don't prove an action.
        if (!TOOL_NAMES.includes(event.toolName) && !['tool_search', 'codemode'].includes(event.toolName)) {
          const tool = c.session?.getAllTools().find((t) => t.name === event.toolName)
          if (tool && tool.annotations?.readOnlyHint !== true) c.context.acted = true
        }
      }
      else {
        const content = (event.result as { content?: { type: string; text?: string }[] } | undefined)?.content
        c.failed.set(event.toolName, content?.map((b) => b.text ?? '').join('') || 'failed')
      }
    }
    if (event.type === 'message_update' && event.message.role === 'assistant') c.partial = { ...event.message, jezoEntryId: c.liveAssistantId }
    if (event.type === 'message_end') c.partial = null
    if (event.type === 'message_update' || event.type === 'message_end' || event.type === 'tool_execution_end' || event.type === 'tool_execution_start' || event.type === 'queue_update') {
      this.emit(c, false, event.type !== 'message_update')
    }
  }

  private publish(c: Conversation, body: PiClientEventBody) {
    const event = { ...body, threadId: c.id, seq: ++c.seq } as PiClientEvent
    for (const listener of this.eventListeners) listener(event)
  }

  /** New entries go over IPC once. Token updates carry only the live message. */
  private publishEntries(c: Conversation) {
    if (c.manager.getEntryCount() === c.publishedEntries) return
    const entries = c.manager.getEntries()
    for (const entry of entries.slice(c.publishedEntries)) {
      if (entry.type === 'message') this.entryIds.set(entry.message, entry.id)
      this.publish(c, { type: 'entry_appended', entry: entry as ChatSnapshot['tree']['entries'][number] })
    }
    c.publishedEntries = entries.length
  }

  private forwardEvent(c: Conversation, event: AgentSessionEvent) {
    if (event.type === 'turn_start') c.turn++
    if (event.type === 'message_start' && event.message.role === 'assistant') c.liveAssistantId = `live:${randomUUID()}`
    let body = (event.type === 'turn_start' || event.type === 'turn_end' ? { type: event.type, turnIndex: c.turn } : event) as PiClientEventBody
    if (event.type === 'message_start' || event.type === 'message_update') body = {
      ...event, message: { ...event.message, jezoEntryId: event.message.role === 'assistant' ? c.liveAssistantId : `live:${randomUUID()}` },
    } as PiClientEventBody
    if (event.type === 'message_update') {
      c.update = body as Extract<PiClientEventBody, { type: 'message_update' }>
      return
    }
    if (c.update) {
      this.publish(c, c.update)
      c.update = undefined
    }
    if (event.type === 'message_end') {
      // Pi appends the entry after public listeners return. Final messages use
      // that entry's ID; live messages have a temporary UUID until it exists.
      queueMicrotask(() => {
        this.publishEntries(c)
        const entryId = this.entryIds.get(event.message) ?? c.manager.getLeafId()
        this.publish(c, { type: 'message_end', message: { ...event.message, jezoEntryId: entryId } as PiAgentMessage })
        if (event.message.role === 'user') this.publish(c, { type: 'snapshot', snapshot: this.getThread(c.id) })
      })
      return
    }
    this.publish(c, body as PiClientEventBody)
    // Pi persists after notifying subscribers. Read the entries after that.
    if (event.type === 'turn_end') queueMicrotask(() => this.publishEntries(c))
  }

  /** Tells the windows. Streaming text arrives often, so updates go out at most every 50 ms. */
  private emit(c: Conversation, now = false, catalogChanged = true) {
    if (catalogChanged) c.catalogChanged = true
    const send = () => {
      this.timers.delete(c.id)
      if (c.update) {
        this.publish(c, c.update)
        c.update = undefined
      }
      const view = this.view(c)
      const changed = c.catalogChanged ?? false
      c.catalogChanged = false
      for (const listener of this.listeners) listener(view, changed)
    }
    if (now) {
      clearTimeout(this.timers.get(c.id))
      return send()
    }
    if (!this.timers.has(c.id)) this.timers.set(c.id, setTimeout(send, 50))
  }

  private view(c: Conversation): SessionView {
    const leafId = c.manager.getLeafId()
    if (!c.projection || c.projection.leafId !== leafId) {
      const branch = c.manager.getBranch()
      c.projection = { leafId, messages: toMessages(branch, this.workspace.root), entryIds: new Set(branch.map((entry) => entry.id)) }
    }
    const messages = [...c.projection.messages]
    if (c.partial) {
      const tail = toMessages([{ type: 'message', id: c.liveAssistantId, message: c.partial }], this.workspace.root)
      const previous = messages.at(-1)
      const first = tail[0]
      if (previous?.kind === 'agent' && first?.kind === 'agent') {
        messages[messages.length - 1] = { ...previous, text: previous.text + first.text, streaming: true }
        tail.shift()
      }
      messages.push(...tail)
    }
    for (const { at, message, leafId } of c.extra) {
      if (!leafId || c.projection.entryIds.has(leafId)) messages.splice(Math.min(at, messages.length), 0, message)
    }
    // A question an extension asked that nobody can answer any more (the app restarted, the run stopped) shows as answered.
    for (const [i, message] of messages.entries()) {
      if (message.kind === 'extension-question' && !message.question.answered && !this.ui.isPending(c.id, message.question.id)) {
        messages[i] = { ...message, question: { ...message.question, answered: true } }
      }
    }
    if (c.partial) {
      const last = messages.at(-1)
      if (last?.kind === 'agent') messages[messages.length - 1] = { ...last, streaming: true }
    }
    const firstUser = messages.find((m) => m.kind === 'user') as { text: string } | undefined
    return {
      id: c.id,
      ...(c.trigger === 'user' || c.trigger === 'hotkey'
        ? { title: c.manager.getSessionName() || (firstUser && title(firstUser.text)) }
        : c.trigger === 'automation' && c.automation
          ? { title: c.automation.name }
          : {}),
      trigger: c.trigger,
      ...(c.automation && { automation: c.automation.id }),
      started: c.started.getTime(),
      messages,
      tools: c.session?.getAllTools().filter((tool) => tool.exposure !== 'hidden').map((tool) => tool.name),
      ...(c.running && { running: true }),
      ...(c.partial ? { thinking: thinkingNow(c.partial) } : {}),
      pending: { steering: [...(c.session?.getSteeringMessages() ?? [])], followUp: [...(c.session?.getFollowUpMessages() ?? [])] },
    }
  }
}

/**
 * A request Jezo sends on its own, with the time in front. A user's message gets
 * it from the time note (prompt.ts, timeNote); a request has no user message, and
 * with the date only in the system prompt, a local model planned "the next seven
 * days" in January. A retried request gets the time it's sent again.
 */
function timed(request: string, zone?: Zone) {
  const now = nowHere(zone)
  return `${timeNote(now, now, deviceZone())}\n\n${request.replace(/^Now: .*\n(Times you give .*\n)?(The days after today: .*\n)?\n/, '')}`
}

/**
 * A retried automation's request without what the scheduler said about the first
 * try (how late it was), which would contradict the clock now. Which day the run
 * is for stays: a weekly review retried on Tuesday still reviews the week to Sunday.
 */
function withoutRunNote(request: string) {
  const note = /^(?:Now: .*\n(?:Times you give .*\n)?(?:The days after today: .*\n)?\n)?(This run: .* due at [^.\n]*\.)[^\n]*\n[\s\S]*?\n\nRequest:\n/.exec(request)
  return note ? `${note[1]} This is a retry, sent now.\n\nRequest:\n${request.slice(note[0].length)}` : request
}

/** The extension command a message runs, if it's one ("/greet Tim"). */
function command(session: AgentSession, text: string) {
  return text.startsWith('/') ? session.extensionRunner.getCommand(text.slice(1).split(/\s/)[0]) : undefined
}

// ─── From pi's entries to the chat's messages ───

interface Block {
  type: string
  text?: string
  id?: string
  name?: string
  arguments?: Record<string, unknown>
}

/** The last line of thinking in a message being written, while thinking is the newest thing in it. */
function thinkingNow(message: { content?: unknown }) {
  const last = (message.content as Block[] | undefined)?.at(-1) as (Block & { thinking?: string }) | undefined
  if (last?.type !== 'thinking') return undefined
  return last.thinking?.trimEnd().split('\n').at(-1)?.trim() ?? ''
}

/**
 * What the ⌥X window and the session list see of a conversation: the user's
 * messages, what the agent said, what it did (folded into steps), and the
 * cards its tools asked for. Requests Jezo sent on the user's behalf aren't
 * shown. The agent's thinking is only in the main chat, which reads the
 * records itself, and in `SessionView.thinking` while it's happening.
 */
export function toMessages(entries: unknown[], root: string): SessionMessage[] {
  const out: SessionMessage[] = []
  const steps = new Map<string, Step>()
  const questions = new Map<string, Extract<SessionMessage, { kind: 'extension-question' }>>()
  for (const entry of entries as { id?: string; type: string; customType?: string; data?: import('../../shared/install').ExtensionQuestion; details?: { held?: Held[] }; message?: Record<string, unknown> }[]) {
    if (entry.type === 'custom' && entry.customType === 'jezo.extension-ui' && entry.data) {
      const previous = questions.get(entry.data.id)
      if (previous) previous.question = entry.data
      else {
        const card: Extract<SessionMessage, { kind: 'extension-question' }> = { kind: 'extension-question', question: entry.data, id: entry.id }
        questions.set(entry.data.id, card)
        out.push(card)
      }
    }
    if (entry.type === 'custom_message' && entry.customType === HELD_MESSAGE && entry.details?.held) out.push({ kind: 'held', items: entry.details.held, id: entry.id })
    if (entry.type !== 'message' || !entry.message) continue
    const m = entry.message
    if (m.role === 'user') {
      const text = typeof m.content === 'string' ? m.content : (m.content as Block[]).filter((b) => b.type === 'text').map((b) => b.text).join('\n')
      out.push({ id: entry.id, kind: 'user', text: typedText(text) })
    } else if (m.role === 'assistant') {
      for (const block of (m.content as Block[]) ?? []) {
        const last = out.at(-1)
        if (block.type === 'text' && block.text?.trim()) {
          if (last?.kind === 'agent') last.text += block.text
          else out.push({ id: entry.id, kind: 'agent', text: block.text })
        } else if (block.type === 'toolCall' && block.id && block.name) {
          const step: Step = { tool: block.name, ...target(block.name, block.arguments ?? {}, root) }
          steps.set(block.id, step)
          if (last?.kind === 'steps') last.steps.push(step)
          else out.push({ id: `${entry.id}:steps`, kind: 'steps', steps: [step] })
        }
      }
      if (m.stopReason === 'error' && typeof m.errorMessage === 'string') out.push({ id: `${entry.id}:error`, kind: 'error', text: m.errorMessage })
    } else if (m.role === 'toolResult') {
      const step = steps.get(m.toolCallId as string)
      if (step && m.isError) step.error = true
      const card = (m.details as CardDetails | undefined)?.card
      if (card && !m.isError) out.push({ ...structuredClone(card), id: entry.id })
      const held = (m.details as { held?: Held[] } | undefined)?.held
      if (held) out.push({ kind: 'held', items: held, id: entry.id && `${entry.id}:held` })
    }
  }
  // A choice the user answered shows as their message; the buttons go away.
  for (const [i, m] of out.entries()) {
    const next = out[i + 1]
    if (m.kind === 'choices' && next?.kind === 'user' && m.options.includes(next.text)) m.picked = next.text
  }
  return out
}

/** What the user said in a conversation so far. */
function heard(entries: unknown[]): string[] {
  return entries.flatMap((entry) => {
    const m = (entry as { message?: { role?: string; content?: unknown } }).message
    if (m?.role !== 'user') return []
    return typeof m.content === 'string' ? [m.content] : ((m.content ?? []) as { type: string; text?: string }[]).flatMap((b) => (b.type === 'text' && b.text ? [b.text] : []))
  })
}

/** What a tool call touched, for the steps list. */
function target(tool: string, args: Record<string, unknown>, root: string): { target?: string } {
  if (tool === 'install_from_address' && typeof args.source === 'string') return { target: args.source }
  if (typeof args.path === 'string') return { target: args.path.startsWith(root) ? args.path.slice(root.length + 1) : args.path }
  if (typeof args.id === 'string') return { target: args.id }
  for (const key of ['todos', 'items'] as const) if (Array.isArray(args[key])) return { target: String((args[key] as unknown[]).length) }
  return {}
}

const title = (text: string) => (text.length > 16 ? `${text.slice(0, 16)}…` : text)

/** What the small model is asked to name a conversation by. */
const NAME_REQUEST = 'Give a short title for a conversation that starts with the message below: a few words saying what it is about, in the language of the message (at most 12 characters in Chinese or Japanese, 6 words otherwise). Reply with the title only.'

function firstSentence(text: string) {
  // Chinese sentences end without a space after the stop.
  const m = /^.+?(?:[。！？]|[.!?](?=\s|$))/s.exec(text.trim())
  return (m ? m[0] : text).trim().slice(0, 120)
}

function localTime(at: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}

/** Now, in the device's zone. */
/** Now where the user is: the device's zone, or the zone they're planning in. */
const nowHere = (zone?: Zone) => now().toZonedDateTimeISO(zone ?? deviceZone())

/**
 * Whether a tool only reads, by its own definition. pi's built-in read and ls,
 * and its tool_search, don't say; they only read. A tool that doesn't say is
 * taken to change things.
 */
function readOnly(tool: { name: string; annotations?: { readOnlyHint?: boolean } } | undefined) {
  return !!tool && (tool.annotations?.readOnlyHint === true || ['read', 'ls', 'tool_search'].includes(tool.name))
}
