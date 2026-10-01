// Calendars as the main process sends them to the windows
// (docs/design/calendar.md). An event's times keep the meaning its calendar
// gave them, in the time module's forms (docs/design/time.md): a moment with
// the offset of the event's own zone ('2026-10-05T09:00:00-04:00'), a local
// time for an event that floats ('2026-10-05T09:00'), or a day ('2026-10-05').

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
  /** The zone the calendar keeps the event in, when it says: "America/New_York", or a name only the feed defines. For showing the event's own clock. */
  zone?: string
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
  /** "mac", the subscription's id, or "google:" and the account's email. */
  id: string
  kind: 'mac' | 'ics' | 'google'
  name: string
  state: SourceState
  /** When it last read the calendar successfully, as an ISO instant. */
  syncedAt?: string
  /** What went wrong, in the words of whatever failed. */
  error?: string
  /** What it read but couldn't be sure of. */
  problems?: SourceProblem[]
}

export type SourceProblem =
  /** Events use a time zone the feed names but doesn't define; they're shown as the clock written. */
  { kind: 'unknown-zone'; zone: string }

export interface CalendarStatus {
  sources: CalendarSource[]
  calendars: CalendarInfo[]
  /** Whether the user has given Jezo their own Google client (docs/design/calendar.md, "Google"). */
  googleClient: boolean
}
