import type { ISODate, Session } from '@/data/types'
import i18n from '@/i18n'
import { dayTime } from '@/lib/time'

/** Scheduled sessions are named after what started them. */
export function sessionTitle(session: Session) {
  return session.title ?? i18n.t(`trigger.${session.trigger}.title`)
}

/** "今天 08:02 · 每天早上自動開始" */
export function sessionHeadline(session: Session, today: ISODate) {
  const when = dayTime(session.date, session.time, today)
  const started = i18n.t(`trigger.${session.trigger}.started`)
  return started ? `${when} · ${started}` : when
}
