import { enUS, zhTW } from 'date-fns/locale'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useStore } from '@/data/store'
import type { Todo } from '@/data/types'
import { clock, duration, parseDate, toISODate } from '@/lib/time'
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

/** When it's on the calendar: a day from a month view and a time; or back to the backlog. */
export function SlotField({ todo }: { todo: Todo }) {
  const { t, i18n } = useTranslation()
  const { moveTodo } = useStore.getState()
  const today = useStore((s) => s.now.date)
  const [open, setOpen] = useState(false)
  const slot = todo.slot
  const time = slot ? clock(slot.start) : '09:00'
  const place = (date: string, at: string) => {
    const [h, m] = at.split(':').map(Number)
    moveTodo(todo.id, { date, start: h + m / 60 })
  }
  if (todo.fromCalendar) return <span className="text-[13.5px]">{slotLabel(todo)}</span>
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={`${row} w-full`} data-slot-field>
        {slotLabel(todo)}
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
          <span className="text-[12.5px] text-muted-foreground">{t('todo.at')}</span>
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
