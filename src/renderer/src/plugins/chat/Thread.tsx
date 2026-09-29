import { Mic, Plus } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { getMessageView } from '@/app/registry'
import { Disclosure } from '@/components/Disclosure'
import { PlanCard } from '@/components/todo/PlanCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { Message } from '@/data/types'
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
            </>
          ) : (
            <Empty />
          )}
        </div>
      </div>
      <Composer />
    </div>
  )
}

function MessageView({ message: m, sessionId, index }: { message: Message; sessionId: string; index: number }) {
  const { t } = useTranslation()
  const { navigate, setComposer, pickChoice } = useStore.getState()
  switch (m.kind) {
    case 'agent':
      return (
        <div className="rounded-[18px] border border-card-border bg-card px-4.5 py-3.5 text-[14.5px] leading-[1.7] text-pretty" data-selectable>
          {m.text}
        </div>
      )
    case 'user':
      return (
        <div className="max-w-[80%] self-end rounded-[18px] bg-primary px-4 py-2.5 text-[14.5px] leading-relaxed text-primary-foreground" data-selectable>
          {m.text}
        </div>
      )
    case 'steps':
      return (
        <Disclosure label={m.summary} className="px-1.5" triggerClassName="text-[12.5px]">
          <div className="mt-1.5 rounded-[9px] bg-muted px-3 py-2 font-mono text-[11.5px] leading-[1.7] text-muted-foreground" data-selectable>
            {m.lines.map((l) => (
              <div key={l}>{l}</div>
            ))}
          </div>
        </Disclosure>
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

function Composer() {
  const { t } = useTranslation('chat')
  const text = useStore((s) => s.composer)
  const sessionId = useStore((s) => s.sessionId)
  const { setComposer, send } = useStore.getState()
  const input = useRef<HTMLTextAreaElement>(null)

  // Focus when a conversation opens or someone prefills the box.
  useEffect(() => {
    input.current?.focus()
  }, [sessionId, text === ''])

  const submit = () => {
    const t = text.trim()
    if (t) send(t)
  }

  return (
    <div className="px-6 pt-2.5 pb-4.5">
      <div className="mx-auto flex max-w-[700px] items-end gap-3 rounded-[26px] border border-card-border bg-card py-2 pr-2.5 pl-3 shadow-[0_4px_16px_rgb(10_14_40/0.06)]">
        <Button variant="ghost" size="icon" className="size-9 rounded-full text-muted-foreground" aria-label={t('attach')}>
          <Plus className="size-5" />
        </Button>
        <textarea
          ref={input}
          rows={1}
          value={text}
          onChange={(e) => setComposer(e.target.value)}
          onKeyDown={(e) => {
            // Enter while an input method is composing picks a candidate; it must not send.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={t('placeholder')}
          className="max-h-40 flex-1 resize-none self-center bg-transparent py-1.5 text-[14.5px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <Button variant="ghost" size="icon" className="size-9 rounded-full text-muted-foreground" aria-label={t('voice')}>
          <Mic className="size-[18px]" />
        </Button>
      </div>
    </div>
  )
}
