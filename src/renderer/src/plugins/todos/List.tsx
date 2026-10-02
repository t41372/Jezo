import { useDndMonitor } from '@dnd-kit/core'
import { cn } from 'cn'
import { Search } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDragItem, useDropTarget } from '@/app/Dnd'
import { Disclosure } from '@/components/Disclosure'
import { insertionAt, pointerY, type Insertion } from '@/components/todo/reorder'
import { TodoCheck } from '@/components/todo/TodoCheck'
import { Input } from '@/components/ui/input'
import { goalById, useStore, type TodosAction } from '@/data/store'
import type { Goal, Todo } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'
import { addDays, clock, dayLabel, duration } from '@/lib/time'
import i18n from '@/i18n'
import { offerUndo } from '@/lib/undo'

/** How many closed todos show before 再顯示. */
const CLOSED_PAGE = 50
/** The gap between rows of 沒排時間, for placing a dragged todo. */
const GAP = 2
const ROW = 'data-list-backlog-id'

/**
 * Every todo in one list, grouped by time (docs/design/frontend.md, "The todo
 * list"): what was planned earlier and isn't done, folded; today; tomorrow;
 * the backlog, in its own order; the days after; and what's done or dropped,
 * folded. Grouping by time is the default the layout gives (`group: time`).
 */
export function List() {
  const { t } = useTranslation('todos')
  const all = useStore((s) => s.todos)
  const goals = useStore((s) => s.goals)
  const today = useStore((s) => s.now.date)
  const selected = useStore((s) => s.listDetail)
  const [query, setQuery] = useState('')
  const [goal, setGoal] = useState<string | null | undefined>(undefined)

  const matches = (todo: Todo) =>
    (goal === undefined || todo.goalId === goal) && (!query.trim() || todo.title.toLowerCase().includes(query.trim().toLowerCase()))
  const todos = all.filter(matches)
  const active = todos.filter((x) => x.state === 'open' || x.state === 'draft')
  const byTime = (a: Todo, b: Todo) => a.slot!.at - b.slot!.at
  const on = (date: string) => active.filter((x) => x.slot?.date === date).sort(byTime)
  const past = active.filter((x) => x.slot && x.slot.date < today).sort(byTime)
  const backlog = active.filter((x) => !x.slot)
  const week = Array.from({ length: 6 }, (_, i) => addDays(today, i + 2))
  const further = active.filter((x) => x.slot && x.slot.date > week.at(-1)!).sort(byTime)
  const closed = todos
    .filter((x) => x.state === 'done' || x.state === 'dropped')
    .sort((a, b) => (b.completedAt ?? b.droppedAt ?? 0) - (a.completedAt ?? a.droppedAt ?? 0))
  const openCount = all.filter((x) => x.state === 'open').length
  // While searching, every group shows what it found.
  const searching = !!query.trim()

  const row: RowOf = (todo, { date, actions, attributes } = {}) => (
    <li key={todo.id} {...attributes}>
      <Row todo={todo} selected={todo.id === selected} date={date} actions={actions} />
    </li>
  )

  return (
    <div className="min-w-0 flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[640px] flex-col gap-5">
        <header className="flex items-end gap-3">
          <h1 className="text-[30px] font-semibold tracking-tight">{t('heading')}</h1>
          <span className="flex-1" />
          <span className="pb-1 text-[13px] text-muted-foreground">{t('open', { count: openCount })}</span>
        </header>

        <div className="flex flex-col gap-2.5">
          <NewTodo />
          <div className="flex items-start gap-2">
            <label className="relative w-56 shrink-0">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('search')} aria-label={t('search')} className="h-8 rounded-full pl-8 text-[13px]" />
            </label>
            <GoalFilter goals={goals} value={goal} onChange={setGoal} />
          </div>
        </div>

        {past.length > 0 && (
          <Disclosure key={`past-${searching}`} defaultOpen={searching} label={t('past.title', { count: past.length })} triggerClassName="text-[13px]">
            <div className="mt-2 flex flex-col gap-2" data-group="past">
              <GroupActions ids={past.map((x) => x.id)} />
              <ul>{past.map((x) => row(x, { date: true, actions: true }))}</ul>
            </div>
          </Disclosure>
        )}

        <Group label={t('today')} name="today" todos={on(today)} row={row} />
        <Group label={t('tomorrow')} name="tomorrow" todos={on(addDays(today, 1))} row={row} />
        <Backlog todos={backlog} row={row} />
        {week.map((date) => (
          <Group key={date} label={dayLabel(date, today)} name={date} todos={on(date)} row={row} />
        ))}
        {further.length > 0 && (
          <Disclosure key={`further-${searching}`} defaultOpen={searching} label={t('further', { count: further.length })} triggerClassName="text-[13px]">
            <ul className="mt-2" data-group="further">{further.map((x) => row(x, { date: true }))}</ul>
          </Disclosure>
        )}
        {closed.length > 0 && (
          <Disclosure key={`closed-${searching}`} defaultOpen={searching} label={t('closed', { count: closed.length })} triggerClassName="text-[13px]">
            <Closed todos={closed} row={row} />
          </Disclosure>
        )}

        {todos.length === 0 && <p className="text-[13px] text-muted-foreground">{all.length ? t('noMatch') : t('nothing')}</p>}
      </div>
    </div>
  )
}

