// The calendar: day, week and month views over the user's calendar events and
// scheduled todos. The grid itself is ReUI's event calendar (copied into
// components/reui); this file maps Jezo's data onto it and back, and connects
// it to the backlog beside it. See docs/design/frontend.md.

import { useDndMonitor } from '@dnd-kit/core'
import { cn } from 'cn'
import { enUS, zhTW } from 'date-fns/locale'
import { Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarSource } from '../../../../shared/calendar'
import { dropAtPoint, useDropTarget } from '@/app/Dnd'
import {
  EventCalendar,
  useEventCalendar,
  type EventCalendarProps,
  type EventCalendarRenderEventProps,
} from '@/components/reui/event-calendar/event-calendar'
import { EventCalendarContent } from '@/components/reui/event-calendar/event-calendar-content'
import { slotAtPoint } from '@/components/reui/event-calendar/event-calendar-dnd'
import type {
  CalendarEvent as GridEvent,
  EventCalendarProposedUpdate,
  EventCalendarSlotDraft,
} from '@/components/reui/event-calendar/event-calendar-types'
import { Segmented } from '@/components/Segmented'
import { isDraft } from '@/components/todo/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { goalById, useStore } from '@/data/store'
import type { CalendarEvent, CalendarViewName, Goal, ISODate, Todo } from '@/data/types'
import { goalColor } from '@/lib/goal-color'
import { addDays, ago, atTime, clock, dayLabel, hoursOf, longDate, monthDay, mondayOf, parseDate, toISODate } from '@/lib/time'

/** What each block on the grid stands for. */
type Block = { kind: 'event' } | { kind: 'todo'; todo: Todo }

/** Where a todo lands when it's put on a day without a time: a month cell, the all-day row. */
const DEFAULT_HOUR = 9

export function Calendar() {
  const { t, i18n } = useTranslation('calendar')
  const todos = useStore((s) => s.todos)
  const events = useStore((s) => s.events)
  const goals = useStore((s) => s.goals)
  const date = useStore((s) => s.calendarDate)
  const view = useStore((s) => s.calendarView)
  const selected = useStore((s) => s.calendarDetail)
  const { setCalendarDate, setCalendarView, setCalendarDetail, moveTodo } = useStore.getState()
  const [creating, setCreating] = useState<NewTodoSlot | null>(null)
  const pointer = useRef({ x: 0, y: 0 })

  const draftTitle = (title: string) => t('todo.draft', { ns: 'common', title })
  const blocks = useMemo(() => toBlocks(todos, events, goals, selected, draftTitle), [todos, events, goals, selected, i18n.language])
  const labels = useGridLabels()

  // Moving or resizing a todo on the grid schedules it there. Calendar events are read-only.
  const onEventUpdate = (update: EventCalendarProposedUpdate<Block>) => {
    const block = update.event.data
    if (block?.kind !== 'todo') return false
    const start = update.allDay ? (block.todo.slot?.start ?? DEFAULT_HOUR) : hoursOf(update.start)
    const minutes = update.source.startsWith('resize') ? Math.round((+update.end - +update.start) / 60_000) : undefined
    moveTodo(block.todo.id, { date: toISODate(update.start), start }, { minutes })
    // Todos have a time, so one put on the all-day row keeps its time instead; the store already has it.
    return !update.allDay
  }

  return (
    <div
      className="flex min-w-0 flex-1 flex-col"
      // Remembered so the box for naming a new todo opens where the drag ended.
      onPointerUpCapture={(e) => (pointer.current = { x: e.clientX, y: e.clientY })}
    >
      <EventCalendar<Block>
        className="flex min-h-0 flex-1 flex-col"
        events={blocks}
        views={['day', 'week', 'month']}
        view={view}
        onViewChange={(v) => setCalendarView(v as CalendarViewName)}
        date={parseDate(date)}
        onDateChange={(d) => setCalendarDate(toISODate(d))}
        locale={i18n.language === 'zh-TW' ? zhTW : enUS}
        weekStartsOn={1}
        dayStartHour={0}
        dayEndHour={24}
        scrollToHour={7}
        snapDuration={15}
        compactEventMinutes={45}
        i18n={labels}
        navTooltips={false}
        onEventUpdate={onEventUpdate}
        onEventClick={(occurrence, e) => {
          // The detail panel shows what's selected, so the grid's own selection stays off.
          e.preventDefault()
          setCalendarDetail(occurrence.eventId)
        }}
        onSelectSlot={(slot) => setCreating(newTodoSlot(slot, pointer.current))}
        onEventDropOutside={(occurrence, { x, y }) => {
          const block = occurrence.event.data
          if (block?.kind === 'todo') dropAtPoint({ kind: 'todo', id: block.todo.id }, x, y)
        }}
        renderEvent={(props) => <BlockContent {...props} />}
        renderDayHeader={({ day, view: v, isToday }) => <DayHeader day={day} month={v === 'month'} isToday={isToday} />}
        classNames={{
          timeGutterLabel: 'font-mono text-[10px]',
          // In the day view the title already names the day.
          timeGridHeader: view === 'day' ? 'hidden' : undefined,
          // The day number goes top-right, where Apple and Google Calendar put it; ReUI puts it
          // bottom-right. The content and the multi-day bars both start below it, at the same padding.
          monthCellFooter: 'absolute top-0 right-0 pt-1.5 pb-0',
          monthCellContent: 'pt-7.5',
          monthBarOverlay: 'pt-7.5',
        }}
      >
        <Header />
        <DropArea />
        {creating && <NewTodo slot={creating} onClose={() => setCreating(null)} />}
      </EventCalendar>
    </div>
  )
}

