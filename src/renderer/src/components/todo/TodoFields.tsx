import { enUS, zhTW } from 'date-fns/locale'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { goalById, useStore, withMeaning } from '@/data/store'
import { ZonePicker } from '@/components/ZonePicker'
import { goalStyle } from '@/lib/goal-color'
import { cityOf } from '@/lib/zones'
import { epochOf, now, readTime, seriesFrom, todayIn } from '../../../../shared/time'
import { dayCode, dueLabel, meaningLabel, repeatLabel } from './format'
import type { Todo } from '@/data/types'
import { clock, duration, inZone, monthDay, parseDate, toISODate, weekday } from '@/lib/time'
import { slotLabel } from './format'

const MINUTES = [10, 15, 20, 30, 45, 60, 90, 120]
const row = 'flex min-h-8 items-center rounded-md px-1.5 -mx-1.5 text-left text-[13.5px] transition-colors duration-150 hover:bg-muted'

/** A todo's title, edited in place. Enter or leaving the field saves; an empty title keeps the old one. */
export function TitleField({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  const [text, setText] = useState(todo.title)
  useEffect(() => setText(todo.title), [todo.title])
  const save = () => {
    const title = text.trim()
    if (title && title !== todo.title) useStore.getState().editTodo(todo.id, { title })
    else setText(todo.title)
  }
  return (
    <textarea
      value={text}
      rows={1}
      onChange={(e) => setText(e.target.value.replace(/\n/g, ''))}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault()
          e.currentTarget.blur()
        }
      }}
      className="-mx-1.5 resize-none rounded-md bg-transparent px-1.5 text-[19px] leading-snug font-semibold outline-none [field-sizing:content] hover:bg-muted focus:bg-muted"
      aria-label={t('todo.title')}
    />
  )
}

/** The situation it gets done in, edited in place. */
export function CueField({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  const [text, setText] = useState(todo.cue ?? '')
  useEffect(() => setText(todo.cue ?? ''), [todo.cue])
  const save = () => {
    const cue = text.trim()
    if (cue !== (todo.cue ?? '')) useStore.getState().editTodo(todo.id, { cue: cue || undefined })
  }
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.currentTarget.blur()}
      placeholder={t('todo.cuePlaceholder')}
      className={`${row} w-full bg-transparent outline-none placeholder:text-muted-foreground focus:bg-muted`}
      aria-label={t('todo.when')}
    />
  )
}

/**
 * When it's on the calendar: a day from a month view and a time; or back to the
 * backlog. The day and time are read in `zone`, the zone the calendar shows (the
 * device's unless it shows another), the same as dragging on the grid.
 */
