import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { Disclosure } from '@/components/Disclosure'
import { PlanCard } from '@/components/todo/PlanCard'
import { TodoCheck } from '@/components/todo/TodoCheck'
import { whenLabel } from '@/components/todo/format'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { goalById, useStore } from '@/data/store'
import type { Todo } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'
import { useTranslation } from 'react-i18next'
import { easeOut } from '@/lib/motion'
import { useNow } from '@/lib/use-now'
import { clock, duration, longDate } from '@/lib/time'

const rowMotion = {
  layout: true,
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.2, ease: easeOut },
} as const

export function Agenda() {
  const { t } = useTranslation('today')
  const date = useStore((s) => s.now.date)
  const all = useStore((s) => s.todos)
  const selected = useStore((s) => s.todayDetail)
  const { navigate, openSession, send, setTodayDetail } = useStore.getState()

  const todos = all.filter((x) => x.slot?.date === date).sort((a, b) => a.slot!.start - b.slot!.start)
  const drafts = todos.filter((x) => x.state === 'draft')
  const accepted = todos.filter((x) => x.state !== 'draft')
  const open = accepted.filter((x) => x.state === 'open')
  const done = accepted.filter((x) => x.state === 'done')
  const [current, ...later] = open

  // The conversation that proposed today's drafts, if there is one; otherwise a new one.
  const planSession = useStore(
    (s) => s.sessions.find((x) => x.messages.some((m) => m.kind === 'plan' && m.todoIds.some((id) => drafts.some((d) => d.id === id))))?.id ?? null,
  )
  const rescue = () => {
    openSession(planSession)
    send(t('badDayMessage'))
  }

  return (
    <div className="min-w-0 flex-1 overflow-auto px-10 py-9">
      <motion.div layout="position" transition={{ duration: 0.22, ease: easeOut }} className="mx-auto flex max-w-[620px] flex-col gap-6.5">
        <header className="flex items-end gap-3.5">
          <div>
            <div className="text-[13px] text-muted-foreground">{longDate(date)}</div>
            <h1 className="mt-0.5 text-[30px] font-semibold tracking-tight">{t('heading')}</h1>
          </div>
          <span className="flex-1" />
          <div className="text-right">
            <div className="text-[26px] leading-none font-medium tabular-nums">
              {done.length}
              <span className="text-[15px] text-muted-foreground"> / {accepted.length}</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{t('done')}</div>
          </div>
        </header>

        <AnimatePresence initial={false}>
          {drafts.length > 0 && (
            <motion.section key="drafts" {...rowMotion}>
              <PlanCard title={t('drafts')} todoIds={drafts.map((x) => x.id)} onTweak={() => openSession(planSession)} />
            </motion.section>
          )}
        </AnimatePresence>

        <AnimatePresence initial={false} mode="popLayout">
          {current && (
            <motion.section key={current.id} {...rowMotion}>
              <SectionLabel>{t('now')}</SectionLabel>
              <NowCard todo={current} onOpen={() => setTodayDetail(current.id)} />
            </motion.section>
          )}
        </AnimatePresence>

        {later.length > 0 && (
          <motion.section layout="position" transition={rowMotion.transition}>
            <SectionLabel>{t('later')}</SectionLabel>
            <ul>
              <AnimatePresence initial={false} mode="popLayout">
                {later.map((todo) => (
                  <motion.li key={todo.id} {...rowMotion} className="border-b py-1">
                    <Row todo={todo} selected={todo.id === selected} onOpen={() => setTodayDetail(todo.id)} />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </motion.section>
        )}

        {done.length > 0 && (
          <motion.div layout="position" transition={rowMotion.transition}>
            <Disclosure label={t('doneList', { count: done.length })} triggerClassName="text-xs">
              <ul className="pt-1">
                {done.map((todo) => (
                  <li key={todo.id} className="flex items-center gap-3.5 px-1 py-2.5" style={goalStyle(goalOf(todo))}>
                    <TodoCheck todo={todo} />
                    <span className="text-[14.5px] text-muted-foreground line-through">{todo.title}</span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </motion.div>
        )}

        <motion.div layout="position" transition={rowMotion.transition} className="flex flex-col items-start gap-2 text-[13px] text-muted-foreground">
          <button onClick={rescue} className="hover:text-foreground transition-colors duration-150">
            {t('badDay')}
          </button>
          <button onClick={() => navigate('calendar')} className="hover:text-foreground transition-colors duration-150">
            {t('seeWeek')}
          </button>
        </motion.div>
      </motion.div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-2 text-xs text-muted-foreground">{children}</div>
}

function NowCard({ todo, onOpen }: { todo: Todo; onOpen: () => void }) {
  const { t } = useTranslation()
  const { setStarted, setDone } = useStore.getState()
  const running = todo.startedAt !== undefined
  const now = useNow(1000, running)
  const seconds = running ? Math.max(0, Math.floor((now - todo.startedAt!) / 1000)) : 0
  const elapsed = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

  return (
    <Card className={cn('gap-3 px-5 py-4.5 transition-[border-color] duration-200', running && 'border-goal/50')} style={goalStyle(goalOf(todo))}>
      <div className="flex items-start gap-3.5">
        <TodoCheck todo={todo} size={22} className="mt-1" />
        <div className="flex-1">
          <div className="text-lg leading-snug font-semibold">{todo.title}</div>
          <div className="mt-1 text-[13px] text-muted-foreground">
            {running ? (
              <span className="flex items-center gap-1.5 text-goal-deep tabular-nums">
                <span className="size-1.5 rounded-full bg-goal motion-safe:animate-pulse" />
                {t('focus.running', { elapsed })}
              </span>
            ) : (
              <>
                {whenLabel(todo)} · {t('todo.estimateInline', { duration: duration(todo.estimateMinutes) })}
              </>
            )}
          </div>
        </div>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={running ? 'running' : 'idle'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: easeOut }}
          className="flex gap-2 pl-9"
        >
          {running ? (
            <>
              <Button
                className="px-4"
                onClick={() => setDone(todo.id, true)}
              >
                {t('focus.done')}
              </Button>
              <Button variant="outline" onClick={() => setStarted(todo.id, null)}>
                {t('focus.pause')}
              </Button>
            </>
          ) : (
            <Button className="px-4" onClick={() => setStarted(todo.id, Date.now())}>
              {t('start', { ns: 'today' })}
            </Button>
          )}
          <Button variant="ghost" className="text-muted-foreground" onClick={onOpen}>
            {t('details', { ns: 'today' })}
          </Button>
        </motion.div>
      </AnimatePresence>
    </Card>
  )
}

function Row({ todo, selected, onOpen }: { todo: Todo; selected: boolean; onOpen: () => void }) {
  return (
    <div
      className={cn(
        '-mx-2 flex items-center gap-3.5 rounded-lg px-3 py-2 transition-colors duration-150 has-[>button:active]:bg-foreground/8',
        selected ? 'bg-muted' : 'has-[>button:hover]:bg-muted/60',
      )}
      style={goalStyle(goalOf(todo))}
    >
      <TodoCheck todo={todo} />
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className="text-[15px] font-medium">{todo.title}</div>
        <div className="mt-0.5 text-[12.5px] text-muted-foreground">{whenLabel(todo)}</div>
      </button>
      <span className="text-[12.5px] text-muted-foreground tabular-nums">{todo.slot && clock(todo.slot.start)}</span>
    </div>
  )
}

function goalOf(todo: Todo) {
  return goalById(useStore.getState().goals, todo.goalId)?.hue
}