function toBlocks(
  todos: Todo[],
  events: CalendarEvent[],
  goals: Goal[],
  selected: string | null,
  draftTitle: (title: string) => string,
): GridEvent<Block>[] {
  const ring = (id: string) => id === selected && 'inset-ring-2 inset-ring-ring/60'
  return [
    ...events.map((e) => ({
      id: e.id,
      title: e.title,
      start: atTime(e.date, e.start),
      end: atTime(e.date, e.start + e.hours),
      allDay: e.allDay,
      readOnly: true,
      color: 'var(--muted-foreground)',
      className: cn('text-muted-foreground', ring(e.id)),
      data: { kind: 'event' as const },
    })),
    ...todos
      .filter((todo) => todo.slot)
      .map((todo) => {
        const draft = isDraft(todo)
        const done = todo.state === 'done'
        return {
          id: todo.id,
          title: draft ? draftTitle(todo.title) : todo.title,
          start: atTime(todo.slot!.date, todo.slot!.start),
          end: atTime(todo.slot!.date, todo.slot!.start + todo.estimateMinutes / 60),
          color: goalColor(goalById(goals, todo.goalId)?.hue),
          className: cn(
            'text-[color-mix(in_oklch,var(--ec-event-color)_66%,var(--foreground))]',
            draft &&
              'border-[1.5px] border-dashed border-(--ec-event-color) bg-background/70 inset-ring-0 hover:bg-(--ec-event-color)/10 dark:bg-background/70',
            done && 'bg-(--ec-event-color) text-white hover:bg-(--ec-event-color)/90 dark:bg-(--ec-event-color)',
            ring(todo.id),
          ),
          data: { kind: 'todo' as const, todo },
        }
      }),
  ]
}