export function SlotField({ todo, zone: shown }: { todo: Todo; zone?: string }) {
  const { t, i18n } = useTranslation()
  const { moveTodo } = useStore.getState()
  const device = useStore((s) => s.zone)
  const zone = shown ?? device
  const today = useStore((s) => (zone === s.zone ? s.now.date : todayIn(zone, now()).toString()))
  const [open, setOpen] = useState(false)
  const slot = todo.slot && { ...todo.slot, ...inZone(todo.slot.at, zone) }
  const time = slot ? clock(slot.start) : '09:00'
  const place = (date: string, at: string) => {
    const [h, m] = at.split(':').map(Number)
    moveTodo(todo.id, { date, start: h + m / 60 }, { zone })
  }
  if (todo.fromCalendar) return <span className="text-[13.5px]">{slotLabel(todo, zone)}</span>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={`${row} w-full`} data-slot-field>
        {slotLabel(todo, zone)}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        <Calendar
          mode="single"
          selected={slot ? parseDate(slot.date) : undefined}
          defaultMonth={parseDate(slot?.date ?? today)}
          onSelect={(day) => day && place(toISODate(day), time)}
          locale={i18n.language.startsWith('zh') ? zhTW : enUS}
          className="bg-transparent"
        />
        <div className="flex items-center gap-2 border-t px-1 pt-2">
          <span className="text-[12.5px] text-muted-foreground">{zone === device ? t('todo.at') : `${t('todo.meaning.reading', { city: cityOf(zone) })} ${t('todo.at')}`}</span>
          <Input
            type="time"
            className="h-8 w-32"
            value={time}
            onChange={(e) => e.target.value && place(slot?.date ?? today, e.target.value)}
            aria-label={t('todo.at')}
          />
          <span className="flex-1" />
          {slot && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                moveTodo(todo.id, null)
                setOpen(false)
              }}
            >
              {t('todo.unschedule')}
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** How long it takes: common lengths in one tap, or any number of minutes. */
export function EstimateField({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(String(todo.estimateMinutes))
  useEffect(() => setMinutes(String(todo.estimateMinutes)), [todo.estimateMinutes])
  const set = (value: number) => {
    if (value >= 1 && value !== todo.estimateMinutes) useStore.getState().editTodo(todo.id, { estimateMinutes: Math.round(value) })
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={`${row} w-full`} data-estimate-field>
        {duration(todo.estimateMinutes)}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="flex w-64 flex-col gap-2 p-2.5">
        <div className="flex flex-wrap gap-1.5">
          {MINUTES.map((m) => (
            <Button
              key={m}
              size="sm"
              variant={m === todo.estimateMinutes ? 'default' : 'outline'}
              className="h-7 rounded-full px-2.5 text-[12.5px]"
              onClick={() => {
                set(m)
                setOpen(false)
              }}
            >
              {duration(m)}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Input
            type="number"
            min={1}
            className="h-8 w-20"
            value={minutes}
            onChange={(e) => setMinutes(e.target.value)}
            onBlur={() => set(Number(minutes))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                set(Number(minutes))
                setOpen(false)
              }
            }}
            aria-label={t('todo.minutes')}
          />
          {t('todo.minutes')}
        </label>
      </PopoverContent>
    </Popover>
  )
}

/**
 * The zone the time is fixed to (docs/design/time.md). Changing it keeps the
 * clock and says what the time becomes before it's saved.
 */
export function ZoneField({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  const device = useStore((s) => s.zone)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const current = todo.slot?.zone ?? null
  const result = picked && todo.times?.scheduled ? withMeaning(todo.times.scheduled, picked, device) : null
  // Both clocks with their dates: 09:00 Tokyo on Mon Oct 5 is Sun Oct 4 17:00 in Phoenix.
  const resultLabel = (() => {
    const value = result && readTime(result)
    if (!value || !picked) return ''
    const at = epochOf(value, device)!
    const when = ({ date, start }: { date: string; start: number }) => `${monthDay(date)} ${weekday(date)} ${clock(start)}`
    return t('todo.meaning.will', { city: cityOf(picked), own: when(inZone(at, picked)), here: when(inZone(at, device)) })
  })()
  if (!todo.slot || todo.fromCalendar) return null
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); setPicked(null) }}>
      <PopoverTrigger className={`${row} w-full`} data-zone-field>
        {meaningLabel(todo, device)}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        {picked ? (
          <div className="flex w-64 flex-col gap-2 p-1 text-[13px]" data-zone-result>
            <span>{resultLabel}</span>
            <div className="flex justify-end gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setPicked(null)}>{t('todo.meaning.cancel')}</Button>
              <Button size="sm" onClick={() => { useStore.getState().setTimeMeaning(todo.id, picked); setOpen(false) }}>{t('todo.meaning.keep')}</Button>
            </div>
          </div>
        ) : (
          <ZonePicker
            value={current}
            placeholder={t('todo.meaning.search')}
            first={[{ value: device, label: t('todo.meaning.device', { city: cityOf(device) }) }]}
            onPick={(zone) => zone && zone !== current && setPicked(zone)}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

/** The goal it serves, as a chip in the goal's color; choosing another (or none) moves it. */
export function GoalField({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const goals = useStore((s) => s.goals)
  const goal = goalById(goals, todo.goalId)
  const choose = (goalId: string | null) => {
    if (goalId !== todo.goalId) useStore.getState().editTodo(todo.id, { goalId })
    setOpen(false)
  }
  const option = (id: string | null, name: string, hue?: number) => (
    <button
      key={id ?? 'none'}
      onClick={() => choose(id)}
      style={goalStyle(hue)}
      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-muted aria-pressed:font-medium"
      aria-pressed={id === todo.goalId}
    >
      <span className={hue === undefined ? 'size-2 rounded-full border border-foreground/30' : 'size-2 rounded-full bg-goal'} />
      {name}
    </button>
  )
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="rounded-md bg-goal-tint px-2.5 py-0.5 text-[11.5px] font-medium text-goal-deep transition-[filter] duration-150 hover:brightness-95"
        aria-label={`${t('todo.goal')}: ${goal?.name ?? t('todo.noGoal')}`}
        data-goal-field
      >
        {goal?.name ?? t('todo.noGoal')}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="flex w-56 flex-col p-1.5">
        {goals.filter((g) => g.state === 'active' || g.id === todo.goalId).map((g) => option(g.id, g.name, g.hue))}
        {option(null, t('todo.noGoal'))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * When it has to be done by: a day from the month view, a time if it has one,
 * the zone that time is in (this device's unless picked), or none.
 */
export function DueField({ todo }: { todo: Todo }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const today = useStore((s) => s.now.date)
  const device = useStore((s) => s.zone)
  const { setDue } = useStore.getState()
  const label = dueLabel(todo, today) ?? t('todo.noDue')
  const zone = todo.due?.zone ?? device
  // The deadline's own day and clock, in its zone.
  const own = todo.due && todo.due.time !== undefined ? inZone(todo.due.at, zone) : todo.due && { date: todo.due.date, start: undefined }
  const set = (date: string, time: number | undefined, in_ = zone) => setDue(todo.id, { date, time, zone: in_ })
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); setPicking(false) }}>
      <PopoverTrigger className={`${row} w-full ${todo.due ? '' : 'text-muted-foreground'}`} data-due-field>
        {label}
        {todo.due?.zone && todo.due.zone !== device && <span className="ml-1.5 text-muted-foreground">{t('todo.meaning.here', { city: cityOf(todo.due.zone) })}</span>}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-auto p-2">
        {picking ? (
          <ZonePicker
            value={zone}
            placeholder={t('todo.meaning.search')}
            first={[{ value: device, label: t('todo.meaning.device', { city: cityOf(device) }) }]}
            onPick={(picked) => {
              // The clock stays; it's read in the zone picked.
              if (picked && own) set(own.date, own.start, picked)
              setPicking(false)
            }}
          />
        ) : (
          <>
            <Calendar
              mode="single"
              selected={own ? parseDate(own.date) : undefined}
              defaultMonth={parseDate(own?.date ?? today)}
              onSelect={(day) => day && set(toISODate(day), own?.start)}
              locale={i18n.language.startsWith('zh') ? zhTW : enUS}
              className="bg-transparent"
            />
            <div className="flex items-center gap-2 border-t px-1 pt-2">
              <span className="text-[12.5px] text-muted-foreground">{t('todo.dueTime')}</span>
              <Input
                type="time"
                className="h-8 w-32"
                value={own?.start === undefined ? '' : clock(own.start)}
                onChange={(e) => {
                  const [h, m] = e.target.value.split(':').map(Number)
                  set(own?.date ?? today, e.target.value ? h + m / 60 : undefined)
                }}
                aria-label={t('todo.dueTime')}
              />
              <span className="flex-1" />
              {todo.due && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => {
                    setDue(todo.id, null)
                    setOpen(false)
                  }}
                >
                  {t('todo.noDue')}
                </Button>
              )}
            </div>
            {own?.start !== undefined && (
              <button className="mt-1 w-full rounded-md px-1 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted" onClick={() => setPicking(true)} data-due-zone>
                {t('todo.meaning.reading', { city: cityOf(zone) })}
              </button>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * How it repeats: the common rules in words, from the todo's own date, or
 * 做完後幾天; 不再重複 ends the series and leaves the times there are.
 */
export function RepeatField({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const zone = useStore((s) => s.zone)
  const series = useStore((s) => s.repeats.find((r) => r.id === todo.series))
  const [days, setDays] = useState('7')
  const live = series && series.state !== 'ended' ? series : undefined
  // The series' own date, where its clock is, which can differ from the day shown here.
  const day = seriesFrom(todo.times?.scheduled, todo.times?.due, zone).date
  const date = day.toString()
  const choices: { rule: string; from: 'schedule' | 'done' }[] = [
    { rule: 'FREQ=DAILY', from: 'schedule' },
    { rule: `FREQ=WEEKLY;BYDAY=${dayCode(date)}`, from: 'schedule' },
    { rule: `FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode(date)}`, from: 'schedule' },
    { rule: `FREQ=MONTHLY;BYMONTHDAY=${day.day}`, from: 'schedule' },
    { rule: `FREQ=YEARLY;BYMONTH=${day.month};BYMONTHDAY=${day.day}`, from: 'schedule' },
  ]
  const pick = (choice: { rule: string; from: 'schedule' | 'done' } | null) => {
    void useStore.getState().setRepeat(todo.id, choice)
    setOpen(false)
  }
  const label = live ? repeatLabel(live.rule, live.from) : t('todo.repeat.none')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={`${row} w-full ${live ? '' : 'text-muted-foreground'}`} data-repeat-field>
        {label}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="flex w-60 flex-col p-1.5">
        {choices.map((c) => (
          <button
            key={c.rule}
            onClick={() => pick(c)}
            aria-pressed={live?.rule === c.rule && live.from === c.from}
            className="rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-muted aria-pressed:font-medium"
          >
            {repeatLabel(c.rule, c.from)}
          </button>
        ))}
        <div className="flex items-center gap-1.5 px-2 py-1 text-[13px]">
          <Input type="number" min={1} className="h-7 w-16" value={days} onChange={(e) => setDays(e.target.value)} aria-label={t('todo.repeat.days')} />
          <button
            onClick={() => Number(days) >= 1 && pick({ rule: `FREQ=DAILY;INTERVAL=${Math.round(Number(days))}`, from: 'done' })}
            className="flex-1 rounded-md px-1.5 py-1 text-left transition-colors duration-150 hover:bg-muted"
            data-repeat-after-done
          >
            {repeatLabel(`FREQ=DAILY;INTERVAL=${Math.max(1, Math.round(Number(days) || 1))}`, 'done')}
          </button>
        </div>
        {live && (
          <button onClick={() => pick(null)} className="mt-1 rounded-md border-t px-2 pt-2 pb-1.5 text-left text-[13px] text-muted-foreground hover:text-foreground">
            {t('todo.repeat.stop')}
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}
