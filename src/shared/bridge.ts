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

/** What 設定 shows about the model Jezo's agent uses. */
export interface ModelStatus {
  use: 'local' | 'cloud'
  /** The local server found, or null when neither LM Studio nor Ollama answered. */
  local: { server: string; models: { id: string; loaded: boolean }[]; id: string } | null
  cloud: {
    providers: { id: string; name: string; hasKey: boolean }[]
    provider: string
    models: string[]
    id: string | null
  }
}

export interface ModelChoice {
  use?: 'local' | 'cloud'
  localId?: string
  provider?: string
  cloudId?: string
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
  /** The agent's methods, from the workspace. */
  skills: {
    list(): Promise<SkillInfo[]>
    setEnabled(id: string, enabled: boolean): Promise<SkillInfo[]>
  }
  /** Which model the agent uses. Keys go to the OS keychain and never come back to the window. */
  models: {
    status(): Promise<ModelStatus>
    choose(choice: ModelChoice): Promise<ModelStatus>
    setKey(provider: string, key: string | null): Promise<ModelStatus>
  }
  /** What the agent changed, run by run, and taking it back. */
  history: {
    list(): Promise<HistoryEntry[]>
    undo(id: string): Promise<UndoResult>
    onChange(listener: () => void): () => void
  }
  setTheme(source: ThemeSource): void
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
    /** Called in the main window with the conversation to open. */
    onContinue(listener: (session: string) => void): () => void
    /** Called in the ⌥X window. */
    onCommand(listener: (command: QuickCommand) => void): () => void
  }
}
