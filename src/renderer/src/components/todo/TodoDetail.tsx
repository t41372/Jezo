import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/Disclosure'
import { goalById, useStore } from '@/data/store'
import type { CalendarEvent, Todo } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'
import { useTranslation } from 'react-i18next'
import { easeOut } from '@/lib/motion'
import { addDays, clock, duration, longDate, monthDay, weekday } from '@/lib/time'
import { offerUndo } from '@/lib/undo'
import { slotLabel, whenLabel } from './format'
import { Related } from './Related'

/** Everything about one todo, and what you can do with it. */
export function TodoDetail({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  const { t } = useTranslation()
  const goal = useStore((s) => goalById(s.goals, todo.goalId))
  const { accept, discard, confirmSlot, moveTodo, setDone, openSession, restoreTodo, toggleSubtask } = useStore.getState()
  const discardDraft = () => {
    discard(todo.id)
    offerUndo(t('undo.discarded', { title: todo.title }), () => restoreTodo(todo))
  }
  const unschedule = () => {
    moveTodo(todo.id, null)
    offerUndo(t('undo.unscheduled', { title: todo.title }), () => restoreTodo(todo))
  }
  const draftTodo = todo.state === 'draft'
  const proposedSlot = !draftTodo && !!todo.slot?.proposed

  return (
    <div className="flex h-full flex-col gap-4" style={goalStyle(goal?.hue)}>
      <div className="flex items-center gap-2">
        <span className="rounded-md bg-goal-tint px-2.5 py-0.5 text-[11.5px] font-medium text-goal-deep">
          {goal?.name ?? t('todo.noGoal')}
        </span>
        <span className="flex-1" />
        <CloseButton onClick={onClose} />
      </div>

      <h2 className="text-[19px] leading-snug font-semibold" data-selectable>
        {todo.title}
      </h2>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13.5px]">
        <dt className="text-muted-foreground">{t('todo.when')}</dt>
        <dd>{whenLabel(todo)}</dd>
        <dt className="text-muted-foreground">{t('todo.slot')}</dt>
        <dd>{slotLabel(todo)}</dd>
        <dt className="text-muted-foreground">{t('todo.estimate')}</dt>
        <dd>{duration(todo.estimateMinutes)}</dd>
      </dl>

      {(draftTodo || proposedSlot) && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-draft bg-draft-bg p-3">
          {todo.why && <p className="text-[13px] leading-relaxed text-pretty">{todo.why}</p>}
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => (draftTodo ? accept([todo.id]) : confirmSlot(todo.id))}>
              {draftTodo ? t('todo.accept') : t('todo.acceptTime')}
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={draftTodo ? discardDraft : unschedule}>
              {t('todo.reject')}
            </Button>
          </div>
        </div>
      )}

      {todo.subtasks && (
        <ul className="flex flex-col gap-1 text-[13.5px]" aria-label={t('todo.subtasks')}>
          {todo.subtasks.map((sub, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-center gap-2.5 py-0.5">
                <CheckboxPrimitive.Root
                  checked={sub.done}
                  onCheckedChange={() => toggleSubtask(todo.id, i)}
                  className="flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border text-white transition-[background-color,border-color] duration-150 ease-out data-checked:border-goal data-checked:bg-goal"
                >
                  <CheckboxPrimitive.Indicator>
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </CheckboxPrimitive.Indicator>
                </CheckboxPrimitive.Root>
                <span className={sub.done ? 'text-muted-foreground line-through' : undefined}>{sub.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {!draftTodo && !proposedSlot && todo.why && <Why text={todo.why} />}

      <Related id={todo.id} links={todo.links} exclude={todo.goalId ? [todo.goalId] : []} />

      <div className="flex-1" />

      <div className="flex flex-wrap gap-1.5">
        {!draftTodo && (
          <Button size="sm" onClick={() => setDone(todo.id, todo.state !== 'done')}>
            {todo.state === 'done' ? t('todo.markUndone') : t('todo.markDone')}
          </Button>
        )}
        {todo.slot && !todo.fromCalendar && (
          <Button size="sm" variant="outline" onClick={unschedule}>
            {t('todo.unschedule')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => openSession(null, t('todo.askPrefill', { title: todo.title }))}>
          {t('todo.ask')}
        </Button>
      </div>
    </div>
  )
}

/** A calendar event. It belongs to the calendar it came from, so Jezo doesn't edit it. */
export function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { t } = useTranslation()
  const openSession = useStore((s) => s.openSession)
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center">
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[11.5px] font-medium text-muted-foreground">{event.source}</span>
        <span className="flex-1" />
        <CloseButton onClick={onClose} />
      </div>
      <h2 className="text-[19px] leading-snug font-semibold" data-selectable>
        {event.title}
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-[13.5px]">
          {event.allDay
            ? t('event.allDay', { days: event.hours > 24 ? `${monthDay(event.date)} – ${monthDay(addDays(event.date, event.hours / 24 - 1))}` : longDate(event.date) })
            : `${weekday(event.date)} ${clock(event.start)} – ${clock(event.start + event.hours)}`}
        </p>
        {event.location && (
          <p className="text-[13.5px] text-muted-foreground" data-selectable>
            {event.location}
          </p>
        )}
        {event.url && (
          <a href={event.url} target="_blank" rel="noreferrer" className="truncate text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {event.url}
          </a>
        )}
      </div>
      {event.notes && (
        // Written by whoever made the event, and often long (a meeting link, an agenda), so folded away.
        <Disclosure label={t('event.notes')} className="border-t pt-3">
          <p className="pt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground" data-selectable>
            {event.notes}
          </p>
        </Disclosure>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t('event.readOnly', { source: event.source })}</p>
      <Button variant="outline" onClick={() => openSession(null, t('event.whatNextPrefill', { title: event.title }))}>
        {t('event.whatNext')}
      </Button>
    </div>
  )
}

function Why({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <Disclosure label={t('todo.why')} className="border-t pt-3">
      <p className="pt-2.5 text-[13px] leading-relaxed text-pretty text-muted-foreground">{text}</p>
    </Disclosure>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={t('todo.close')} className="text-muted-foreground">
      <X />
    </Button>
  )
}

/** The side panel that holds a detail view. It slides in from the right edge. */
export function DetailPanel({ open, overlay, children }: { open: boolean; overlay?: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={{ opacity: 0, transform: 'translateX(24px)' }}
          animate={{ opacity: 1, transform: 'translateX(0px)' }}
          // Leaves faster than it arrives: closing is the user done with it.
          exit={{ opacity: 0, transform: 'translateX(24px)', transition: { duration: 0.15, ease: easeOut } }}
          transition={{ duration: 0.22, ease: easeOut }}
          className={
            overlay
              ? 'absolute inset-y-0 right-0 z-10 w-[340px] max-w-[85%] overflow-auto border-l bg-background px-5.5 py-6 shadow-[-20px_0_50px_-20px_rgb(10_14_40/0.35)] backdrop-blur-2xl backdrop-saturate-150'
              : 'w-[340px] shrink-0 overflow-auto border-l bg-card px-5.5 py-5.5'
          }
        >
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
