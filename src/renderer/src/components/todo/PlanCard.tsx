import { AnimatePresence, motion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStore } from '@/data/store'
import { goalStyle } from '@/lib/goal-color'
import { easeOut } from '@/lib/motion'
import { useTranslation } from 'react-i18next'
import { clock, weekday } from '@/lib/time'

/**
 * A set of todos the agent proposed. It stays a draft until the user says yes,
 * and once accepted it says plainly that nothing has been done yet, so a plan
 * never looks like progress.
 */
export function PlanCard({
  title,
  todoIds,
  onTweak,
  onGoToday,
  changes,
  superseded,
}: {
  title: string
  todoIds: string[]
  onTweak: () => void
  onGoToday?: () => void
  /** What changed from the plan this one revised. */
  changes?: { added: string[]; changed: string[]; removed: string[] }
  /** A later card in the conversation revised this plan. */
  superseded?: boolean
}) {
  const { t } = useTranslation()
  const allTodos = useStore((s) => s.todos)
  const goals = useStore((s) => s.goals)
  const today = useStore((s) => s.now.date)
  const accept = useStore((s) => s.accept)
  const unaccept = useStore((s) => s.unaccept)

  const todos = todoIds.flatMap((id) => allTodos.find((x) => x.id === id) ?? [])
  const pending = todos.some((x) => x.state === 'draft')
  const doneCount = todos.filter((x) => x.state === 'done').length

  // The new version is further down; this one would only repeat it with old times.
  if (superseded) {
    return (
      <Card className="flex-row items-center gap-2 px-4 py-2.5 text-[13px]">
        <span className="font-medium text-muted-foreground">{title}</span>
        <span className="text-xs text-muted-foreground">{t('plan.revised')}</span>
      </Card>
    )
  }

  return (
    <Card
      variant={pending ? 'draft' : 'default'}
      className="gap-2.5 px-4 py-3.5 transition-[background-color,border-color] duration-200 ease-out"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{title}</span>
        <span className="text-xs text-muted-foreground">
          {pending ? t('plan.pending', { count: todos.length }) : t('plan.accepted')}
        </span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {todos.map((todo) => (
          <li key={todo.id} className="flex items-center gap-2.5 text-[13.5px]" style={goalStyle(goals.find((g) => g.id === todo.goalId)?.hue)}>
            <span className="size-2 shrink-0 rounded-[3px] bg-goal" />
            <span className={todo.state === 'dropped' ? 'flex-1 text-muted-foreground' : 'flex-1'}>{todo.title}</span>
            {todo.state === 'dropped' && <span className="text-xs text-muted-foreground">{t('todo.drop')}</span>}
            {changes?.added.includes(todo.id) && <span className="text-xs text-muted-foreground">{t('plan.added')}</span>}
            {changes?.changed.includes(todo.id) && <span className="text-xs text-muted-foreground">{t('plan.changed')}</span>}
            <span className="text-xs text-muted-foreground">
              {/* Moved to another day since the plan was made. */}
              {todo.slot && todo.state !== 'dropped' && (todo.slot.date === today ? clock(todo.slot.start) : `${weekday(todo.slot.date)} ${clock(todo.slot.start)}`)}
            </span>
          </li>
        ))}
      </ul>
      {!!changes?.removed.length && <div className="text-xs text-muted-foreground">{t('plan.removed', { titles: changes.removed.join('、') })}</div>}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pending ? 'pending' : 'accepted'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: easeOut }}
          className="pt-1"
        >
          {pending ? (
            <div className="flex gap-2">
              <Button onClick={() => accept(todoIds)} className="px-4">
                {t('plan.accept')}
              </Button>
              <Button variant="outline" onClick={onTweak} className="px-3.5">
                {t('plan.tweak')}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
              <span>{doneCount ? t('plan.someDone', { count: doneCount }) : t('plan.notStarted')}</span>
              <span className="flex-1" />
              {onGoToday && (
                <button onClick={onGoToday} className="font-medium text-foreground hover:underline transition-colors duration-150">
                  {t('plan.goToday')}
                </button>
              )}
              {doneCount === 0 && (
                <button onClick={() => unaccept(todoIds)} className="hover:text-foreground transition-colors duration-150">
                  {t('plan.undo')}
                </button>
              )}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </Card>
  )
}
