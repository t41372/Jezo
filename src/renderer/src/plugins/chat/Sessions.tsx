import { Plus } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/data/store'
import { clock, dayLabel, inZone } from '@/lib/time'
import { sessionTitle } from './session'

/** Past conversations, newest first, grouped by day. */
export function Sessions() {
  const sessions = useStore((s) => s.sessions)
  const current = useStore((s) => s.sessionId)
  const openSession = useStore((s) => s.openSession)
  const today = useStore((s) => s.now.date)
  const zone = useStore((s) => s.zone)
  const { t } = useTranslation('chat')
  const when = (s: (typeof sessions)[number]) => inZone(s.started, zone)
  const days = [...new Set(sessions.map((s) => when(s).date))]

  return (
    <div className="flex w-[250px] shrink-0 flex-col gap-1 overflow-auto border-r px-2.5 py-3">
      <Button variant="secondary" className="mb-2.5 h-9 gap-2 rounded-[10px] bg-muted hover:bg-foreground/8" onClick={() => openSession(null)}>
        <Plus />
        {t('newChat')}
        <Kbd className="bg-transparent font-mono text-[11px] text-muted-foreground">⌥X</Kbd>
      </Button>
      {days.map((day) => (
        <section key={day} className="flex flex-col gap-1">
          <h3 className="px-2.5 pt-2.5 pb-1 text-[11.5px] text-muted-foreground">{dayLabel(day, today)}</h3>
          {sessions
            .filter((s) => when(s).date === day)
            .map((s) => (
              <button
                key={s.id}
                onClick={() => openSession(s.id)}
                className={cn(
                  'flex flex-col gap-0.5 rounded-[9px] px-2.5 py-2 text-left transition-colors duration-150',
                  s.id === current ? 'bg-accent' : 'hover:bg-muted active:bg-foreground/8',
                )}
              >
                <span className={cn('text-[13.5px]', s.id === current ? 'font-semibold' : 'font-medium')}>{sessionTitle(s)}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  {clock(when(s).start)} · {t(`trigger.${s.trigger}.short`, { ns: 'common' })}
                </span>
              </button>
            ))}
        </section>
      ))}
    </div>
  )
}
