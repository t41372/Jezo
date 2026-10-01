import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useStore } from '@/data/store'
import { scheduleTime, scheduleWords, withTime } from '@/lib/schedule'
import { momentTime } from '@/lib/time'
import { cityOf } from '@/components/ZonePicker'
import { parseCatchUp } from '../../../../shared/catch-up'
import { offerUndo } from '@/lib/undo'
import type { AutomationRow } from '../../../../shared/bridge'
import type { Item } from '../../../../shared/workspace'
import { SectionHeader } from './parts'

/** The automations in the workspace, kept current as their files change. */
export function useAutomations() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    const load = () => window.jezo.workspace.list().then((all) => setItems(all.filter((i) => i.kind === 'automation' && !i.id.startsWith('?')).sort(byTime)))
    load()
    return window.jezo.workspace.onChange((changes) => {
      if (changes.removed.length || changes.changed.some((i) => i.kind === 'automation')) load()
    })
  }, [])
  return items
}

/** In the order of the day they run at; the rest after, by name. */
const byTime = (a: Item, b: Item) =>
  (scheduleTime(String(a.data.schedule)) ?? '~').localeCompare(scheduleTime(String(b.data.schedule)) ?? '~') || String(a.data.name).localeCompare(String(b.data.name))

const failed = (error: unknown) => toast(String(error instanceof Error ? error.message : error))
const data = (item: Item) => item.data as { name: string; schedule: string; state: 'on' | 'off'; zone?: string; catch_up?: string }

/** When it last ran, as a link to that conversation. */
function LastRun({ id }: { id: string }) {
  const { t } = useTranslation('more')
  const last = useStore((s) => s.sessions.find((x) => x.automation === id))
  const today = useStore((s) => s.now.date)
  const zone = useStore((s) => s.zone)
  if (!last) return <>{t('automations.never')}</>
  return (
    <button className="underline-offset-2 hover:underline" onClick={() => useStore.getState().openSession(last.id)}>
      {t('automations.last', { when: momentTime(last.started, zone, today) })}
    </button>
  )
}

/**
 * Conversations Jezo starts on its own at set times. Each is a file whose body is
 * what the agent is asked, so it's edited like a method (docs/design/backend.md, "Automations").
 */
export function Automations() {
  const { t } = useTranslation('more')
  const items = useAutomations()
  const { navigate, openSession } = useStore.getState()
  const add = (
    <Button variant="outline" size="sm" onClick={() => openSession(null, t('automations.addPrefill'))}>
      {t('automations.add')}
    </Button>
  )
  return (
    <>
      <SectionHeader title={t('sections.automations.title')} action={add}>{t('automations.intro')}</SectionHeader>
      <ListCard>
        {items.map((item) => (
          <div
            key={item.id}
            className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 has-[>button:hover]:bg-muted has-[>button:active]:bg-foreground/8"
            data-automation={item.id}
          >
            <button onClick={() => navigate('more', `automation:${item.id}`)} className="min-w-0 flex-1 text-left">
              <div className="text-[14.5px] font-medium">{data(item).name}</div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">{scheduleWords(data(item).schedule, data(item).zone)}</div>
            </button>
            <Switch
              checked={data(item).state === 'on'}
              onCheckedChange={(on) => void window.jezo.workspace.update(item.id, { state: on ? 'on' : 'off' }).catch(failed)}
              aria-label={data(item).name}
            />
          </div>
        ))}
      </ListCard>
      {items.length === 0 && <p className="text-[13px] text-muted-foreground">{t('automations.none')}</p>}
    </>
  )
}

/** One automation: when it runs, what it's asked, and running it now. */
export function AutomationView({ id }: { id: string }) {
  const { t } = useTranslation('more')
  const item = useAutomations().find((i) => i.id === id)
  const { navigate, openSession } = useStore.getState()
  const [request, setRequest] = useState<string | null>(null)
  if (!item) return null
  const { name, schedule, state, zone } = data(item)
  const time = scheduleTime(schedule)
  const update = (fields: Record<string, unknown>, body?: string) =>
    window.jezo.workspace.update(item.id, fields, body === undefined ? undefined : { body }).catch(failed)
  const remove = async () => {
    await window.jezo.workspace.remove(item.id).catch(failed)
    navigate('more', 'automations')
    offerUndo(t('automations.removed', { name }), () => void window.jezo.workspace.create('automation', item.data, item.body).catch(failed))
  }

  return (
    <>
      <button onClick={() => navigate('more', 'automations')} className="self-start text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground">
        {t('automations.back')}
      </button>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-[26px] font-semibold tracking-tight">{name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {scheduleWords(schedule, zone)} · <LastRun id={item.id} />
          </p>
        </div>
        <Switch checked={state === 'on'} onCheckedChange={(on) => void update({ state: on ? 'on' : 'off' })} aria-label={name} className="mt-2.5" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {time && (
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            {t('automations.time')}
            <Input type="time" className="h-8 w-36" value={time} onChange={(e) => e.target.value && void update({ schedule: withTime(schedule, e.target.value) })} />
          </label>
        )}
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void window.jezo.schedule.run(item.id).then((session) => openSession(session), failed)}>
          {t('automations.runNow')}
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void remove()}>
          {t('automations.remove')}
        </Button>
      </div>

      <CatchUpField item={item} />

      <section className="flex flex-col gap-2">
        <h2 className="mt-1.5 text-xs text-muted-foreground">{t('automations.request')}</h2>
        <Textarea
          className="min-h-48 text-[14px] leading-relaxed"
          value={request ?? item.body}
          onChange={(e) => setRequest(e.target.value)}
          onBlur={() => {
            if (request !== null && request !== item.body) void update({}, request)
            setRequest(null)
          }}
          aria-label={t('automations.request')}
        />
        <p className="text-[12.5px] text-muted-foreground">{t('automations.requestHint')}</p>
      </section>

      <AutomationHistory item={item} />
    </>
  )
}

