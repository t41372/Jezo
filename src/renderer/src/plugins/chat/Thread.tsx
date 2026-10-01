import {
  ActionBarPrimitive, BranchPickerPrimitive, ComposerPrimitive, MessagePrimitive,
  ThreadPrimitive, useAui, useAuiState, type DataMessagePartProps, type ToolCallMessagePart,
} from '@assistant-ui/react'
import { usePiRuntimeExtras } from '@assistant-ui/react-pi'
import { ChevronLeft, ChevronRight, Copy, Pencil, RotateCcw, ArrowDown } from 'lucide-react'
import { useEffect } from 'react'
import { getMessageView } from '@/app/registry'
import { Composer } from '@/components/composer/Composer'
import { PendingMessages } from '@/components/composer/PendingMessages'
import { Disclosure } from '@/components/Disclosure'
import { ExtensionQuestionCard } from '@/components/ExtensionQuestionCard'
import { PlanCard } from '@/components/todo/PlanCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { Message, Step } from '@/data/types'
import { useTranslation } from 'react-i18next'
import { sessionHeadline } from './session'
import { ChatRuntime } from './runtime'
import { Markdown } from './Markdown'
import type { CardPart } from './projection'
import { UNCHANGED_ENTRY } from '../../../../shared/chat'

const SUGGESTIONS = ['suggestions.planNextWeek', 'suggestions.newGoal', 'suggestions.badDay'] as const
const hidden = () => null
const parts = { Text: AssistantText, Reasoning: hidden, tools: { Fallback: hidden }, data: { Fallback: CardMessage } }
const messageComponents = { UserMessage, AssistantMessage, EditComposer }

/** One conversation; assistant-ui owns message actions and scrolling. */
export function Thread() {
  const id = useStore((s) => s.sessionId)
  return (
    <ChatRuntime id={id}>
      <Conversation />
    </ChatRuntime>
  )
}

function Conversation() {
  const session = useStore((s) => s.sessions.find((x) => x.id === s.sessionId))
  const today = useStore((s) => s.now.date)
  const running = useAuiState((s) => s.thread.isRunning)
  const messages = useAuiState((s) => s.thread.messages)
  const { t } = useTranslation('chat')
  const { t: tm } = useTranslation('more')
  // An extension waiting for an answer asks below the conversation; once answered, the question shows where it was asked.
  const asking = session?.messages.filter((m) => m.kind === 'extension-question' && !m.question.answered) ?? []
  return (
    <ThreadPrimitive.Root className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ThreadPrimitive.Viewport className="flex-1 overflow-auto px-6 pt-7 pb-3">
        <div className="mx-auto flex max-w-[660px] flex-col gap-3.5">
          {session && <div className="text-center text-xs text-muted-foreground">{sessionHeadline(session, today)}</div>}
          {!!session?.tools?.length && (
            <Disclosure label={tm('install.sessionTools')}>
              <p className="px-1 py-2 text-xs leading-relaxed break-all text-muted-foreground">{session.tools.join(' · ')}</p>
            </Disclosure>
          )}
          <ThreadPrimitive.Empty>
            <Empty />
          </ThreadPrimitive.Empty>
          <ThreadPrimitive.Messages components={messageComponents} />
          {session && asking.map((m) => m.kind === 'extension-question' && <ExtensionQuestionCard key={m.question.id} session={session.id} question={m.question} />)}
          {running && !messages.some((m) => m.role === 'assistant' && m.status?.type === 'running' && m.content.some((p) => p.type === 'text' && p.text)) && (
            <div className="px-1.5 text-[12.5px] text-muted-foreground motion-safe:animate-pulse">{t('working')}</div>
          )}
          <ThreadPrimitive.ScrollToBottom asChild>
            <Button variant="ghost" size="icon" className="self-center rounded-full" aria-label={t('actions.latest')}>
              <ArrowDown />
            </Button>
          </ThreadPrimitive.ScrollToBottom>
        </div>
      </ThreadPrimitive.Viewport>
      <ChatComposer />
    </ThreadPrimitive.Root>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex flex-col gap-1.5 items-end" data-chat-message="user">
      <div className="max-w-[80%] rounded-[18px] bg-primary px-4 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground whitespace-pre-wrap" data-selectable>
        <MessagePrimitive.Parts />
      </div>
      <Actions user />
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  const content = useAuiState((s) => s.message.content)
  const calls = content.filter((p): p is ToolCallMessagePart => p.type === 'tool-call')
  const root = usePiRuntimeExtras().metadata.workspacePath
  const hasText = content.some((p) => p.type === 'text' && p.text.trim())
  const error = useAuiState((s) =>
    s.message.status?.type === 'incomplete' && s.message.status.reason === 'error' ? s.message.status.error : undefined,
  )
  // The model ran out of room, usually thinking in circles, before it answered.
  const cutOff = useAuiState((s) => s.message.status?.type === 'incomplete' && s.message.status.reason === 'length')
  const { t } = useTranslation('chat')
  return (
    <MessagePrimitive.Root className="flex flex-col gap-2" data-chat-message="assistant">
      {calls.length > 0 && (
        <Steps steps={calls.map((p) => ({ tool: p.toolName, target: toolTarget(p.args, root), error: p.isError }))} calls={calls} />
      )}
      <MessagePrimitive.Parts components={parts} />
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13.5px]" data-selectable>
          {t('error.failed', { text: String(error) })}
        </div>
      )}
      {cutOff && <div className="px-1.5 text-[12.5px] text-muted-foreground" data-cut-off>{t('error.cutOff')}</div>}
      {(hasText || calls.length > 0 || cutOff) && <Actions />}
    </MessagePrimitive.Root>
  )
}

