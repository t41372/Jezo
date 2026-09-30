// Electron transport for react-pi. AgentHost owns every session and run.
import type { PiClient, PiClientEvent } from '@assistant-ui/react-pi'
import type { ChatSnapshot, ChatTree } from '../../../../shared/chat'

const EMPTY_TREE: ChatTree = { entries: [], leafId: null }

export function createChatClient() {
  const bridge = window.jezo.agent.pi
  const trees = new Map<string, ChatTree>()
  const sequences = new Map<string, number>()
  const listeners = new Set<() => void>()
  const subscribers = new Map<string, Set<(event: PiClientEvent) => void>>()
  const notify = () => { for (const listener of listeners) listener() }
  const remember = (snapshot: ChatSnapshot) => {
    const id = snapshot.metadata.id
    if ((snapshot.seq ?? 0) < (sequences.get(id) ?? 0)) return
    sequences.set(id, snapshot.seq ?? 0)
    trees.set(id, snapshot.tree)
    notify()
  }
  const off = bridge.onEvent((event) => {
    if (event.type === 'snapshot') remember(event.snapshot as ChatSnapshot)
    if (event.type === 'entry_appended') {
      sequences.set(event.threadId, event.seq)
      const tree = trees.get(event.threadId) ?? EMPTY_TREE
      if (!tree.entries.some((entry) => entry.id === event.entry.id)) {
        trees.set(event.threadId, { entries: [...tree.entries, event.entry], leafId: event.entry.id })
        notify()
      }
    }
    for (const listener of subscribers.get(event.threadId) ?? []) listener(event)
  })
  const client: PiClient = {
    ...bridge,
    getThread: async (id) => {
      const snapshot = await bridge.getThread(id)
      remember(snapshot)
      return snapshot
    },
    createThread: async (input) => {
      const snapshot = await bridge.createThread(input)
      remember(snapshot)
      return snapshot
    },
    subscribe: (id, listener, options) => {
      const set = subscribers.get(id) ?? new Set()
      subscribers.set(id, set)
      set.add(listener)
      let active = true
      if (options?.includeSnapshot !== false) {
        void client.getThread(id).then((snapshot) => {
          if (active) listener({ type: 'snapshot', snapshot, threadId: id, seq: snapshot.seq ?? 0 })
        })
      }
      return () => { active = false; set.delete(listener) }
    },
  }
  return {
    client,
    tree: (id: string) => trees.get(id) ?? EMPTY_TREE,
    subscribeTree: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    dispose: off,
  }
}

export type ChatClient = ReturnType<typeof createChatClient>

// One subscription for this renderer window, including idle automation threads.
export const chatClient = createChatClient()
