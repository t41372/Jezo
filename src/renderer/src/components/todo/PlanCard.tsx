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
}: {
  title: string
  todoIds: string[]
  onTweak: () => void
  onGoToday?: () => void
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
            <span className="flex-1">{todo.title}</span>
            <span className="text-xs text-muted-foreground">
              {/* Moved to another day since the plan was made. */}
              {todo.slot && (todo.slot.date === today ? clock(todo.slot.start) : `${weekday(todo.slot.date)} ${clock(todo.slot.start)}`)}
            </span>
          </li>
        ))}
      </ul>
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
