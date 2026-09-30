// Calendars as the main process sends them to the windows
// (docs/design/calendar.md). Times are local, written like the rest of Jezo:
// 2026-09-29T09:30, or 2026-09-29 for a whole day.

/** An event on one of the user's calendars. Read-only in Jezo. */
export interface CalendarEvent {
  /** Unique per occurrence, so each occurrence of a repeating event has its own. */
  id: string
  /** The calendar it's on (CalendarInfo.id). */
  calendar: string
  title: string
  start: string
  /** Exclusive: an all-day event on the 1st ends on the 2nd. */
  end: string
  allDay?: boolean
  location?: string
  /** The event's description. Outside content: it can say anything. */
  notes?: string
  url?: string
  repeats?: boolean
}

/** One calendar, from a subscription or from the Mac. */
export interface CalendarInfo {
  id: string
  name: string
  color?: string
  /** Where it comes from: the subscription's name, or the account on the Mac (iCloud, Google…). */
  account: string
  source: string
  hidden: boolean
}

export type SourceState = 'ok' | 'syncing' | 'error' | 'needs-access' | 'denied' | 'off'

/** A place calendars come from: the Mac's calendars, or one subscription. */
export interface CalendarSource {
  /** "mac", or the subscription's id. */
  id: string
  kind: 'mac' | 'ics'
  name: string
  state: SourceState
  /** When it last read the calendar successfully, as an ISO instant. */
  syncedAt?: string
  /** What went wrong, in the words of whatever failed. */
  error?: string
}

export interface CalendarStatus {
  sources: CalendarSource[]
  calendars: CalendarInfo[]
}
