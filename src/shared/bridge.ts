// What the preload script exposes to the renderer as `window.jezo`.

import type { CalendarEvent, CalendarSource, CalendarStatus } from './calendar'
import type { ArgumentSuggestion, HistoryEntry, SessionView, SlashCommand, Trigger, UndoResult } from './session'
import type { Fields, Item, ItemChanges, RecordedChange } from './workspace'
import type { SkillInfo, SkillInstallResult, SkillPreview } from './skills'
import type { ExtensionNotice, InstallPreview, InstallResult, InstalledResources } from './install'
import type { ChatBridge } from './chat'
export type { SkillInfo } from './skills'

export type ThemeSource = 'system' | 'light' | 'dark'

/** What the ⌥X window is asked to do. */
export type QuickCommand =
  | { kind: 'type' }
  /** ⌥X is being held: listen. `context` is the page the user was looking at in the main window. */
  | { kind: 'voice-start'; context: string | null }
  /** ⌥X was released: stop listening and send what was said. */
  | { kind: 'voice-end' }

/** A provider of models, as the provider list shows it. */
export interface ProviderSummary {
  id: string
  name: string
  /** `local`: runs on this machine (LM Studio, Ollama, Apple Foundation Models). `custom`: a server the user added. */
  kind: 'local' | 'cloud' | 'custom'
  /** `ready` can be used; `off` isn't set up or isn't running; `error` failed its last check. */
  state: 'ready' | 'off' | 'error'
  /** The last characters of the saved key. The key itself never comes back from the main process. */
  keyHint?: string
  /** One of the providers most people start with. */
  popular?: boolean
}

export interface ProviderModel {
  id: string
  name: string
  /** Takes images. */
  image: boolean
  reasoning: boolean
  contextWindow: number
  /** Dollars per million tokens, when the provider charges. */
  cost?: { input: number; output: number }
  /** A local server has it in memory now. */
  loaded?: boolean
  /** Offered in the model pickers. */
  enabled: boolean
}

export type AppleAvailabilityReason = 'available' | 'unsupported-system' | 'device-not-eligible' | 'intelligence-disabled' | 'model-not-ready' | 'unavailable' | 'helper-unavailable'

export interface ProviderDetail extends ProviderSummary {
  appleAvailability?: AppleAvailabilityReason
  baseUrl?: string
  /** For LM Studio and Ollama: the usual address, to go back to. */
  defaultBaseUrl?: string
  needsKey: boolean
  keyUrl?: string
  /** The model list comes from the server and can be asked for again. */
  canRefresh: boolean
  models: ProviderModel[]
  lastCheck?: { ok: boolean; message?: string; ms?: number }
}

export interface ModelRef {
  provider: string
  id: string
}

export interface ModelChoices {
  /** The model the agent uses now, with its provider's name. */
  main: (ModelRef & { providerName: string }) | null
  /** Jezo picked it because the user hasn't, or their pick can't be used. */
  mainIsAutomatic: boolean
  /** The model for work Jezo starts on its own; null means the main one. */
  background: (ModelRef & { providerName: string }) | null
  /** How hard the main model thinks, and the levels it supports, lowest first ("off" first when it can not think). */
  thinking: string
  thinkingLevels: string[]
}

/** What importing from the user's own pi setup brought over. */
export interface PiImport {
  providers: string[]
  keys: number
  model: string | null
  /** Providers it couldn't bring over, with why. */
  skipped: { name: string; why: 'api' | 'command' }[]
}

export interface CustomProviderInput {
  name: string
  baseUrl: string
  key?: string
}

export interface Schedule {
  morning: string | null
  evening: string | null
}

/** Speech recognition: whether it's installed, and where an install is. */
export interface SpeechStatus {
  installed: boolean
  /** The engine and model this machine uses, like "Qwen3-ASR 0.6B". */
  engine: string
  /** The install step running now. */
  step: 'environment' | 'packages' | 'model' | null
  /** Why the last install failed; "uv" when uv isn't installed. */
  error: string | null
  uv: boolean
}