type RowOf = (todo: Todo, options?: { date?: boolean; actions?: boolean; attributes?: Record<string, string> }) => React.ReactNode

/** A day's todos under its name; nothing when there are none. */
function Group({ label, name, todos, row }: { label: string; name: string; todos: Todo[]; row: RowOf }) {
  if (!todos.length) return null
  return (
    <section data-group={name}>
      <h2 className="mb-1 text-xs text-muted-foreground">{label}</h2>
      <ul>{todos.map((x) => row(x))}</ul>
    </section>
  )
}

/** The newest closed todos, and more on request. */
function Closed({ todos, row }: { todos: Todo[]; row: RowOf }) {
  const { t } = useTranslation('todos')
  const [shown, setShown] = useState(CLOSED_PAGE)
  return (
    <div className="mt-2" data-group="closed">
      <ul>{todos.slice(0, shown).map((x) => row(x, { date: true }))}</ul>
      {todos.length > shown && (
        <button className="mt-1 px-1 text-[12.5px] text-muted-foreground hover:text-foreground" onClick={() => setShown(shown + CLOSED_PAGE)}>
          {t('more', { count: Math.min(CLOSED_PAGE, todos.length - shown) })}
        </button>
      )}
    </div>
  )
}

/**
 * The backlog, in its own order. A todo dragged here from this list or the
 * calendar goes where it's let go; one with a time loses it.
 */
function Backlog({ todos, row }: { todos: Todo[]; row: RowOf }) {
  const { t } = useTranslation('todos')
  const list = useRef<HTMLUListElement>(null)
  const [insert, setInsert] = useState<Insertion | null>(null)
  const { setNodeRef, isOver } = useDropTarget('list-backlog', {
    onDrop: (item, rect) => {
      const at = insertionAt(list.current, ROW, item.id, pointerY(rect), GAP)
      setInsert(null)
      useStore.getState().moveTodo(item.id, null, at ? { before: at.before } : {})
    },
  })
  useDndMonitor({
    onDragMove: ({ active, over }) => {
      const rect = active.rect.current.translated
      const id = (active.data.current as { item: { id: string } }).item.id
      setInsert(over?.id === 'list-backlog' && rect ? insertionAt(list.current, ROW, id, pointerY(rect), GAP) : null)
    },
    onDragEnd: () => setInsert(null),
    onDragCancel: () => setInsert(null),
  })
  return (
    <section ref={setNodeRef} data-group="backlog" className={cn('-mx-2 rounded-lg px-2 pb-1 transition-colors duration-150', isOver && 'bg-draft/5')}>
      <h2 className="mb-1 text-xs text-muted-foreground">{t('backlog')}</h2>
      <ul ref={list} className="relative">
        {todos.map((x) => row(x, { attributes: { [ROW]: x.id } }))}
        {insert && (
          <li aria-hidden className="pointer-events-none absolute inset-x-0 top-0 flex items-center transition-transform duration-100 ease-out" style={{ transform: `translateY(${insert.y - 1}px)` }}>
            <span className="size-1.5 rounded-full border-[1.5px] border-draft bg-background" />
            <span className="h-0.5 flex-1 rounded-full bg-draft" />
          </li>
        )}
      </ul>
      {todos.length === 0 && <p className="px-1 py-1.5 text-[12.5px] text-muted-foreground">{t('backlogEmpty')}</p>}
    </section>
  )
}

/**
 * One todo: its check, its title and when, in its goal's color. Choosing it
 * opens its details. Rows planned earlier offer what to do with them.
 */
