import { AssistantRuntimeProvider, useExternalStoreRuntime, type AssistantRuntime, type AppendMessage, type ExternalThreadQueueAdapter, type ThreadMessage } from '@assistant-ui/react'
import { usePiRuntime, usePiRuntimeExtras, usePiThreadState, piQueueItemId } from '@assistant-ui/react-pi'
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useStore } from '@/data/store'
import { chatClient } from './client'
import { projectLive, projectTree } from './projection'

const failed = (error: unknown) => toast(String(error instanceof Error ? error.message : error))

/** Pi owns delivery and run state. Jezo adds the session tree the adapter lacks. */
export function ChatRuntime({ id, children }: { id: string | null; children: ReactNode }) {
  const runtime = usePiRuntime({
    client: chatClient.client,
    ...(id && { threadId: id }),
    onThreadIdChange: (opened) => { if (!id && opened) useStore.setState({ sessionId: opened, composer: '' }) },
    onError: failed,
  })
  useEffect(() => {
    if (!id) void runtime.threads.switchToNewThread()
  }, [id, runtime])
  // Keep Pi's runtime alive when the first send gives a new thread its ID.
  // Remount only the presentation runtime and composer on session changes.
  return <AssistantRuntimeProvider runtime={runtime}><SessionRuntime key={id ?? 'new'} id={id} pi={runtime}>{children}</SessionRuntime></AssistantRuntimeProvider>
}

function SessionRuntime({ id, pi, children }: { id: string | null; pi: AssistantRuntime; children: ReactNode }) {
  const state = usePiThreadState()
  const extras = usePiRuntimeExtras()
  const tree = useSyncExternalStore(chatClient.subscribeTree, () => chatClient.tree(id ?? ''), () => chatClient.tree(id ?? ''))
  const saved = useMemo(() => projectTree(tree), [tree])
  const switching = Boolean(id && id !== state.threadId)
  const repository = useMemo(() => projectLive(saved, switching ? { ...state, messages: [] } : state), [saved, state, switching])
  const hostRunning = useStore((s) => s.sessions.find((session) => session.id === id)?.running ?? false)
  // Pi 0.99 can continue after agent_end. AgentHost waits for agent_settled
  // and finishes undo before releasing the run.
  const running = hostRunning || state.runStatus === 'running' || state.retry.active || state.compaction.active

  // react-pi follows a running thread. Idle automation runs can start in main.
  useEffect(() => {
    if (!id) return
    return chatClient.client.subscribe(id, (event) => {
      if (event.type === 'snapshot' || (event.type === 'agent_start' && state.runStatus !== 'running')) void extras.refresh().catch(failed)
    }, { includeSnapshot: false })
  }, [id, extras.refresh, state.runStatus])

  const textOf = (message: AppendMessage) => message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n')
  const deliver = (message: AppendMessage, steer: boolean) => {
    pi.thread.composer.setText(textOf(message))
    pi.thread.composer.send({ steer })
  }
  const queue = useMemo<ExternalThreadQueueAdapter>(() => ({
    items: extras.queue.followUp.map((prompt, i) => ({ id: piQueueItemId('followUp', i), prompt, parts: [{ type: 'text', text: prompt }] })),
    steerItems: extras.queue.steering.map((prompt, i) => ({ id: piQueueItemId('steer', i), prompt, parts: [{ type: 'text', text: prompt }] })),
    enqueue: (message) => deliver(message, false),
    steer: (message) => deliver(message, true),
    move: () => {}, edit: () => {}, remove: () => {},
  }), [pi, extras.queue])
  const branch = async (operation: () => Promise<void>) => {
    try { await operation(); await extras.refresh() } catch (error) { failed(error); throw error }
  }
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    isLoading: switching || state.loadState === 'loading', isRunning: running,
    isSendDisabled: switching,
    unstable_persistsHistory: true,
    messageRepository: repository,
    extras,
    queue: id ? queue : undefined,
    onNew: async (message) => { deliver(message, false) },
    onCancel: async () => { pi.thread.cancelRun() },
    onEdit: async (message) => {
      if (id && message.sourceId) await branch(() => window.jezo.agent.pi.edit(id, message.sourceId!, textOf(message)))
    },
    onReload: async (parentId) => {
      if (id) await branch(() => window.jezo.agent.pi.retry(id, parentId))
    },
    // assistant-ui switches locally first. The callback selects that same path
    // in pi, and the authoritative snapshot follows in both windows.
    setMessages: () => {},
    unstable_onBranchChange: ({ headId }) => {
      const node = repository.messages.find(({ message }) => message.id === headId)
      const leafId = node?.message.metadata.custom.leafId
      if (id && typeof leafId === 'string') void branch(() => window.jezo.agent.pi.navigate(id, leafId)).catch(() => {})
    },
  })
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>
}
