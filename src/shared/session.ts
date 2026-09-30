// Conversations with Jezo's agent as the windows draw them. The main process
// builds them from pi's session files (docs/design/backend.md, "Sessions").

/** A date without a time, like "2026-09-29". */
export type ISODate = string

/** What started a session, or made a change. */
export type Trigger = 'morning' | 'evening' | 'weekly' | 'hotkey' | 'user' | 'notes'

/** One thing the agent did with a tool: the tool's name and the file or item it touched. */
export interface Step {
  tool: string
  target?: string
  /** The tool failed, or a check refused what it wrote. */
  error?: boolean
}

export type SessionMessage =
  | { kind: 'user'; text: string }
  /** What the agent said. `streaming` while it's still being written. */
  | { kind: 'agent'; text: string; streaming?: boolean }
  /** What the agent looked at or changed, folded away by default. */
  | { kind: 'steps'; steps: Step[] }
  /** A plan the agent proposed. Its todos are drafts until accepted. */
  | { kind: 'plan'; title: string; todoIds: string[] }
  /** A question with answers to pick from. The answer the user picked follows as their message. */
  | { kind: 'choices'; options: string[]; picked?: string }
  /**
   * A message of a kind a plugin brings, drawn by the view the plugin
   * registered as "<plugin>.<type>". The core doesn't look inside `data`.
   */
  | { kind: 'plugin'; plugin: string; type: string; data: unknown }
  /** The model couldn't answer. `code` is Jezo's own reason, which the window words; `text` is what the provider said. */
  | { kind: 'error'; code?: 'no-model'; text?: string }

export interface SessionView {
  id: string
  /** Named after the user's first message; sessions Jezo starts are named after their trigger. */
  title?: string
  trigger: Trigger
  date: ISODate
  /** Hours from midnight. */
  time: number
  messages: SessionMessage[]
  /** The agent is working. */
  running?: boolean
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
  /** Who made the change. Only the agent's own changes are listed, since only they can be undone. */
  source: Trigger | 'you'
  /** The session the change was made in. */
  session?: string
  summary: string
  /** Set when a check caught a problem with this change. */
  check?: { level: 'warn'; retries: number } | { level: 'error'; kind: 'claimed-without-change' }
  /** The files the change touched, and how. */
  files?: { path: string; lines: DiffLine[]; note?: string }[]
  undone?: boolean
}

/** What undoing a change did: files left alone because someone changed them afterward. */
export interface UndoResult {
  kept: string[]
}
