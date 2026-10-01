import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useStore } from '@/data/store'
import { scheduleTime, scheduleWords, withTime } from '@/lib/schedule'
import { dayTime } from '@/lib/time'
import { offerUndo } from '@/lib/undo'
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
const data = (item: Item) => item.data as { name: string; schedule: string; state: 'on' | 'off' }

/** When it last ran, as a link to that conversation. */
function LastRun({ id }: { id: string }) {
  const { t } = useTranslation('more')
  const last = useStore((s) => s.sessions.find((x) => x.automation === id))
  const today = useStore((s) => s.now.date)
  if (!last) return <>{t('automations.never')}</>
  return (
    <button className="underline-offset-2 hover:underline" onClick={() => useStore.getState().openSession(last.id)}>
      {t('automations.last', { when: dayTime(last.date, last.time, today) })}
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
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">{scheduleWords(data(item).schedule)}</div>
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
  const { name, schedule, state } = data(item)
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
            {scheduleWords(schedule)} · <LastRun id={item.id} />
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
    </>
  )
}
