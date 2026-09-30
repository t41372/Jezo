// Pi's browser-safe contract, with the session tree Jezo keeps beside it.
import type { PiAnySessionEntry, PiClient, PiClientEvent, PiThreadSnapshot } from '@assistant-ui/react-pi'

/** A run that changed nothing: no file, and nothing outside the workspace (docs/design/frontend.md, "Chat"). */
export const UNCHANGED_ENTRY = 'jezo.unchanged'
const QUESTION_ENTRY = 'jezo.extension-ui'

/**
 * Custom entries pi keeps out of the model's context that the chat still shows.
 * An extension's question is written again when it's answered: its first entry
 * shows as a card where it was asked, and the card reads the latest state.
 */
export function shownCustom(entry: PiAnySessionEntry, asked: Set<string>) {
  if (entry.type !== 'custom') return null
  const shown = (details: unknown) => ({ role: 'custom' as const, customType: entry.customType, content: '', display: true, details, timestamp: new Date(entry.timestamp).getTime() })
  if (entry.customType === UNCHANGED_ENTRY) return shown({})
  if (entry.customType !== QUESTION_ENTRY) return null
  const id = (entry.data as { id: string }).id
  if (asked.has(id)) return null
  asked.add(id)
  return shown({ id })
}

export interface ChatTree {
  entries: PiAnySessionEntry[]
  leafId: string | null
}

export interface ChatSnapshot extends PiThreadSnapshot {
  tree: ChatTree
}

export type ChatBridge = Omit<PiClient, 'subscribe' | 'getThread' | 'createThread'> & {
  getThread(id: string): Promise<ChatSnapshot>
  createThread(input?: Parameters<PiClient['createThread']>[0]): Promise<ChatSnapshot>
  edit(id: string, entryId: string, text: string): Promise<void>
  retry(id: string, userEntryId: string | null): Promise<void>
  navigate(id: string, leafId: string): Promise<void>
  onEvent(listener: (event: PiClientEvent) => void): () => void
}
