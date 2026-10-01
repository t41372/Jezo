// Conversations with Jezo's agent as the windows draw them. The main process
// builds them from pi's session files (docs/design/backend.md, "Sessions").

/** A date without a time, like "2026-09-29". */
export type ISODate = string

/** What started a session, or made a change. */
export type Trigger = 'morning' | 'evening' | 'weekly' | 'hotkey' | 'user' | 'notes' | 'backlog' | 'automation'

/** One thing the agent did with a tool: the tool's name and the file or item it touched. */
export interface Step {
  tool: string
  target?: string
  /** The tool failed, or a check refused what it wrote. */
  error?: boolean
}

/** A command the "/" menu offers. `app` ones are Jezo's own actions; the rest pi runs from the message. */
export interface SlashCommand {
  name: string
  /** The method's title the user sees, when it has one. */
  title?: string
  description?: string
  source: 'skill' | 'prompt' | 'extension' | 'app'
  /** What its arguments are, when it says (a prompt template's argument-hint). */
  hint?: string
  /** An extension command that suggests its own arguments (pi's getArgumentCompletions). */
  completes?: boolean
}

/** One argument an extension command suggests: `value` replaces what's typed after the command. */
export interface ArgumentSuggestion {
  value: string
  label: string
  description?: string
}

export type SessionMessage = { id?: string } & (
  | { kind: 'user'; text: string }
  /** What the agent said. `streaming` while it's still being written. */
  | { kind: 'agent'; text: string; streaming?: boolean }
  /** What the agent looked at or changed, folded away by default. */
  | { kind: 'steps'; steps: Step[] }
  /** A plan the agent proposed. Its todos are drafts until accepted. */
  /** Outside content held back from the agent because it read like instructions to an AI. */
  | { kind: 'held'; items: { source: string; text: string }[] }
  | {
      kind: 'plan'
      title: string
      todoIds: string[]
      /** The todos of the plan this one replaced, and what changed from it. */
      revises?: string[]
      changes?: { added: string[]; changed: string[]; removed: string[] }
    }
  /** A question with answers to pick from. The answer the user picked follows as their message. */
  | { kind: 'choices'; options: string[]; picked?: string }
  | { kind: 'extension-question'; question: import('./install').ExtensionQuestion }
  /**
   * A message of a kind a plugin brings, drawn by the view the plugin
   * registered as "<plugin>.<type>". The core doesn't look inside `data`.
   */
  | { kind: 'plugin'; plugin: string; type: string; data: unknown }
  /** The model couldn't answer. `code` is Jezo's own reason, which the window words; `text` is what the provider said. */
  | { kind: 'error'; code?: 'no-model'; text?: string }
)

export interface SessionView {
  id: string
  /** Named after the user's first message; sessions Jezo starts are named after their trigger. */
  title?: string
  trigger: Trigger
  /** The automation that started it, if one did. */
  automation?: string
  /** When it started, in milliseconds since the epoch. The window shows it in its own zone. */
  started: number
  messages: SessionMessage[]
  /** Tools registered in this live session. Hidden tools are left out. */
  tools?: string[]
  /** The agent is working. */
  running?: boolean
  pending?: { steering: string[]; followUp: string[] }
}

/** One line of a change to a file, as a diff shows it. */
export interface DiffLine {
  kind: 'add' | 'remove' | 'context'
  text: string
}

/** One run of the agent that changed files, which the user can take back (docs/design/undo.md). */
export interface HistoryEntry {
  id: string
  date: ISODate
  time: number
  /** What started the change. Explicit GUI skill removals are listed as 'you'. */
  source: Trigger | 'you'
  /** The session the change was made in. */
  session?: string
  summary: string
  /** Set when a check caught a problem with this change. */
  check?: { retries: number }
  /** The files the change touched, and how. */
  files?: { path: string; lines: DiffLine[]; note?: string }[]
  undone?: boolean
  /** The run was cut off, by Jezo quitting or crashing, before it finished: what it changed so far can still be undone. */
  interrupted?: boolean
  /** Found at launch after a shell command was cut off: what differs from before the command, which may include edits made elsewhere meanwhile. */
  found?: boolean
}

/** What undoing a change did: files left alone because someone changed them afterward. */
export interface UndoResult {
  kept: string[]
}
