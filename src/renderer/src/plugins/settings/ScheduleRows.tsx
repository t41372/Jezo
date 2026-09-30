import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Row } from '@/components/ListCard'
import { TimeField } from '@/components/TimeField'
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
        <TimeField
          value={schedule[kind]!}
          aria-label={t(kind)}
          onChange={(value) => change({ [kind]: value })}
        />
      )}
      <Switch checked={schedule[kind] !== null} onCheckedChange={(on) => change({ [kind]: on ? DEFAULTS[kind] : null })} aria-label={t(kind)} />
    </Row>
  ))
}