/** A todo's block: a check circle in its goal's color, the title, and on longer blocks the time. */
function BlockContent({ occurrence, segment, view }: EventCalendarRenderEventProps<Block>) {
  const block = occurrence.event.data
  const ref = useArrival(block?.kind === 'todo' ? block.todo.id : null)
  const minutes = (segment.endMin ?? 0) - (segment.startMin ?? 0)
  const time = `${clock(hoursOf(occurrence.start))}–${clock(hoursOf(occurrence.end))}`
  const showTime = view !== 'month' && minutes >= 45
  // Blocks an hour or longer have room for a two-line title.
  const tall = view !== 'month' && minutes >= 60
  const done = block?.kind === 'todo' && block.todo.state === 'done'
  return (
    <span ref={ref} className="flex min-w-0 flex-col self-start leading-tight">
      <span className={cn('flex min-w-0 gap-1.5 font-semibold', tall ? 'items-start' : 'items-center')}>
        {block?.kind === 'todo' && (
          <span
            className={cn(
              'flex size-[11px] shrink-0 items-center justify-center rounded-full border-[1.5px]',
              tall && 'mt-0.5',
              done ? 'border-white bg-white text-(--ec-event-color)' : 'border-(--ec-event-color)',
            )}
          >
            {done && <Check className="size-2" strokeWidth={4} />}
          </span>
        )}
        <span className={tall ? 'line-clamp-2' : 'truncate'}>{occurrence.event.title}</span>
        {view === 'month' && !occurrence.allDay && <span className="shrink-0 font-normal opacity-70">{clock(hoursOf(occurrence.start))}</span>}
      </span>
      {showTime && <span className="mt-px text-[10px] opacity-80">{time}</span>}
    </span>
  )
}

/**
 * Blocks the agent just proposed arrive one after another, in time order, so
 * the user sees each one land. It runs only right after the proposal, not when
 * the week is shown again later.
 */
function useArrival(todoId: string | null) {
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const proposal = useStore.getState().lastProposal
    const chip = ref.current?.closest<HTMLElement>('[data-slot=event-calendar-event]')
    if (!todoId || !chip || !proposal || Date.now() - proposal.at > 1000) return
    const todos = useStore.getState().todos
    const order = proposal.ids
      .map((id) => ({ id, slot: todos.find((t) => t.id === id)?.slot }))
      .filter((x) => x.slot)
      .sort((a, b) => a.slot!.date.localeCompare(b.slot!.date) || a.slot!.start - b.slot!.start)
      .findIndex((x) => x.id === todoId)
    if (order < 0) return
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches
    chip.animate([{ opacity: 0, transform: still ? 'none' : 'scale(0.96)' }, { opacity: 1, transform: 'none' }], {
      duration: 200,
      delay: order * 50,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
      fill: 'backwards',
    })
  }, [todoId])
  return ref
}

function DayHeader({ day, month, isToday }: { day: Date; month: boolean; isToday: boolean }) {
  const { i18n } = useTranslation()
  const name = new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(day)
  // Month columns are weekdays, not dates.
  if (month) return <span className="block text-center text-xs font-normal text-muted-foreground">{name}</span>
  return (
    <span className="flex flex-col items-center gap-0.5 py-0.5">
      <span className="text-xs font-normal text-muted-foreground">{name}</span>
      <span
        className={cn(
          'flex size-8 items-center justify-center rounded-full text-[17px] font-semibold text-foreground',
          isToday && 'bg-primary text-primary-foreground',
        )}
      >
        {day.getDate()}
      </span>
    </span>
  )
}

/**
 * One line on where the events come from: the calendars that work and when
 * they last synced, or which one can't be read. Null when none are connected.
 */
function useSyncLine() {
  const { t, i18n } = useTranslation('calendar')
  const status = useStore((s) => s.calendarStatus)
  // Say "2 minutes ago" again as time passes.
  useStore((s) => s.now)
  const sources = status?.sources.filter((s) => s.state !== 'off' && s.state !== 'needs-access') ?? []
  if (!sources.length) return null
  const broken = sources.filter((s) => s.state === 'error' || s.state === 'denied')
  if (broken.length) return { ok: false, text: t('syncFailed', { source: broken.map(nameOf).join('、') }) }
  // The Mac's calendars are always current; only subscriptions have a time they were last read.
  const latest = sources.filter((s) => s.kind !== 'mac').map((s) => s.syncedAt ?? '').sort().at(-1)
  const names = sources.map(nameOf)
  const source = names.length > 2 ? t('sourcesMore', { first: names[0], count: names.length - 1 }) : names.join('、')
  return { ok: true, text: latest ? t('synced', { source, ago: ago(latest, i18n.language) }) : source }

  function nameOf(s: CalendarSource) {
    return s.kind === 'mac' ? t('mac') : s.name
  }
}

