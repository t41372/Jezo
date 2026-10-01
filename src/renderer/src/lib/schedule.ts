import cronstrue from 'cronstrue/i18n'
import { cityOf } from '@/components/ZonePicker'
import i18n from '@/i18n'

/** A time of day from a schedule whose minute and hour are plain numbers, as "08:00". */
export function scheduleTime(cron: string) {
  const [minute, hour] = cron.split(' ')
  return /^\d+$/.test(minute) && /^\d+$/.test(hour) ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}` : null
}

/** Sets the time of day in a schedule, keeping which days it runs. */
export function withTime(cron: string, time: string) {
  const [hour, minute] = time.split(':').map(Number)
  return [minute, hour, ...cron.split(' ').slice(2)].join(' ')
}

const weekday = (day: number) =>
  // 2023-01-01 was a Sunday; cron counts Sunday as 0 or 7.
  new Intl.DateTimeFormat(i18n.language, { weekday: 'short' }).format(new Date(2023, 0, 1 + (day % 7)))

/**
 * A schedule in words: "每天 08:00", "每週日 20:00", "週一到週五 09:00".
 * The shapes people use most are said the way a person would; anything else
 * goes to cronstrue, and a schedule that doesn't parse is shown as it's written.
 */
export function scheduleWords(cron: string, zone?: string) {
  const words = scheduleIn(cron)
  // A schedule fixed to a zone runs by that zone's clock, wherever the user is.
  return zone && zone !== 'local' ? i18n.t('automations.inZone', { ns: 'more', words, city: cityOf(zone) }) : words
}

function scheduleIn(cron: string) {
  const time = scheduleTime(cron)
  const [, , dayOfMonth, month, days] = cron.split(' ')
  if (time && dayOfMonth === '*' && month === '*') {
    if (days === '*') return i18n.t('automations.daily', { ns: 'more', time })
    if (/^[0-7]$/.test(days)) return i18n.t('automations.weekly', { ns: 'more', time, day: weekday(Number(days)) })
    if (/^[0-7](,[0-7])+$/.test(days)) return i18n.t('automations.weekly', { ns: 'more', time, day: days.split(',').map((d) => weekday(Number(d))).join(i18n.t('automations.and', { ns: 'more' })) })
    const range = /^([0-7])-([0-7])$/.exec(days)
    if (range) return i18n.t('automations.range', { ns: 'more', time, from: weekday(Number(range[1])), to: weekday(Number(range[2])) })
  }
  try {
    return cronstrue.toString(cron, { locale: i18n.language.replace('-', '_'), use24HourTimeFormat: true }).replace(/\s+/g, ' ')
  } catch {
    return cron
  }
}