/** The catch-up choices the page offers; the file can hold others, like "for 90 minutes" (docs/design/automations.md). */
const WINDOWS = ['no', 'for 2 hours', 'until 18:00', 'until end of day', 'until next time'] as const

/** How late a missed time may still start, in a sentence, with a choice of others. */
function CatchUpField({ item }: { item: Item }) {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const d = data(item)
  const value = d.catch_up
  const clockOf = (v: string | undefined) => {
    const window = (() => {
      try {
        return parseCatchUp({ catch_up: v })
      } catch {
        return null
      }
    })()
    return window?.kind === 'until' ? `${String(window.hour).padStart(2, '0')}:${String(window.minute).padStart(2, '0')}` : '18:00'
  }
  const [clock, setClock] = useState(() => clockOf(value))
  // Read the way the scheduler reads it. A schedule with more than one time a day has no one time to name.
  const time = scheduleTime(d.schedule)
  const at = time && (d.zone && d.zone !== 'local' ? t('automations.inZone', { words: time, city: cityOf(d.zone) }) : time)
  const words = (v: string | undefined) => {
    let window
    try {
      window = parseCatchUp({ catch_up: v })
    } catch {
      return v ?? ''
    }
    const any = at ? '' : 'Any'
    if (window.kind === 'no') return t('automations.window.no')
    if (window.kind === 'end-of-day') return t(`automations.window.endOfDay${any}`, { time: at })
    if (window.kind === 'next') return t(`automations.window.next${any}`, { time: at })
    if (window.kind === 'until') return t(`automations.window.until${any}`, { time: at, until: clockOf(v) })
    return t(`automations.window.for${any}`, { time: at, minutes: window.minutes })
  }
  const save = (v: string) => {
    void window.jezo.workspace.update(item.id, { catch_up: v }).catch(failed)
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        // Opened, it starts from what the file says now, which the agent may have changed.
        if (o) setClock(clockOf(value))
        setOpen(o)
      }}
    >
      <PopoverTrigger className="self-start text-left text-[13px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline" data-catch-up>
        {words(value)}
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-72 flex-col gap-0.5 p-1.5">
        {WINDOWS.filter((w) => w !== 'until 18:00').map((w) => (
          <button key={w} onClick={() => save(w)} className="rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-muted">
            {words(w)}
          </button>
        ))}
        <div className="flex items-center gap-2 px-2 py-1.5 text-[13px]">
          <button onClick={() => save(`until ${clock}`)} className="flex-1 text-left">{t('automations.window.untilPick')}</button>
          <Input type="time" className="h-7 w-28" value={clock} onChange={(e) => e.target.value && setClock(e.target.value)} aria-label={t('automations.window.untilPick')} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** What happened to its times, newest first: run, late, skipped, waiting, cut off. Each run opens its conversation. */
function AutomationHistory({ item }: { item: Item }) {
  const { t } = useTranslation('more')
  const [rows, setRows] = useState<AutomationRow[]>([])
  const device = useStore((s) => s.zone)
  const today = useStore((s) => s.now.date)
  const { openSession } = useStore.getState()
  useEffect(() => {
    let latest = 0
    const load = () => {
      const ask = ++latest
      void window.jezo.schedule.history(item.id).then((r) => ask === latest && setRows(r))
    }
    load()
    // The scheduler writes the history; the page follows it, retries and skipped times included.
    return window.jezo.schedule.onHistory((id) => id === item.id && load())
  }, [item.id])
  if (!rows.length) return null
  // A slot is a clock in the schedule's zone, named when it isn't this device's.
  const slot = (s: string, zone?: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))} ${s.slice(11, 16)}${zone && zone !== device ? ` ${cityOf(zone)}` : ''}`
  const line = (r: AutomationRow) => {
    if (r.kind === 'waiting') return t('automations.history.waiting', { slot: slot(r.slot) })
    if (r.kind === 'skipped') {
      const first = slot(r.slots[0])
      return r.reason === 'expired'
        ? t('automations.history.expired', { slot: first })
        : t(r.reason === 'replaced' ? 'automations.history.replaced' : 'automations.history.moved', { count: r.slots.length, slot: first })
    }
    const what = r.manual ? t('automations.history.manual', { at: momentTime(Date.parse(r.at), device, today) }) : r.slot ? t(r.late ? 'automations.history.late' : 'automations.history.onTime', { slot: slot(r.slot, r.zone) }) : ''
    return `${what} · ${t(`automations.history.outcome.${r.outcome}`)}`
  }
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="mt-1.5 text-xs text-muted-foreground">{t('automations.history.title')}</h2>
      <ul className="flex flex-col gap-1 text-[13px]" data-automation-history>
        {rows.map((r, i) => (
          <li key={i} className={r.kind === 'run' && (r.outcome === 'interrupted' || r.outcome === 'failed') ? 'text-warn' : r.kind === 'run' ? '' : 'text-muted-foreground'}>
            {line(r)}
            {r.kind === 'run' && r.session && (
              <button onClick={() => openSession(r.session!)} className="ml-2 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                {t('automations.history.open')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