/** The title, arrows, today, the day/week/month switch, and where the events come from. */
function Header() {
  const { t, i18n } = useTranslation('calendar')
  const date = useStore((s) => s.calendarDate)
  const view = useStore((s) => s.calendarView)
  const today = useStore((s) => s.now.date)
  const todos = useStore((s) => s.todos)
  const { setCalendarDate, setCalendarView, openSession, navigate } = useStore.getState()
  const { api } = useEventCalendar()

  const monday = mondayOf(date)
  const weeksAway = Math.round((+parseDate(monday) - +parseDate(mondayOf(today))) / (7 * 86_400_000))
  const weekTitle =
    weeksAway === 0
      ? t('week.this')
      : weeksAway === -1
        ? t('week.last')
        : weeksAway === 1
          ? t('week.next')
          : weeksAway > 0
            ? t('week.later', { count: weeksAway })
            : t('week.earlier', { count: -weeksAway })
  const { title, range } = headerTitle(view, date, today, weekTitle, i18n.language)
  const sync = useSyncLine()
  const weekHasTodos = todos.some((x) => x.slot && x.slot.date >= monday && x.slot.date <= addDays(monday, 6))

  const needsPlan = view === 'week' && weeksAway !== 0 && !weekHasTodos

  return (
    <header className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-7 pt-7 pb-4">
      {/* The month view has no range line; the space stays so the title doesn't move between views. */}
      <div className="truncate text-[13px] text-muted-foreground">{range || '\u00a0'}</div>
      <div className="flex items-center justify-end gap-3 text-xs whitespace-nowrap text-muted-foreground">
        {sync && (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('size-1.5 shrink-0 rounded-full', sync.ok ? 'bg-ok' : 'bg-destructive')} />
            <span className="truncate">{sync.text}</span>
          </span>
        )}
        <button onClick={() => navigate('more', 'connections')} className="transition-colors duration-150 hover:text-foreground">
          {sync ? t('manage') : t('connect')}
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-[30px] leading-tight font-semibold tracking-tight">{title}</h1>
        {needsPlan && (
          <button
            onClick={() => openSession(null, weeksAway === 1 ? t('planNextWeek') : t('planWeekOf', { date: monthDay(monday) }))}
            className="pressable shrink-0 rounded-full bg-draft-chip px-3 py-1 text-xs whitespace-nowrap text-draft-ink hover:bg-draft/25"
          >
            {t('noTodos')} · {t('askToPlan')}
          </button>
        )}
      </div>
      {/* Pinned to the right edge, so they stay put however long the title is. */}
      <div className="flex items-center gap-3 justify-self-end">
        <div className="flex gap-1.5">
          <Button variant="secondary" size="icon" className="rounded-full bg-muted" aria-label={t('nav.previous')} onMouseDown={keepFocus} onClick={() => api.prev()}>
            <ChevronLeft />
          </Button>
          <Button variant="secondary" className="rounded-full bg-muted px-3.5" onMouseDown={keepFocus} onClick={() => setCalendarDate(today)}>
            {t('nav.today')}
          </Button>
          <Button variant="secondary" size="icon" className="rounded-full bg-muted" aria-label={t('nav.next')} onMouseDown={keepFocus} onClick={() => api.next()}>
            <ChevronRight />
          </Button>
        </div>
        <Segmented
          label={t('nav.view')}
          value={view}
          onChange={setCalendarView}
          options={(['day', 'week', 'month'] as const).map((v) => ({ value: v, label: t(`views.${v}`) }))}
        />
      </div>
    </header>
  )
}

