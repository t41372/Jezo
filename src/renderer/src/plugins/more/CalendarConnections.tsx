// The calendars part of 連接: the Mac's own calendars, which bring every account
// added to the Mac, and ICS subscriptions. Each calendar can be hidden
// (docs/design/calendar.md).

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarInfo, CalendarSource } from '../../../../shared/calendar'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { useStore } from '@/data/store'
import { ago } from '@/lib/time'

/** What IPC puts in front of an error thrown in the main process. */
const reason = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function SourceState({ source }: { source: CalendarSource }) {
  const { t, i18n } = useTranslation('more')
  if (source.state === 'syncing') return <>{t('calendars.syncing')}</>
  if (source.state === 'error') return <span className="text-destructive">{t('calendars.failed', { error: source.error })}</span>
  // The Mac's calendars are read as they are, so there's no "last synced" to speak of.
  if (source.kind === 'mac') return <>{t('calendars.macLive')}</>
  return <>{source.syncedAt ? t('calendars.synced', { ago: ago(source.syncedAt, i18n.language) }) : t('connections.connected')}</>
}

function Shown({ calendar }: { calendar: CalendarInfo }) {
  const { t } = useTranslation('more')
  return (
    <Switch
      checked={!calendar.hidden}
      onCheckedChange={(shown) => void window.jezo.calendar.setHidden(calendar.id, !shown)}
      aria-label={t('calendars.show', { name: calendar.name })}
    />
  )
}

function Dot({ color }: { color?: string }) {
  return <span className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40" style={color ? { background: color } : undefined} />
}

function MacRow({ source, calendars }: { source: CalendarSource; calendars: CalendarInfo[] }) {
  const { t } = useTranslation('more')
  const [asking, setAsking] = useState(false)
  const connect = async () => {
    setAsking(true)
    try {
      await window.jezo.calendar.connectMac()
    } finally {
      setAsking(false)
    }
  }
  const accounts = [...new Set(calendars.map((c) => c.account))]
  return (
    <div>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">{t('calendars.mac')}</div>
          <div className="mt-0.5 text-[12.5px] text-pretty text-muted-foreground">
            {source.state === 'off' || source.state === 'needs-access' ? t('calendars.macDetail') : source.state === 'denied' ? t('calendars.macDenied') : <SourceState source={source} />}
          </div>
        </div>
        {source.state === 'off' || source.state === 'needs-access' ? (
          <Button variant="outline" size="sm" disabled={asking} onClick={() => void connect()}>
            {t('connections.connect')}
          </Button>
        ) : source.state === 'denied' ? (
          <Button variant="outline" size="sm" onClick={() => void window.jezo.calendar.openMacSettings()}>
            {t('calendars.openSettings')}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void window.jezo.calendar.disconnectMac()}>
            {t('calendars.disconnect')}
          </Button>
        )}
      </div>
      {accounts.map((account) => (
        <div key={account} className="px-4 pb-3">
          <div className="pb-1 text-[12px] font-medium text-muted-foreground">{account}</div>
          {calendars
            .filter((c) => c.account === account)
            .map((c) => (
              <div key={c.id} className="flex items-center gap-2.5 py-1.5">
                <Dot color={c.color} />
                <span className="flex-1 truncate text-[13.5px]">{c.name}</span>
                <Shown calendar={c} />
              </div>
            ))}
        </div>
      ))}
    </div>
  )
}

function SubscriptionRow({ source, calendar }: { source: CalendarSource; calendar?: CalendarInfo }) {
  const { t } = useTranslation('more')
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <Dot color={calendar?.color} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14.5px] font-medium">{source.name}</div>
        <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
          <SourceState source={source} />
        </div>
      </div>
      {source.state === 'error' && (
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void window.jezo.calendar.refresh(source.id)}>
          {t('calendars.retry')}
        </Button>
      )}
      <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => void window.jezo.calendar.unsubscribe(source.id)}>
        {t('calendars.remove')}
      </Button>
      {calendar && <Shown calendar={calendar} />}
    </div>
  )
}

function SubscribeDialog() {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const reset = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setUrl('')
      setName('')
      setError(null)
    }
  }
  const subscribe = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.jezo.calendar.subscribe(url, name || undefined)
      reset(false)
    } catch (e) {
      setError(reason(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{t('calendars.subscribe')}</DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t('calendars.subscribe')}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{t('calendars.subscribeHint')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim()) void subscribe()
          }}
        >
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            {t('calendars.url')}
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/basic.ics" autoFocus autoComplete="off" spellCheck={false} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-medium">
            {t('calendars.name')}
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('calendars.namePlaceholder')} />
          </label>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{t('calendars.google')}</p>
          {error && <p className="text-[13px] text-destructive">{t('calendars.subscribeFailed', { error })}</p>}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="ghost" />}>{t('connections.cancel')}</DialogClose>
            <Button type="submit" disabled={!url.trim() || busy}>
              {busy ? t('calendars.checking') : t('calendars.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function CalendarConnections() {
  const { t } = useTranslation('more')
  const status = useStore((s) => s.calendarStatus)
  if (!status) return null
  const mac = status.sources.find((s) => s.kind === 'mac')
  const subscriptions = status.sources.filter((s) => s.kind === 'ics')
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-end justify-between px-1">
        <h2 className="text-sm font-medium">{t('calendars.title')}</h2>
        <SubscribeDialog />
      </div>
      <ListCard>
        {mac && <MacRow source={mac} calendars={status.calendars.filter((c) => c.source === 'mac')} />}
        {subscriptions.map((s) => (
          <SubscriptionRow key={s.id} source={s} calendar={status.calendars.find((c) => c.id === s.id)} />
        ))}
        {!mac && !subscriptions.length && <div className="px-4 py-3.5 text-[13px] text-muted-foreground">{t('calendars.none')}</div>}
      </ListCard>
      <p className="px-1 text-[12.5px] text-muted-foreground">{t('calendars.readOnly')}</p>
    </section>
  )
}
