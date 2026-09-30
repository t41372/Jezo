import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Row } from '@/components/ListCard'
import { Switch } from '@/components/ui/switch'
import type { Schedule } from '../../../../shared/bridge'

const DEFAULTS: Schedule = { morning: '08:00', evening: '21:30' }

/** The morning plan and the evening check-in: when they start, or off. */
export function ScheduleRows() {
  const { t } = useTranslation('settings')
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  useEffect(() => {
    window.jezo.schedule.get().then(setSchedule)
  }, [])
  if (!schedule) return null
  const change = (c: Partial<Schedule>) => window.jezo.schedule.set(c).then(setSchedule)

  return (['morning', 'evening'] as const).map((kind) => (
    <Row key={kind} title={t(kind)} description={schedule[kind] ? t(`${kind}Hint`) : t('scheduleOff')}>
      {schedule[kind] && (
        <input
          type="time"
          value={schedule[kind]!}
          aria-label={t(kind)}
          onChange={(e) => e.target.value && change({ [kind]: e.target.value })}
          className="h-7 rounded-md bg-muted px-2 font-mono text-[13px] tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        />
      )}
      <Switch checked={schedule[kind] !== null} onCheckedChange={(on) => change({ [kind]: on ? DEFAULTS[kind] : null })} aria-label={t(kind)} />
    </Row>
  ))
}