/**
 * Toolbar buttons don't take focus when clicked, like buttons in a macOS
 * toolbar, so no focus ring is left behind. Tab still reaches them.
 */
const keepFocus = (e: React.MouseEvent) => e.preventDefault()

function headerTitle(view: CalendarViewName, date: ISODate, today: ISODate, weekTitle: string, language: string) {
  if (view === 'month') {
    return { range: '', title: new Intl.DateTimeFormat(language, { year: 'numeric', month: 'long' }).format(parseDate(date)) }
  }
  if (view === 'day') {
    // 今天, 昨天 and 明天 go by name with the date above; other days go by date with how far away they are above.
    const days = Math.round((+parseDate(date) - +parseDate(today)) / 86_400_000)
    const away = new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(days, 'day')
    return Math.abs(days) <= 1 ? { range: longDate(date), title: dayLabel(date, today) } : { range: away, title: longDate(date) }
  }
  const monday = mondayOf(date)
  return { range: `${monthDay(monday)} – ${monthDay(addDays(monday, 6))}`, title: weekTitle }
}

/**
 * The grid, and the drop target for todos dragged in from the backlog. While
 * one is over the grid, a dashed ghost shows where and how long it will land.
 */
function DropArea() {
  const moveTodo = useStore((s) => s.moveTodo)
  const { internals } = useEventCalendar()
  const [ghost, setGhost] = useState<{ left: number; top: number; width: number; height: number } | null>(null)
  const content = useSlideOnNavigate()

  // The dragged chip's top-left marks where the todo starts, like the top edge of a block.
  const landing = (rect: { left: number; top: number }) => {
    const root = internals.getRootEl()
    return root ? slotAtPoint(root, rect.left + 12, rect.top + 2) : null
  }
  const lengthOf = (id: string) => useStore.getState().todos.find((x) => x.id === id)?.estimateMinutes ?? 30
  const snap = (minutes: number, length: number) => Math.max(0, Math.min(24 * 60 - length, Math.round(minutes / 15) * 15))

  const { setNodeRef } = useDropTarget('calendar', {
    onDrop: (item, rect) => {
      const slot = landing(rect)
      if (!slot) return
      const todo = useStore.getState().todos.find((x) => x.id === item.id)
      const start = slot.minutes === undefined ? (todo?.slot?.start ?? DEFAULT_HOUR) : snap(slot.minutes, lengthOf(item.id)) / 60
      moveTodo(item.id, { date: toISODate(slot.day), start })
    },
  })

  useDndMonitor({
    onDragMove: ({ active }) => {
      const rect = active.rect.current.translated
      const id = (active.data.current as { item: { id: string } }).item.id
      const slot = rect && landing(rect)
      if (!slot?.column || slot.minutes === undefined) return setGhost(null)
      const length = lengthOf(id)
      const { left, width, top, pxPerMinute } = slot.column
      setGhost({ left, width, top: top + snap(slot.minutes, length) * pxPerMinute, height: length * pxPerMinute })
    },
    onDragEnd: () => setGhost(null),
    onDragCancel: () => setGhost(null),
  })

  return (
    <div ref={setNodeRef} className="flex min-h-0 flex-1 flex-col">
      <div ref={content} className="flex min-h-0 flex-1 flex-col">
        <EventCalendarContent className="min-h-0 flex-1" />
      </div>
      {ghost && (
        <div
          className="pointer-events-none fixed z-50 rounded-sm border-[1.5px] border-dashed border-draft bg-draft-bg"
          style={{ left: ghost.left + 2, top: ghost.top, width: ghost.width - 4, height: ghost.height - 2 }}
        />
      )}
    </div>
  )
}

/**
 * When the calendar moves to another week, day or month, the new dates slide in
 * from the side they came from, so it's clear which way you went. Switching
 * between day, week and month only fades. The grid is animated in place rather
 * than remounted, so its scroll position stays.
 */