function AssistantText() {
  return (
    <div className="rounded-[18px] border border-card-border bg-card px-4.5 py-3.5 text-[14.5px] leading-[1.7] text-pretty" data-selectable>
      <Markdown />
    </div>
  )
}

function toolTarget(args: ToolCallMessagePart['args'], root?: string) {
  for (const key of ['path', 'id', 'source']) {
    const value = args[key]
    if (typeof value === 'string') return root && key === 'path' && value.startsWith(root) ? value.slice(root.length + 1) : value
  }
  for (const key of ['todos', 'items']) if (Array.isArray(args[key])) return String(args[key].length)
  return undefined
}

function Actions({ user }: { user?: boolean }) {
  const { t } = useTranslation('chat')
  return (
    <ActionBarPrimitive.Root className="flex items-center gap-1 text-muted-foreground">
      <ActionBarPrimitive.Copy asChild>
        <Button variant="ghost" size="icon" className="size-7" aria-label={t('actions.copy')}>
          <Copy className="size-3.5" />
        </Button>
      </ActionBarPrimitive.Copy>
      {user ? (
        <ActionBarPrimitive.Edit asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('actions.edit')}>
            <Pencil className="size-3.5" />
          </Button>
        </ActionBarPrimitive.Edit>
      ) : (
        <ActionBarPrimitive.Reload asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('actions.retry')}>
            <RotateCcw className="size-3.5" />
          </Button>
        </ActionBarPrimitive.Reload>
      )}
      <BranchPickerPrimitive.Root hideWhenSingleBranch className="flex items-center gap-1 text-xs" data-branch-picker>
        <BranchPickerPrimitive.Previous asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('actions.previous')}>
            <ChevronLeft className="size-3.5" />
          </Button>
        </BranchPickerPrimitive.Previous>
        <span><BranchPickerPrimitive.Number />/<BranchPickerPrimitive.Count /></span>
        <BranchPickerPrimitive.Next asChild>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t('actions.next')}>
            <ChevronRight className="size-3.5" />
          </Button>
        </BranchPickerPrimitive.Next>
      </BranchPickerPrimitive.Root>
    </ActionBarPrimitive.Root>
  )
}

function EditComposer() {
  const { t } = useTranslation('chat')
  return (
    <ComposerPrimitive.Root className="flex flex-col gap-2 rounded-[18px] border border-card-border bg-card p-3" data-chat-edit>
      <ComposerPrimitive.Input autoFocus className="min-h-20 resize-none text-[14.5px] leading-relaxed outline-none" />
      <div className="flex gap-2 self-end">
        <ComposerPrimitive.Cancel asChild><Button variant="outline">{t('actions.cancel')}</Button></ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild><Button>{t('actions.save')}</Button></ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  )
}

