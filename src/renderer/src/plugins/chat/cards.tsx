// Richer messages in a conversation: reworking a bad day, and what a session
// is about to remember.

import { cn } from 'cn'
import { Check } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { reworkPlans, type ReworkItem } from '@/data/mock'
import { goalById, useStore } from '@/data/store'
import type { Energy, Message } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'
import { easeOut } from '@/lib/motion'

const ENERGIES: Energy[] = ['low', 'some', 'plenty']

export function ReworkCard({ message, sessionId, index }: { message: Extract<Message, { kind: 'rework' }>; sessionId: string; index: number }) {
  const { t } = useTranslation('chat')
  const { chooseEnergy, applyRework, undoRework, navigate } = useStore.getState()
  const plan = message.energy && reworkPlans[message.energy]
  // The draft appears below the choices, likely below the fold; bring it into view.
  const draft = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (message.energy) draft.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [message.energy])

  if (message.applied) {
    return (
      <Card className="flex-row items-center gap-2.5 px-4 py-3 text-[13px]">
        <Check className="size-4 text-ok" />
        <span className="font-medium">{t('rework.applied')}</span>
        <span className="text-muted-foreground">{t('rework.recorded')}</span>
        <span className="flex-1" />
        <button onClick={() => undoRework(sessionId, index)} className="text-muted-foreground hover:text-foreground transition-colors duration-150">
          {t('rework.undo')}
        </button>
        <button onClick={() => navigate('today')} className="font-medium hover:underline transition-colors duration-150">
          {t('rework.goToday')}
        </button>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2">
        {ENERGIES.map((e) => (
          <button
            key={e}
            onClick={() => chooseEnergy(sessionId, index, e)}
            aria-pressed={message.energy === e}
            className={cn(
              'pressable flex flex-col gap-1 rounded-xl border px-3.5 py-3 text-left',
              message.energy === e ? 'border-foreground bg-card' : 'border-card-border bg-muted hover:bg-card',
            )}
          >
            <span className="text-[13.5px] font-medium">{t(`rework.energy.${e}.title`)}</span>
            <span className="text-xs text-muted-foreground">{t(`rework.energy.${e}.hint`)}</span>
          </button>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {plan && (
          <motion.div
            key={message.energy}
            initial={{ opacity: 0, transform: 'translateY(6px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: easeOut }}
            onAnimationComplete={() => draft.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            ref={draft}
          >
            <Card variant="draft" className="gap-3 px-4 py-3.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{t('rework.draft')}</span>
                <span className="text-xs text-muted-foreground">{t('rework.untilYouSay')}</span>
              </div>
              <ReworkGroup label={t('rework.keep')} items={plan.keep} />
              <ReworkGroup label={t('rework.move')} items={plan.move} />
              <ReworkGroup label={t('rework.drop')} items={plan.drop} dropped />
              <p className="text-xs text-muted-foreground">{t('rework.recorded')}</p>
              <div className="flex gap-2">
                <Button onClick={() => applyRework(sessionId, index)}>{t('rework.apply')}</Button>
                <Button variant="outline" onClick={() => navigate('today')}>
                  {t('rework.edit')}
                </Button>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ReworkGroup({ label, items, dropped }: { label: string; items: ReworkItem[]; dropped?: boolean }) {
  const todos = useStore((s) => s.todos)
  const goals = useStore((s) => s.goals)
  if (!items.length) return null
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => {
          const goal = goalById(goals, todos.find((t) => t.id === item.todoId)?.goalId ?? null)
          return (
            <li key={item.todoId} className="flex items-center gap-2.5 text-[13.5px]" style={goalStyle(goal?.hue)}>
              <span className="size-2 shrink-0 rounded-[3px] bg-goal" />
              <span className={cn('flex-1', dropped && 'text-muted-foreground line-through')}>{item.title}</span>
              <span className="text-xs text-muted-foreground">{item.note}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function MemoryPreviewCard({
  message: m,
  sessionId,
  index,
}: {
  message: Extract<Message, { kind: 'memory-preview' }>
  sessionId: string
  index: number
}) {
  const { t } = useTranslation('chat')
  const save = useStore((s) => s.saveMemoryPreview)
  return (
    <Card className="gap-3 px-4 py-3.5 text-[13.5px]">
      <div className="text-sm font-semibold">{t('memoryPreview.title')}</div>
      <Section label={t('memoryPreview.stated')} items={m.stated} />
      {m.skipped.length > 0 && (
        <div>
          <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">{t('memoryPreview.skipped')}</div>
          <ul className="flex flex-col gap-1">
            {m.skipped.map((s) => (
              <li key={s.text} className="flex gap-2.5 text-muted-foreground">
                <span className="flex-1 line-through">{s.text}</span>
                <span className="text-xs">{s.why}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Section label={t('memoryPreview.plan')} items={m.plan} />
      {m.saved ? (
        <div className="flex items-center gap-1.5 text-xs text-ok">
          <Check className="size-3.5" />
          {t('memoryPreview.saved')}
        </div>
      ) : (
        <Button className="self-start" onClick={() => save(sessionId, index)}>
          {t('memoryPreview.save')}
        </Button>
      )}
    </Card>
  )
}

function Section({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <ul className="flex flex-col gap-1">
        {items.map((text) => (
          <li key={text} data-selectable>
            {text}
          </li>
        ))}
      </ul>
    </div>
  )
}