function Row({ todo, selected, date, actions }: { todo: Todo; selected: boolean; date?: boolean; actions?: boolean }) {
  const { t } = useTranslation('todos')
  const { t: tc } = useTranslation()
  const goal = useStore((s) => goalById(s.goals, todo.goalId))
  const today = useStore((s) => s.now.date)
  const { listeners, setNodeRef, isDragging } = useDragItem({ kind: 'todo', id: todo.id }, todo.state === 'done' || todo.state === 'dropped')
  const draft = todo.state === 'draft'
  const closed = todo.state === 'done' || todo.state === 'dropped'
  const when = todo.slot ? (date ? `${dayLabel(todo.slot.date, today)} ${clock(todo.slot.start)}` : clock(todo.slot.start)) : null
  const meta = [when, goal?.name, duration(todo.estimateMinutes)].filter(Boolean).join(' · ')

  return (
    <div
      ref={setNodeRef}
      // Only the pointer drags it. dnd-kit's attributes would make the row a button, and a row that
      // can't be dragged aria-disabled, which disables the buttons inside it for assistive technology.
      {...listeners}
      style={goalStyle(goal?.hue)}
      data-todo-row={todo.id}
      data-state={todo.state}
      className={cn(
        'group -mx-2 flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors duration-150',
        selected ? 'bg-muted' : 'hover:bg-muted/60',
        isDragging && 'opacity-40',
      )}
    >
      {todo.state === 'dropped' ? <span className="size-5 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/40" /> : <TodoCheck todo={todo} />}
      <button onClick={() => useStore.getState().setListDetail(todo.id)} className="min-w-0 flex-1 text-left outline-none focus-visible:underline">
        <div className={cn('truncate text-[14.5px]', closed && 'text-muted-foreground', todo.state === 'done' && 'line-through')}>
          {draft && <span className="mr-1.5 rounded bg-draft-chip px-1 py-px text-[11px] text-draft-ink">{t('draft')}</span>}
          {todo.title}
        </div>
        <div className="truncate text-[12px] text-muted-foreground">
          {todo.state === 'dropped' ? `${t('droppedTag')}${meta ? ` · ${meta}` : ''}` : meta}
        </div>
      </button>
      {actions && (
        <div className="flex shrink-0 gap-0.5 text-[12px]">
          <RowAction onClick={() => act([todo.id], 'today')}>{tc('todo.toToday')}</RowAction>
          <RowAction onClick={() => act([todo.id], 'backlog')}>{tc('todo.toBacklog')}</RowAction>
          <RowAction onClick={() => act([todo.id], 'dropped')}>{tc('todo.drop')}</RowAction>
        </div>
      )}
      {todo.state === 'dropped' && (
        <RowAction onClick={() => useStore.getState().setDropped(todo.id, false)}>{tc('todo.undrop')}</RowAction>
      )}
    </div>
  )
}

function RowAction({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="rounded-md px-1.5 py-1 text-[12px] text-muted-foreground transition-colors duration-150 hover:bg-foreground/6 hover:text-foreground">
      {children}
    </button>
  )
}

/** Does one thing to these todos as one change in 修改紀錄, with a toast that takes it back. */
async function act(ids: string[], action: TodosAction) {
  const { changeTodos } = useStore.getState()
  const change = await changeTodos(ids, action)
  if (!change) return
  offerUndo(i18n.t(`todo.changed.${action}`, { count: ids.length }), () => void window.jezo.history.undo(change))
}

/** What to do with everything planned earlier at once, or hand it to the agent. */
function GroupActions({ ids }: { ids: string[] }) {
  const { t } = useTranslation('todos')
  const { t: tc } = useTranslation()
  const todos = useStore((s) => s.todos)
  const ask = () => {
    const titles = todos.filter((x) => ids.includes(x.id)).map((x) => `- ${x.title}（${x.id}）`).join('\n')
    const { openSession, send } = useStore.getState()
    openSession(null)
    send(t('past.askMessage', { titles }))
  }
  return (
    <div className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
      <span className="pr-0.5">{t('past.all')}</span>
      <RowAction onClick={() => act(ids, 'today')}>{tc('todo.toToday')}</RowAction>
      <RowAction onClick={() => act(ids, 'backlog')}>{tc('todo.toBacklog')}</RowAction>
      <RowAction onClick={() => act(ids, 'done')}>{tc('todo.markDone')}</RowAction>
      <RowAction onClick={() => act(ids, 'dropped')}>{tc('todo.drop')}</RowAction>
      <span className="flex-1" />
      <button onClick={ask} className="rounded-full border-[1.5px] border-dashed border-draft bg-draft-bg px-3 py-1 text-[12.5px] text-draft-ink transition-colors duration-150 hover:bg-draft-chip">
        {t('past.ask')}
      </button>
    </div>
  )
}

/** Narrows the list to one goal's todos, or to those without one. */
function GoalFilter({ goals, value, onChange }: { goals: Goal[]; value: string | null | undefined; onChange: (goal: string | null | undefined) => void }) {
  const { t } = useTranslation('todos')
  const chip = (key: string, label: string, goal: string | null | undefined, hue?: number) => (
    <button
      key={key}
      onClick={() => onChange(value === goal ? undefined : goal)}
      aria-pressed={value === goal}
      style={goalStyle(hue)}
      className={cn(
        'shrink-0 rounded-full border px-2.5 py-1 text-[12px] transition-colors duration-150',
        value === goal ? 'border-goal bg-goal-tint text-goal-deep' : 'border-card-border text-muted-foreground hover:text-foreground',
      )}
    >
      {label}
    </button>
  )
  return (
    <div className="flex min-w-0 flex-wrap gap-1.5" role="group" aria-label={t('allGoals')}>
      {chip('all', t('allGoals'), undefined)}
      {goals.filter((g) => g.state === 'active').map((g) => chip(g.id, g.name, g.id, g.hue))}
      {chip('none', t('noGoal'), null)}
    </div>
  )
}

/** One field: what's typed becomes a todo with no time yet. */
function NewTodo() {
  const { t } = useTranslation('todos')
  const [text, setText] = useState('')
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) {
          useStore.getState().addTodo(text.trim())
          setText('')
        }
      }}
      placeholder={t('add')}
      aria-label={t('add')}
      className="h-10 rounded-full border-card-border bg-card px-4 text-[13.5px]"
    />
  )
}
