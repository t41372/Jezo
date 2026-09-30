// react-pi supplies content/status projection; Jezo supplies entry identity,
// branches and the cards its tools return. Keep the adapter's index IDs here.
import { ExportedMessageRepository, type ThreadMessageLike } from '@assistant-ui/react'
import { projectPiThreadMessages, type PiAgentMessage, type PiThreadState, type PiToolResultMessage, type PiUserMessage } from '@assistant-ui/react-pi'
import { shownCustom, type ChatTree } from '../../../../shared/chat'
import type { SessionMessage } from '../../../../shared/session'

export type IdentifiedMessage = PiAgentMessage & { jezoEntryId?: string; jezoLeafId?: string }
export type CardPart = { card: SessionMessage; entryId: string }

const userText = (m: PiAgentMessage) => {
  const content = (m as PiUserMessage).content
  return typeof content === 'string' ? content : content.filter((p) => p.type === 'text').map((p) => p.text).join('\n')
}

const visible = (m: PiAgentMessage) => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult' || (m.role === 'custom' && m.display === true)
const identityKey = (m: PiAgentMessage) => m.role === 'toolResult'
  ? `tool:${(m as PiToolResultMessage).toolCallId}`
  : `${m.role}:${m.timestamp}`

function project(messages: IdentifiedMessage[], state?: PiThreadState, aliases = new Map<string, string>()) {
  const canonical = messages.filter(visible)
  const results = new Map<string, { card: SessionMessage; entryId: string; picked?: boolean }>()
  canonical.forEach((m, i) => {
    if (m.role !== 'toolResult' || m.isError) return
    const details = m.details as { card?: SessionMessage; held?: { source: string; text: string }[] } | undefined
    // Outside content a tool kept from the agent shows as its own card (docs/design/backend.md, "Outside content").
    const card = details?.card ?? (details?.held?.length ? { kind: 'held' as const, items: details.held } : undefined)
    if (!card) return
    const picked = card.kind === 'choices' && canonical.slice(i + 1).some((next) => next.role === 'user' && card.options.includes(userText(next)))
    results.set(m.toolCallId as string, { card, entryId: m.jezoEntryId!, picked })
  })
  const projected = projectPiThreadMessages({
    messages: canonical,
    toolExecutions: state?.toolExecutions ?? {},
    runStatus: state?.runStatus ?? 'idle',
    hostUiRequests: state?.hostUiRequests ?? [],
  })
  let userEntryId: string | undefined
  return projected.map((message): ThreadMessageLike => {
    const index = Number(message.id!.slice('pi-msg:'.length))
    const source = canonical[index]
    const entryId = source.jezoEntryId ?? `live:${source.role}:${source.timestamp}`
    const id = aliases.get(entryId) ?? entryId
    if (source.role === 'user') userEntryId = id
    let end = index
    if (source.role === 'assistant') {
      while (end + 1 < canonical.length && ['assistant', 'toolResult'].includes(canonical[end + 1].role)) end++
    }
    const content = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : message.content
    return {
      ...message, id,
      content: content.flatMap<Exclude<ThreadMessageLike['content'], string>[number]>((part) => {
        if (part.type !== 'tool-call') return [part]
        const result = results.get(part.toolCallId ?? '')
        return result && !result.picked ? [part, { type: 'data' as const, name: 'jezo-card', data: { card: result.card, entryId: result.entryId } }] : [part]
      }),
      metadata: { ...message.metadata, custom: {
        ...message.metadata?.custom,
        entryId, userEntryId,
        leafId: source.jezoLeafId ?? canonical[end]?.jezoEntryId ?? entryId,
      } },
    }
  })
}

/** Project each saved path once; share its nodes in assistant-ui's repository. */
export function projectTree(tree: ChatTree) {
  const byId = new Map(tree.entries.map((entry) => [entry.id, entry]))
  const parents = new Set(tree.entries.map((entry) => entry.parentId))
  const leaves = tree.entries.filter((entry) => !parents.has(entry.id))
  const paths = leaves.map((leaf) => {
    const path = []
    let entry: typeof leaf | undefined = leaf
    while (entry) { path.push(entry); entry = entry.parentId ? byId.get(entry.parentId) : undefined }
    return path.reverse()
  })
  const aliases = new Map<string, string>()
  const identities = new Map<string, string>()
  const nodes = new Map<string, { message: ThreadMessageLike; parentId: string | null }>()
  for (const path of paths) {
    const asked = new Set<string>()
    let retryUser: string | undefined
    const messages: IdentifiedMessage[] = []
    for (const entry of path) {
      if (entry.type === 'custom' && entry.customType === 'jezo.retry') retryUser = (entry.data as { userEntryId: string }).userEntryId
      const m = entry.type === 'message' ? entry.message as PiAgentMessage
        : entry.type === 'custom_message' ? { ...entry, role: 'custom', timestamp: new Date(entry.timestamp).getTime() } as PiAgentMessage
        : shownCustom(entry, asked) as PiAgentMessage | null
      if (!m) continue
      identities.set(identityKey(m), entry.id)
      if (m.role === 'user' && retryUser) {
        aliases.set(entry.id, aliases.get(retryUser) ?? retryUser)
        retryUser = undefined
      }
      messages.push({ ...m, jezoEntryId: entry.id })
    }
    let parentId: string | null = null
    for (const message of project(messages, undefined, aliases)) {
      nodes.set(message.id!, { message, parentId })
      parentId = message.id!
    }
    // Branch switching must restore the continuation, including hidden entries.
    if (parentId) {
      const node = nodes.get(parentId)!
      node.message.metadata!.custom!.leafId = path.at(-1)!.id
    }
  }
  return { nodes, aliases, identities }
}

export function projectLive(saved: ReturnType<typeof projectTree>, state: PiThreadState) {
  const messages = state.messages.map((m) => {
    const id = (m as IdentifiedMessage).jezoEntryId
    // Pi's reducer doesn't replace a tool result on message_end. Resolve its
    // temporary ID as soon as its entry arrives, including parallel results.
    const persistedId = saved.identities.get(identityKey(m))
    return { ...m, jezoEntryId: m.role === 'toolResult' ? persistedId ?? id : id ?? persistedId }
  })
  const live = project(messages, state, saved.aliases)
  const nodes = new Map(saved.nodes)
  let parentId: string | null = null
  for (const message of live) {
    // Saved leaves may have hidden entries after the final visible message.
    const savedLeaf = nodes.get(message.id!)?.message.metadata?.custom?.leafId
    if (savedLeaf && message === live.at(-1) && state.runStatus !== 'running') message.metadata!.custom!.leafId = savedLeaf
    nodes.set(message.id!, { message, parentId })
    parentId = message.id!
  }
  return ExportedMessageRepository.fromBranchableArray([...nodes.values()], { headId: parentId })
}
