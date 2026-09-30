// What the preload script exposes to the renderer as `window.jezo`.

import type { HistoryEntry, SessionView, Trigger, UndoResult } from './session'
import type { Fields, Item, ItemChanges } from './workspace'

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
  /** `local`: found on this machine (LM Studio, Ollama). `custom`: a server the user added. */
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

export interface ProviderDetail extends ProviderSummary {
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

/** A skill as the 它用的方法 page shows it. `id` is its directory in the workspace. */
export interface SkillInfo {
  id: string
  name: string
  /** The title the user sees, from `metadata.title`, or its name. */
  title: string
  description: string
  enabled: boolean
  /** The body of SKILL.md. */
  instructions: string
  /** Its frontmatter doesn't parse. */
  broken?: boolean
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

export interface JezoBridge {
  /** process.platform: "darwin", "win32", "linux", … */
  platform: string
  /** The items in the workspace, and every change to them (docs/design/backend.md). */
  workspace: {
    list(): Promise<Item[]>
    create(kind: string, data: Fields, body?: string): Promise<Item>
    /** A field set to null is removed. */
    update(id: string, fields: Fields, options?: { body?: string }): Promise<Item>
    remove(id: string): Promise<void>
    onChange(listener: (changes: ItemChanges) => void): () => void
  }
  /** Conversations with Jezo's agent. */
  agent: {
    list(): Promise<SessionView[]>
    /** Sends the user's message, starting a conversation when `id` is null. Resolves to the conversation's id once it has one. */
    send(id: string | null, text: string, trigger?: Trigger): Promise<string>
    /** Starts a conversation Jezo asks for on the user's behalf, like sorting notes. */
    start(trigger: Trigger): Promise<string>
    abort(id: string): Promise<void>
    /** Called with a conversation whenever it changes, while the agent writes too. */
    onChange(listener: (view: SessionView) => void): () => void
  }
  /** Hold-to-talk. The ⌥X window sends 16 kHz 16-bit audio and hears the text back as it's recognized. */
  speech: {
    status(): Promise<SpeechStatus>
    install(): Promise<void>
    onStatus(listener: (status: SpeechStatus) => void): () => void
    /** Starts listening. False when speech isn't installed. */
    start(): Promise<boolean>
    audio(chunk: ArrayBuffer): void
    /** The audio is over; resolves to everything that was said. */
    end(): Promise<string>
    onText(listener: (text: string) => void): () => void
  }
  /** When Jezo starts the day's sessions on its own, as "08:00"; null is off. */
  schedule: {
    get(): Promise<Schedule>
    set(change: Partial<Schedule>): Promise<Schedule>
  }
  /** The agent's methods, from the workspace. */
  skills: {
    list(): Promise<SkillInfo[]>
    setEnabled(id: string, enabled: boolean): Promise<SkillInfo[]>
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