function CardMessage({ name, data }: DataMessagePartProps) {
  const id = useStore((s) => s.sessionId)
  const session = useStore((s) => s.sessions.find((x) => x.id === s.sessionId))
  if (!id) return null
  if (name === 'pi-custom-message' && data.customType === 'jezo.error') return <CardView message={data.details} sessionId={id} index={-1} />
  if (name === 'pi-custom-message' && data.customType === 'jezo.extension-ui') {
    const question = session?.messages.find((m) => m.kind === 'extension-question' && m.question.id === data.details.id)
    return question?.kind === 'extension-question' && question.question.answered ? <ExtensionQuestionCard session={id} question={question.question} /> : null
  }
  if (name === 'pi-custom-message' && data.customType === UNCHANGED_ENTRY) return <Unchanged sessionId={id} />
  if (name === 'pi-custom-message' && data.customType === 'jezo.held') return <CardView message={{ kind: 'held', items: data.details.held }} sessionId={id} index={-1} />
  if (name !== 'jezo-card') return null
  const { card, entryId } = data as CardPart
  return <CardView message={card} sessionId={id} index={session?.messages.findIndex((m) => 'id' in m && m.id === entryId) ?? -1} />
}

/** Under a run that changed nothing. The button asks the agent to do what it said, without the user typing it. */
function Unchanged({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation('chat')
  const last = useAuiState((s) => s.message.isLast)
  const running = useAuiState((s) => s.thread.isRunning)
  return (
    <div className="flex items-center gap-2 px-1.5 text-[12.5px] text-muted-foreground" data-unchanged>
      {t('unchanged.text')}
      {last && !running && (
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[12.5px]" onClick={() => void window.jezo.agent.nudge(sessionId)}>
          {t('unchanged.nudge')}
        </Button>
      )}
    </div>
  )
}

function CardView({ message: m, sessionId, index }: { message: Message; sessionId: string; index: number }) {
  const { t } = useTranslation()
  const { t: tc } = useTranslation('chat')
  const { navigate, setComposer, pickChoice } = useStore.getState()
  switch (m.kind) {
    case 'held':
      // Outside content kept from the agent. The user sees what it was and where it came from.
      return (
        <div className="rounded-xl border border-card-border bg-muted px-4 py-3 text-[13px] text-pretty">
          <div className="text-muted-foreground">{tc('held.title', { count: m.items.length })}</div>
          {m.items.map((item, i) => (
            <Disclosure key={i} label={item.source} className="mt-1.5" triggerClassName="text-xs">
              <div className="pt-1.5 text-[12.5px] whitespace-pre-wrap text-muted-foreground" data-selectable>
                {item.text}
              </div>
            </Disclosure>
          ))}
        </div>
      )
    case 'error':
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13.5px]" data-selectable>
          {m.code === 'no-model' ? tc('error.noModel') : tc('error.failed', { text: m.text ?? '' })}
        </div>
      )
    case 'plan': {
      // A later card that revised this plan replaces it.
      const later = useStore.getState().sessions.find((s) => s.id === sessionId)?.messages.slice(index + 1) ?? []
      const superseded = later.some((x) => x.kind === 'plan' && x.revises?.some((id) => m.todoIds.includes(id)))
      return (
        <PlanCard
          title={m.title}
          todoIds={m.todoIds}
          changes={m.changes}
          superseded={superseded}
          onTweak={() => setComposer(t('plan.tweakPrefill'))}
          onGoToday={() => navigate('today')}
        />
      )
    }
    case 'choices':
      return (
        <div className="flex flex-wrap gap-2 px-1">
          {m.options.map((o) => (
            <Button key={o} variant="outline" className="h-8.5 rounded-full px-4 text-[13.5px] font-normal" onClick={() => pickChoice(sessionId, o)}>
              {o}
            </Button>
          ))}
        </div>
      )
    case 'plugin': {
      const View = getMessageView(`${m.plugin}.${m.type}`)
      if (View) return <View data={m.data} sessionId={sessionId} index={index} />
      return (
        <div className="rounded-xl border-[1.5px] border-dashed px-4 py-3 text-[13px] text-muted-foreground">
          {t('layout.missingMessage', { id: `${m.plugin}.${m.type}` })}
        </div>
      )
    }
    default: return null
  }
}

