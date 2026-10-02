import { useDndContext, useDndMonitor } from '@dnd-kit/core'
import { cn } from 'cn'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDragItem, useDropTarget, type DragItem } from '@/app/Dnd'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { insertionAt, pointerY, type Insertion } from '@/components/todo/reorder'
import { goalById, useStore } from '@/data/store'
import type { Todo } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'
import { easeOut } from '@/lib/motion'
import { duration } from '@/lib/time'

/** Todos without a time. Drag one onto the week to schedule it, or drag it back here. */
export function Backlog() {
  const { t } = useTranslation('calendar')
  const todos = useStore((s) => s.todos).filter((x) => !x.slot && (x.state === 'open' || x.state === 'draft'))
  const { proposeSlots, setCalendarDate, setCalendarView, moveTodo, openSession } = useStore.getState()
  // The conversation the agent is finding times in, and whether it still is.
  const finding = useStore((s) => s.sessions.find((x) => x.id === s.findingTimes))
  const { active } = useDndContext()
  const dragging = !!active
  const list = useRef<HTMLUListElement>(null)
  // Where a todo being dragged over the list would go, and the todo that just landed.
  const [insert, setInsert] = useState<Insertion | null>(null)
  const [landing, setLanding] = useState<Landing | null>(null)

  const { setNodeRef, isOver } = useDropTarget('backlog', {
    onDrop: (item, rect) => {
      const at = insertionAt(list.current, ROW, item.id, pointerY(rect), GAP)
      setInsert(null)
      // A card dragged from this list starts from where its chip was; a block from the grid, centered on the pointer.
      setLanding({ id: item.id, x: rect.left, y: rect.top, center: !rect.width, at: performance.now() })
      moveTodo(item.id, null, at ? { before: at.before } : {})
    },
  })

  // Follow a card dragged from this list (dnd-kit)...
  useDndMonitor({
    onDragMove: ({ active, over }) => {
      const rect = active.rect.current.translated
      const id = (active.data.current as { item: DragItem }).item.id
      setInsert(over?.id === 'backlog' && rect ? insertionAt(list.current, ROW, id, pointerY(rect), GAP) : null)
    },
    onDragEnd: () => setInsert(null),
    onDragCancel: () => setInsert(null),
  })
  // ...and a block moved on the calendar grid, which has its own drag engine and marks the body while it moves.
  const followGridDrag = (e: React.PointerEvent) => {
    if (document.body.hasAttribute('data-ec-moving')) setInsert(insertionAt(list.current, ROW, null, e.clientY, GAP))
  }

  useEffect(() => {
    if (!landing) return
    const done = window.setTimeout(() => setLanding(null), 400)
    return () => window.clearTimeout(done)
  }, [landing])

  return (
    <div
      ref={setNodeRef}
      // The calendar grid looks for this when a block is dragged out of it.
      data-drop="backlog"
      onPointerMove={followGridDrag}
      onPointerLeave={() => setInsert(null)}
      className={cn(
        'flex w-[230px] shrink-0 flex-col gap-2 overflow-auto rounded-l-[10px] border-r px-4 pt-7 pb-4 outline-[1.5px] -outline-offset-6 outline-transparent transition-[background-color,outline-color] duration-150',
        // A todo on its way here: dragged from this list (dnd-kit), or a block moved on the grid (ReUI marks the body).
        'in-[[data-ec-moving]]:bg-draft/5 in-[[data-ec-moving]]:outline-dashed in-[[data-ec-moving]]:outline-draft in-[[data-ec-moving]]:hover:bg-draft/10',
        dragging && 'bg-draft/5 outline-dashed outline-draft',
        isOver && 'bg-draft/10',
      )}
    >
      <div className="flex items-baseline gap-2">
        <h2 className="text-xl font-semibold">{t('backlog.title')}</h2>
        <span className="text-xs text-muted-foreground">{t('backlog.subtitle')}</span>
      </div>
      <p className="-mt-1 text-xs leading-normal text-muted-foreground">{t('backlog.hint')}</p>
      <NewTodo />

      <ul ref={list} className="relative flex flex-col gap-2">
        <AnimatePresence initial={false} mode="popLayout">
          {todos.map((todo) => {
            const landed = landing?.id === todo.id ? landing : undefined
            return (
              <motion.li
                key={todo.id}
                data-backlog-id={todo.id}
                // The card that just landed flies in from where it was dropped; the others make room.
                layout={!landed}
                initial={landed ? false : { opacity: 0, transform: 'scale(0.96)' }}
                animate={{ opacity: 1, transform: 'scale(1)' }}
                exit={{ opacity: 0, transform: 'scale(0.96)' }}
                transition={{ duration: 0.2, ease: easeOut }}
              >
                <BacklogCard todo={todo} flyFrom={landed} />
              </motion.li>
            )
          })}
        </AnimatePresence>
        {insert && (
          // A line where the dragged todo will go. It moves between gaps rather than opening one,
          // because opening a gap would shift the card being dragged away from the pointer.
          <li
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 flex items-center transition-transform duration-100 ease-out"
            style={{ transform: `translateY(${insert.y - 3}px)` }}
          >
            <span className="size-1.5 rounded-full border-[1.5px] border-draft bg-background" />
            <span className="h-0.5 flex-1 rounded-full bg-draft" />
          </li>
        )}
      </ul>
      {todos.length === 0 && <p className="px-0.5 py-2 text-[12.5px] text-muted-foreground">{t('backlog.empty')}</p>}
      {todos.length > 0 && (
        <Button
          variant="outline"
          className="mt-1.5 h-9.5 rounded-full border-[1.5px] border-dashed border-draft bg-draft-bg text-[13px] text-draft-ink hover:bg-draft-chip"
          disabled={finding?.running}
          onClick={() => {
            // The proposals are for the coming days, so show this week.
            setCalendarDate(useStore.getState().now.date)
            setCalendarView('week')
            proposeSlots()
          }}
        >
          {finding?.running ? t('backlog.finding') : t('backlog.findTime')}
        </Button>
      )}
      {/* What it said, including why something stayed in the backlog, is in its conversation. */}
      {finding && !finding.running && (
        <button className="self-center text-[12.5px] text-muted-foreground underline-offset-2 hover:underline" onClick={() => openSession(finding.id)}>
          {t('backlog.whatItSaid')}
        </button>
      )}

      <div className="flex-1" />
      {/* Below the list, where the spacer makes room: pushing the cards down mid-drag would move the one being dragged away from the pointer. */}
      <p
        className={cn(
          'hidden self-center rounded-full bg-draft-chip px-3 py-1.5 text-xs text-draft-ink in-[[data-ec-moving]]:block',
          dragging && 'block',
        )}
      >
        {t('backlog.dropHere')}
      </p>
      <Legend />
    </div>
  )
}

