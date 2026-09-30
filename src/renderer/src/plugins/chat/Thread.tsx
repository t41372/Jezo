import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { getMessageView } from '@/app/registry'
import { Composer } from '@/components/composer/Composer'
import { Disclosure } from '@/components/Disclosure'
import { PlanCard } from '@/components/todo/PlanCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { Message, Step } from '@/data/types'
import { useTranslation } from 'react-i18next'
import { easeOut } from '@/lib/motion'
import { MemoryPreviewCard, ReworkCard } from './cards'
import { sessionHeadline } from './session'

const SUGGESTIONS = ['suggestions.planNextWeek', 'suggestions.newGoal', 'suggestions.badDay'] as const

/** One conversation and the box to reply in. */
export function Thread() {
  const session = useStore((s) => s.sessions.find((x) => x.id === s.sessionId))
  const today = useStore((s) => s.now.date)
  const scroller = useRef<HTMLDivElement>(null)
  const count = session?.messages.length ?? 0

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [count])

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scroller} className="flex-1 overflow-auto px-6 pt-7 pb-3">
        <div className="mx-auto flex max-w-[660px] flex-col gap-3.5">
          {session ? (
            <>
              <div className="text-center text-xs text-muted-foreground">{sessionHeadline(session, today)}</div>
              {/* Keyed by session so switching conversations doesn't animate the whole history in. */}
              <AnimatePresence key={session.id} initial={false}>
                {session.messages.map((m, i) =>
                  // Answered choices disappear; the answer shows as the user's message.
                  m.kind === 'choices' && m.picked ? null : (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, transform: 'translateY(8px)' }}
                      animate={{ opacity: 1, transform: 'translateY(0px)' }}
                      transition={{ duration: 0.22, ease: easeOut }}
                      className="flex flex-col"
                    >
                      <MessageView message={m} sessionId={session.id} index={i} />
                    </motion.div>
                  ),
                )}
              </AnimatePresence>
              {session.running && !session.messages.some((m) => m.kind === 'agent' && m.streaming) && <Working />}
            </>
          ) : (
            <Empty />
          )}
        </div>
      </div>
      <ChatComposer />
    </div>
  )
}

function MessageView({ message: m, sessionId, index }: { message: Message; sessionId: string; index: number }) {
  const { t } = useTranslation()
  const { t: tc } = useTranslation('chat')
  const { navigate, setComposer, pickChoice } = useStore.getState()
  switch (m.kind) {
    case 'agent':
      return (
        <div className="rounded-[18px] border border-card-border bg-card px-4.5 py-3.5 text-[14.5px] leading-[1.7] text-pretty whitespace-pre-wrap" data-selectable>
          {m.text.trim()}
        </div>
      )
    case 'user':
      return (
        <div className="max-w-[80%] self-end rounded-[18px] bg-primary px-4 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground" data-selectable>
          {m.text}
        </div>
      )
    case 'steps':
      return <Steps steps={m.steps} />
    case 'error':
      return (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13.5px] text-pretty" data-selectable>
          {m.code === 'no-model' ? tc('error.noModel') : tc('error.failed', { text: m.text ?? '' })}
        </div>
      )
    case 'plan':
      return <PlanCard title={m.title} todoIds={m.todoIds} onTweak={() => setComposer(t('plan.tweakPrefill'))} onGoToday={() => navigate('today')} />
    case 'choices':
      return (
        <div className="flex flex-wrap gap-2 px-1">
          {m.options.map((o) => (
            <Button key={o} variant="outline" className="h-8.5 rounded-full px-4 text-[13.5px] font-normal" onClick={() => pickChoice(sessionId, index, o)}>
              {o}
            </Button>
          ))}
        </div>
      )
    case 'rework':
      return <ReworkCard message={m} sessionId={sessionId} index={index} />
    case 'memory-preview':
      return <MemoryPreviewCard message={m} sessionId={sessionId} index={index} />
    case 'memory':
      return (
        <div className="flex items-center gap-2 px-1.5 text-[12.5px] text-muted-foreground">
          <span className="size-1.5 rounded-full bg-ok" />
          {m.text}
        </div>
      )
    case 'plugin': {
      // A plugin's own kind of message, drawn by the view it registered. If the plugin is gone, say so.
      const View = getMessageView(`${m.plugin}.${m.type}`)
      if (View) return <View data={m.data} sessionId={sessionId} index={index} />
      return (
        <div className="rounded-xl border-[1.5px] border-dashed px-4 py-3 text-[13px] text-muted-foreground">
          {t('layout.missingMessage', { id: `${m.plugin}.${m.type}` })}
        </div>
      )
    }
  }
}

const LOOKING = new Set(['read', 'ls', 'todos_list'])
const CHANGING = new Set(['write', 'edit', 'todos_propose', 'todos_update', 'notes_propose'])

/** What the agent did, folded: "看了 3 個檔案，改了 1 個", and each step inside. */
function Steps({ steps }: { steps: Step[] }) {
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
          <div key={i} className={s.error ? 'text-destructive' : undefined}>
            {(t as (key: string, options: object) => string)(`steps.tool.${s.tool}`, { defaultValue: s.tool })}
            {s.target && ` ${s.target}`}
            {s.error && ` · ${t('steps.refused')}`}
          </div>
        ))}
      </div>
    </Disclosure>
  )
}

/** While the agent works and hasn't said anything yet. */
function Working() {
  const { t } = useTranslation('chat')
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay: 0.3, ease: easeOut }}
      className="px-1.5 text-[12.5px] text-muted-foreground motion-safe:animate-pulse"
    >
      {t('working')}
    </motion.div>
  )
}

function Empty() {
  const { t } = useTranslation('chat')
  const send = useStore((s) => s.send)
  return (
    <div className="flex flex-col items-center gap-4 pt-[18vh] text-center">
      <p className="text-lg font-medium">{t('empty')}</p>
      <div className="flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((key) => (
          <Button key={key} variant="outline" className="h-8.5 rounded-full px-4 text-[13.5px] font-normal" onClick={() => send(t(key))}>
            {t(key)}
          </Button>
        ))}
      </div>
    </div>
  )
}

function ChatComposer() {
  const { t } = useTranslation('chat')
  const text = useStore((s) => s.composer)
  const sessionId = useStore((s) => s.sessionId)
  const running = useStore((s) => s.sessions.find((x) => x.id === s.sessionId)?.running ?? false)
  const { setComposer, send, stop } = useStore.getState()
  return (
    <div className="px-6 pt-2.5 pb-4.5">
      {/* Keyed so opening another conversation, or a prefilled message, focuses the box. */}
      <Composer
        key={`${sessionId}`}
        value={text}
        onChange={setComposer}
        onSubmit={(t) => send(t)}
        onStop={stop}
        running={running}
        placeholder={t('placeholder')}
        autoFocus
        attach
        className="mx-auto max-w-[700px]"
      />
    </div>
  )
}