const LOOKING = new Set(['read', 'ls', 'todos_list', 'item_links'])
const CHANGING = new Set(['write', 'edit', 'todos_propose', 'todos_update', 'notes_propose', 'install_from_address'])

/** What the agent did, folded: "看了 3 個檔案，改了 1 個", and each step inside. */
function Steps({ steps, calls }: { steps: Step[]; calls?: ToolCallMessagePart[] }) {
  const { t } = useTranslation('chat')
  const distinct = (tools: Set<string>) => new Set(steps.filter((s) => tools.has(s.tool)).map((s) => `${s.tool === 'ls' ? 'ls' : ''}${s.target}`)).size
  const looked = distinct(LOOKING)
  const changed = distinct(CHANGING)
  const summary =
    looked && changed
      ? t('steps.lookedAndChanged', { looked, changed })
      : looked
        ? t('steps.looked', { count: looked })
        : changed
          ? t('steps.changed', { count: changed })
          : t('steps.did', { count: steps.length })
  return (
    <Disclosure label={summary} className="px-1.5" triggerClassName="text-[12.5px]">
      <div className="mt-1.5 rounded-[9px] bg-muted px-3 py-2 font-mono text-[11.5px] leading-[1.7] text-muted-foreground" data-selectable>
        {steps.map((s, i) => (
          <div key={calls?.[i]?.toolCallId ?? `${s.tool}:${s.target}`} className={s.error ? 'text-destructive' : undefined}>
            {(t as (key: string, options: object) => string)(`steps.tool.${s.tool}`, { defaultValue: s.tool })}
            {s.target && ` ${s.target}`}
            {s.error && ` · ${t('steps.refused')}`}
          </div>
        ))}
      </div>
      {calls?.map((call) => call.result !== undefined && (
        <pre key={call.toolCallId} className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted-foreground" data-tool-output>
          {typeof call.result === 'string' ? call.result : JSON.stringify(call.result, null, 2)}
        </pre>
      ))}
    </Disclosure>
  )
}

function Empty() {
  const { t } = useTranslation('chat')
  const aui = useAui()
  return (
    <div className="flex flex-col items-center gap-4 pt-[18vh] text-center">
      <p className="text-lg font-medium">{t('empty')}</p>
      <div className="flex flex-wrap justify-center gap-2">{SUGGESTIONS.map((key) => <Button key={key} variant="outline" className="h-8.5 rounded-full px-4 text-[13.5px] font-normal" onClick={() => aui.thread().append(t(key))}>{t(key)}</Button>)}</div>
    </div>
  )
}

function ChatComposer() {
  const { t } = useTranslation('chat')
  const aui = useAui()
  const text = useAuiState((s) => s.composer.text)
  const running = useAuiState((s) => s.thread.isRunning)
  const prefill = useStore((s) => s.composer)
  const extras = usePiRuntimeExtras()
  useEffect(() => {
    if (!prefill) return
    aui.composer().setText(prefill)
    useStore.setState({ composer: '' })
  }, [aui, prefill])
  return (
    <div className="px-6 pt-2.5 pb-4.5">
      <div className="mx-auto max-w-[700px]">
        <PendingMessages pending={extras.queue} onTakeBack={async () => {
          const cleared = await extras.clearQueue()
          aui.composer().setText([text, ...cleared.steering, ...cleared.followUp].filter(Boolean).join('\n\n'))
        }} />
        <Composer
          value={text}
          onChange={(value) => aui.composer().setText(value)}
          onSubmit={() => aui.composer().send({ steer: false })}
          onSteer={() => aui.composer().send({ steer: true })}
          onStop={() => aui.thread().cancelRun()}
          running={running}
          placeholder={t('placeholder')}
          autoFocus
          attach
          commands={window.jezo.agent.commands}
          onNew={() => useStore.getState().openSession(null)}
        />
      </div>
    </div>
  )
}