function BacklogCard({ todo, flyFrom }: { todo: Todo; flyFrom?: Landing }) {
  const { t } = useTranslation('calendar')
  const goal = useStore((s) => goalById(s.goals, todo.goalId))
  const { attributes, listeners, setNodeRef, isDragging } = useDragItem({ kind: 'todo', id: todo.id })
  const card = useRef<HTMLDivElement | null>(null)

  // Just dropped here: travel from the drop point to this slot.
  useLayoutEffect(() => {
    if (!flyFrom || !card.current || matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const r = card.current.getBoundingClientRect()
    const dx = flyFrom.x - (flyFrom.center ? r.left + r.width / 2 : r.left)
    const dy = flyFrom.y - (flyFrom.center ? r.top + r.height / 2 : r.top)
    // Shrunk around the point it starts from, which only the keyframes use, so a later press still shrinks around the middle.
    const origin = flyFrom.center ? 'center' : 'top left'
    card.current.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.9)`, transformOrigin: origin, opacity: 0.85 },
        { transform: 'none', transformOrigin: origin, opacity: 1 },
      ],
      { duration: 260, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' },
    )
  }, [flyFrom])

  return (
    <div
      ref={(node) => {
        setNodeRef(node)
        card.current = node
      }}
      {...attributes}
      {...listeners}
      style={goalStyle(goal?.hue)}
      onClick={() => useStore.getState().setCalendarDetail(todo.id)}
      className={cn(
        'pressable flex cursor-grab flex-col gap-1 rounded-[14px] border border-card-border bg-card px-3.5 py-3 shadow-[0_1px_2px_rgb(10_14_40/0.04)] outline-none hover:shadow-[0_2px_8px_-2px_rgb(10_14_40/0.12)] focus-visible:ring-3 focus-visible:ring-ring/50',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex items-center gap-2.5 text-sm font-medium">
        <span className="size-3.5 shrink-0 rounded-full border-2 border-goal" />
        {todo.title}
      </div>
      <div className="pl-6 text-xs text-muted-foreground">
        {t('backlog.card', { goal: goal?.name ?? t('todo.noGoal', { ns: 'common' }), duration: duration(todo.estimateMinutes) })}
      </div>
    </div>
  )
}

/** A todo just dropped on the list, and the screen point its card starts from: its top-left corner, or with `center` its middle. */
interface Landing {
  id: string
  x: number
  y: number
  center: boolean
  at: number
}

/** The gap between cards (gap-2). */
const GAP = 8
const ROW = 'data-backlog-id'

function NewTodo() {
  const { t } = useTranslation('calendar')
  const [text, setText] = useState('')
  const addTodo = useStore((s) => s.addTodo)
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) {
          addTodo(text.trim())
          setText('')
        }
      }}
      placeholder={t('backlog.add')}
      className="h-10 rounded-full border-card-border bg-card px-3.5 text-[13px]"
    />
  )
}

function Legend() {
  const { t } = useTranslation('calendar')
  return (
    <ul className="flex flex-col gap-1.5 border-t pt-3 text-xs text-muted-foreground">
      <li className="flex items-center gap-2">
        <span className="size-2.5 rounded-[3px] border bg-muted" />
        {t('legend.events')}
      </li>
      <li className="flex items-center gap-2" style={goalStyle(150)}>
        <span className="size-2.5 rounded-[3px] border border-goal/60 bg-goal/25" />
        {t('legend.todos')}
      </li>
      <li className="flex items-center gap-2">
        <span className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-draft" />
        {t('legend.drafts')}
      </li>
    </ul>
  )
}
