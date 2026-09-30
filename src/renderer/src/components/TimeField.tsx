import { cn } from 'cn'
import { ChevronDown } from 'lucide-react'
import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

const pad = (value: number) => String(value).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, hour) => pad(hour))
const MINUTES = Array.from({ length: 12 }, (_, minute) => pad(minute * 5))

function selectedButton(column: RefObject<HTMLDivElement | null>) {
  return column.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]') ?? null
}

/** A 24-hour time, with separate hour and minute choices. */
export function TimeField({
  value,
  onChange,
  'aria-label': label,
}: {
  value: string
  onChange: (value: string) => void
  'aria-label': string
}) {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const hours = useRef<HTMLDivElement>(null)
  const minutes = useRef<HTMLDivElement>(null)
  const [hour, minute] = value.split(':')
  const minuteChoices = MINUTES.includes(minute) ? MINUTES : [...MINUTES, minute].sort()
  const switchColumn = (direction: 'left' | 'right') => selectedButton(direction === 'left' ? hours : minutes)?.focus()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="gap-1.5" aria-label={label} />}>
        <span className="font-mono tabular-nums">{value}</span>
        <ChevronDown className="size-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-fit p-1.5 animate-none data-open:animate-none data-closed:animate-none"
        initialFocus={() => selectedButton(hours)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            setOpen(false)
          }
        }}
      >
        <div className="flex gap-1.5">
          <TimeColumn
            columnRef={hours}
            label={t('timeField.hours')}
            values={HOURS}
            selected={hour}
            open={open}
            onChange={(next) => onChange(`${next}:${minute}`)}
            onSwitchColumn={switchColumn}
          />
          <div className="w-px self-stretch bg-card-border" />
          <TimeColumn
            columnRef={minutes}
            label={t('timeField.minutes')}
            values={minuteChoices}
            selected={minute}
            open={open}
            onChange={(next) => onChange(`${hour}:${next}`)}
            onSwitchColumn={switchColumn}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimeColumn({
  columnRef,
  label,
  values,
  selected,
  open,
  onChange,
  onSwitchColumn,
}: {
  columnRef: RefObject<HTMLDivElement | null>
  label: string
  values: string[]
  selected: string
  open: boolean
  onChange: (value: string) => void
  onSwitchColumn: (direction: 'left' | 'right') => void
}) {
  useLayoutEffect(() => {
    const column = columnRef.current
    const button = selectedButton(columnRef)
    if (open && column && button) {
      column.scrollTop = button.offsetTop - column.offsetTop - (column.clientHeight - button.offsetHeight) / 2
    }
  }, [open, selected, columnRef])

  return (
    <div ref={columnRef} role="group" aria-label={label} className="flex max-h-56 flex-col overflow-y-auto">
      {values.map((item, index) => (
        <button
          key={item}
          type="button"
          aria-pressed={item === selected}
          onClick={() => onChange(item)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              const next = Math.max(0, Math.min(values.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
              columnRef.current?.querySelectorAll<HTMLButtonElement>('button')[next]?.focus()
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault()
              onSwitchColumn(event.key === 'ArrowLeft' ? 'left' : 'right')
            }
          }}
          className={cn(
            'pressable h-8 shrink-0 rounded-md px-3 text-[13.5px] font-mono tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            item === selected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
          )}
        >
          {item}
        </button>
      ))}
    </div>
  )
}