/** Which Jezo is running, for 設定 → 關於. */
export interface About {
  version: string
  /** The full commit the app was built from; empty when it wasn't built from a git checkout. */
  commit: string
  /** Whether the build had changes that weren't committed, so the commit alone doesn't describe it. */
  dirty: boolean
  /** When it was built, as an ISO instant. */
  builtAt: string
  electron: string
  chrome: string
  node: string
  /** Like "macOS 26.1 (arm64)". */
  system: string
}

export interface JezoBridge {
  /** process.platform: "darwin", "win32", "linux", … */
  platform: string
  about(): Promise<About>
  /** The items in the workspace, and every change to them (docs/design/backend.md). */
  workspace: {
    list(): Promise<Item[]>
    create(kind: string, data: Fields, body?: string): Promise<Item>
    /** A field set to null is removed. */
    update(id: string, fields: Fields, options?: { body?: string }): Promise<Item>
    remove(id: string): Promise<void>
    /**
     * Makes several changes as one change of the user's in 修改紀錄, which can be
     * taken back there. Resolves to its id, for `history.undo`.
     */
    recorded(summary: string, changes: RecordedChange[]): Promise<string>
    /** Stores a file for an item's notes; resolves to the link from the item's file, like `../attachments/t-1/photo.png`. */
    attach(id: string, name: string, bytes: Uint8Array): Promise<string>
    /** Opens a workspace file in the app the system uses for it. */
    openFile(path: string): Promise<void>
    onChange(listener: (changes: ItemChanges) => void): () => void
  }
  /** The device's zone, as the main process reads it from the OS, and when it changes (docs/design/time.md). */
  time: {
    zone(): Promise<string>
    onZone(listener: (zone: string) => void): () => void
  }
  /** Conversations with Jezo's agent. */
  agent: {
    pi: ChatBridge
    list(): Promise<SessionView[]>
    /** Sends the user's message, starting a conversation when `id` is null. Resolves to the conversation's id once it has one. */
    send(id: string | null, text: string, trigger?: Trigger, behavior?: 'followUp' | 'steer'): Promise<string>
    /** Starts a conversation Jezo asks for on the user's behalf, like sorting notes. */
    /** Starts a request of Jezo's own; `zone` is the zone the calendar shows when it's started from one showing another. */
    start(trigger: Trigger, zone?: string): Promise<string>
    abort(id: string): Promise<void>
    /** Asks the agent, without a visible message, to make the change it described in a run that changed nothing. */
    nudge(id: string): Promise<void>
    /** What the "/" menu offers: skills, prompt templates and extension commands. */
    commands(): Promise<SlashCommand[]>
    /** What an extension command suggests for its arguments, given what's typed after it. */
    argumentSuggestions(name: string, typed: string): Promise<ArgumentSuggestion[]>
    answerExtension(id: string, request: string, value?: string | boolean): Promise<void>
    onNotice(listener: (notice: ExtensionNotice) => void): () => void
    /** Saved records, queues and run status; the quick preview also receives streaming text. */
    onChange(listener: (view: SessionView) => void): () => void
  }
  install: {
    preview(source: string): Promise<InstallPreview>
    pick(): Promise<InstallPreview | null>
    apply(token: string, selected: string[], replace?: boolean): Promise<InstallResult>
    discard(token: string): Promise<void>
    list(): Promise<InstalledResources>
    setEnabled(kind: 'package' | 'mcp', id: string, enabled: boolean): Promise<void>
    remove(kind: 'package' | 'mcp', id: string): Promise<void>
    signIn(name: string): Promise<void>
    replySignIn(name: string, url?: string): Promise<void>
    reconnect(name: string): Promise<void>
    onChange(listener: () => void): () => void
  }
  /** Hold-to-talk. The ⌥X window sends 16 kHz 16-bit audio and hears the text back as it's recognized. */
  speech: {
    status(): Promise<SpeechStatus>
    install(): Promise<void>
    onStatus(listener: (status: SpeechStatus) => void): () => void
    /**
     * Starts listening. `session` is the conversation the words go into, so
     * recognition can expect what was just said there. False when speech isn't installed.
     */
    start(session?: string | null): Promise<boolean>
    /** Tells recognition the app's page names, in the app's language, which it should expect to hear. */
    setVocabulary(words: string[], language: string): void
    audio(chunk: ArrayBuffer): void
    /** The audio is over; resolves to everything that was said. */
    end(): Promise<string>
    onText(listener: (text: string) => void): () => void
    /** Another window started listening, which ends this one's utterance. */
    onReplaced(listener: () => void): () => void
  }
  /** The user's calendars: the Mac's own and ICS subscriptions (docs/design/calendar.md). Events are read-only. */
  calendar: {
    status(): Promise<CalendarStatus>
    /** Events between two local dates, `to` exclusive, from every calendar that isn't hidden. */
    /** Events between two days (`to` exclusive), the days being in `zone`: the one the calendar shows. */
    events(from: string, to: string, zone: string): Promise<CalendarEvent[]>
    /** Adds a subscription. Rejects with the reason when the address doesn't give a calendar. */
    subscribe(url: string, name?: string): Promise<CalendarSource>
    unsubscribe(id: string): Promise<void>
    refresh(id?: string): Promise<void>
    /** Turns on the Mac's calendars, asking macOS for access the first time. */
    connectMac(): Promise<'full' | 'notDetermined' | 'denied' | 'restricted' | 'writeOnly' | 'unavailable'>
    disconnectMac(): Promise<void>
    /** Opens macOS's privacy settings for calendars, where access denied earlier is turned back on. */
    openMacSettings(): Promise<void>
    setHidden(calendar: string, hidden: boolean): Promise<void>
    /** Keeps the user's own Google OAuth client (a Desktop client from their Google Cloud project) in the keychain. */
    setGoogleClient(id: string, secret: string): Promise<void>
    /** Signs in to a Google account in the browser; resolves to its email. `page` is what the browser tab says afterward. */
    connectGoogle(page: { done: string; failed: string }): Promise<string>
    disconnectGoogle(account: string): Promise<void>
    /** Called when anything changes: a calendar synced, one was added, an event moved on the Mac. */
    onChange(listener: () => void): () => void
  }
  /** When Jezo starts the day's sessions on its own, as "08:00"; null is off. */
  schedule: {
    get(): Promise<Schedule>
    set(change: Partial<Schedule>): Promise<Schedule>
    /** Runs an automation now; resolves to its conversation. */
    run(id: string): Promise<string>
    /** What happened to its times, newest first (docs/design/automations.md). */
    history(id: string): Promise<AutomationHistoryView>
    /** Skips the time that's due or waiting for a model. */
    skip(id: string): Promise<void>
    /** Every automation history with lines that can't be read. */
    problems(): Promise<AutomationHistoryView['problems']>
    /** Called with an automation's id when its history gets an event. */
    onHistory(listener: (id: string) => void): () => void
    /** Whether Jezo starts, without a window, when the user logs in, so automations run while the computer's awake. */
    atLogin(): Promise<boolean>
    setAtLogin(on: boolean): Promise<boolean>
  }
  /** The agent's methods, from the workspace. */
  skills: {
    list(): Promise<SkillInfo[]>
    setEnabled(id: string, enabled: boolean): Promise<SkillInfo[]>
    preview(source: string): Promise<SkillPreview>
    pick(): Promise<SkillPreview | null>
    previewUpdate(id: string): Promise<SkillPreview>
    install(token: string, paths: string[], replace?: boolean, overwriteModified?: boolean): Promise<SkillInstallResult>
    write(input: { name: string; description: string; instructions: string }, replace?: boolean): Promise<SkillInstallResult>
    discard(token: string): Promise<void>
    remove(id: string): Promise<void>
    onChange(listener: () => void): () => void
  }
  /**
   * Long-term memory (docs/design/memory.md). Forgetting keeps the same words
   * from being saved again; restore and discard are for undo.
   */
  memory: {
    /** `separate` saves it beside related memories; `again` brings back words the user deleted. Both are the user's call when they save one. */
    remember(input: { text: string; epistemic: 'stated' | 'inferred'; evidence?: string[]; separate?: boolean; again?: boolean }): Promise<{ id: string }>
    forget(id: string): Promise<void>
    restore(record: Record<string, unknown>): Promise<void>
    discard(id: string): Promise<void>
  }
  /** Model providers and which model the agent uses. Keys go to the OS keychain and never come back. */
  providers: {
    list(): Promise<ProviderSummary[]>
    get(id: string): Promise<ProviderDetail>
    setKey(id: string, key: string | null): Promise<ProviderDetail>
    setBaseUrl(id: string, baseUrl: string): Promise<ProviderDetail>
    /** Sends a one-word request with this model. */
    check(id: string, model: string): Promise<ProviderDetail>
    /** Asks the server for its models again. */
    refresh(id: string): Promise<ProviderDetail>
    setModelEnabled(id: string, model: string, enabled: boolean): Promise<ProviderDetail>
    addCustom(input: CustomProviderInput): Promise<ProviderDetail>
    remove(id: string): Promise<void>
    /** The enabled models of every provider that's ready, for pickers. */
    choosable(): Promise<{ provider: string; providerName: string; model: ProviderModel }[]>
    choices(): Promise<ModelChoices>
    choose(role: 'main' | 'background', ref: ModelRef | null): Promise<ModelChoices>
    setThinking(level: string): Promise<ModelChoices>
    /** Copies providers, keys and the default model from ~/.pi/agent. Only when the user asks. */
    importFromPi(): Promise<PiImport>
    onChange(listener: () => void): () => void
  }
  /** What the agent changed, run by run, and taking it back. */
  history: {
    list(): Promise<HistoryEntry[]>
    undo(id: string): Promise<UndoResult>
    onChange(listener: () => void): () => void
  }
  setTheme(source: ThemeSource): void
  /** Tells the main process the app's language, for what it shows itself, like notifications. */
  setLanguage(language: string): void
  /** Called with a conversation to open, from the ⌥X window or a notification. */
  onOpenSession(listener: (session: string) => void): () => void
  /** Called with a todo to open in 待辦, from a deadline's reminder. */
  onOpenTodo(listener: (todo: string | null) => void): () => void
  /** Notifications before deadlines: whether they're on, and turning them on or off. */
  reminders: {
    deadlines(): Promise<boolean>
    setDeadlines(on: boolean): Promise<boolean>
  }
  /** Tells the ⌥X window which page the main window shows, so voice can bring it along as context. */
  setContext(pageTitle: string): void
  quick: {
    /** Whether holding ⌥X to talk works on this machine. */
    canHold(): Promise<boolean>
    /**
     * Continues a conversation from the ⌥X window in the main window, which
     * opens it and comes forward. Notes don't come through here: the ⌥X
     * window writes them to the workspace itself.
     */
    continue(session: string): void
    hide(): void
    /** Fits the window's height to what it shows. */
    resize(height: number): void
    /** Called in the ⌥X window. */
    onCommand(listener: (command: QuickCommand) => void): () => void
  }
}

/**
 * An automation's history for its page: one row per time or run, newest first,
 * and the lines of the file that can't be read. While there are any, the
 * automation doesn't start on its own.
 */
export interface AutomationHistoryView {
  rows: AutomationRow[]
  problems: { path: string; line: number; message: string }[]
}

/** One line of an automation's history, as its page shows it. Slots are a date and clock, like "2026-10-01T08:00". */
export type AutomationRow =
  /** `session` is the run's conversation; `zone` the schedule's zone its slot is in. */
  | { kind: 'run'; at: string; slot?: string; zone?: string; late: boolean; manual: boolean; session?: string; outcome: 'completed' | 'waiting' | 'failed' | 'unreachable' | 'stopped' | 'interrupted' | 'running' }
  | { kind: 'skipped'; at: string; slots: string[]; reason: 'expired' | 'replaced' | 'zone-changed' | 'skipped' }
  | { kind: 'waiting'; at: string; slot: string }