function useSlideOnNavigate() {
  const date = useStore((s) => s.calendarDate)
  const view = useStore((s) => s.calendarView)
  const ref = useRef<HTMLDivElement>(null)
  // What's on screen: moving the anchor date within the same week changes nothing.
  const period = view === 'week' ? mondayOf(date) : view === 'month' ? date.slice(0, 7) : date
  const previous = useRef({ period, view })

  useLayoutEffect(() => {
    const before = previous.current
    previous.current = { period, view }
    if (!ref.current || (before.period === period && before.view === view)) return
    const still = before.view !== view || matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = still ? 'none' : `translateX(${period > before.period ? 16 : -16}px)`
    ref.current.animate([{ opacity: 0.4, transform: from }, { opacity: 1, transform: 'none' }], {
      duration: still ? 150 : 180,
      easing: 'cubic-bezier(0.23, 1, 0.32, 1)',
    })
  }, [period, view])

  return ref
}

/** A time the user drew on the grid, waiting for a name. */
interface NewTodoSlot {
  date: ISODate
  start: number
  minutes: number
  x: number
  y: number
}

function newTodoSlot(slot: EventCalendarSlotDraft, at: { x: number; y: number }): NewTodoSlot {
  const minutes = slot.allDay ? 30 : Math.max(15, Math.round((+slot.end - +slot.start) / 60_000))
  return { date: toISODate(slot.start), start: slot.allDay ? DEFAULT_HOUR : hoursOf(slot.start), minutes, ...at }
}

/** Drawing on an empty part of the grid makes a todo there; this asks what it is. */
function NewTodo({ slot, onClose }: { slot: NewTodoSlot; onClose: () => void }) {
  const { t } = useTranslation('calendar')
  const addTodo = useStore((s) => s.addTodo)
  const { api } = useEventCalendar()
  const [text, setText] = useState('')
  const close = () => {
    api.clearSelection()
    onClose()
  }
  return (
    <div
      // Grows from its top-left corner, where the drag ended.
      className="fixed z-50 flex w-64 origin-top-left flex-col gap-1.5 rounded-xl border bg-popover p-2.5 text-popover-foreground shadow-lg transition-[opacity,scale] duration-150 ease-out starting:scale-96 starting:opacity-0"
      style={{ left: Math.min(slot.x + 8, window.innerWidth - 272), top: Math.min(slot.y - 8, window.innerHeight - 96) }}
    >
      <span className="px-0.5 text-xs text-muted-foreground">
        {longDate(slot.date)} · {clock(slot.start)}–{clock(slot.start + slot.minutes / 60)}
      </span>
      <Input
        autoFocus
        value={text}
        placeholder={t('grid.newTodo')}
        onChange={(e) => setText(e.target.value)}
        onBlur={close}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && text.trim()) {
            addTodo(text.trim(), { date: slot.date, start: slot.start }, slot.minutes)
            close()
          }
        }}
        className="h-9"
      />
    </div>
  )
}

/** ReUI's own strings and formats in the current language. Times are 24-hour in every language. */
function useGridLabels(): EventCalendarProps<Block>['i18n'] {
  const { t, i18n } = useTranslation('calendar')
  return useMemo(
    () => ({
      labels: {
        today: t('nav.today'),
        previous: t('nav.previous'),
        next: t('nav.next'),
        allDay: t('grid.allDay'),
        more: (count: number) => t('grid.more', { count }),
        moreCompact: (count: number) => `+${count}`,
        noEvents: t('grid.noEvents'),
        dropNotAllowed: t('grid.dropNotAllowed'),
        continues: t('grid.continues'),
        events: (count: number) => t('grid.events', { count }),
      },
      viewNames: { day: t('views.day'), week: t('views.week'), month: t('views.month') },
      formats: {
        timeGutter: 'HH:mm',
        timeGutterMinute: 'HH:mm',
        eventTime: 'HH:mm',
        moreDayHeader: i18n.language === 'zh-TW' ? 'M月d日 EEEE' : 'EEEE, MMMM d',
      },
    }),
    [t, i18n.language],
  )
}
