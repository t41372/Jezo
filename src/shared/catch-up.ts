// An automation's catch-up window, in the plain words its file uses
// (docs/design/automations.md, "The catch-up window"). On its own, so the
// workspace's checks and the automation's page can read it without the scheduler.

/** How long a missed time may still start, read from `catch_up` (docs/design/automations.md, "The catch-up window"). */
export type CatchUp = { kind: 'no' } | { kind: 'for'; minutes: number } | { kind: 'until'; hour: number; minute: number } | { kind: 'end-of-day' } | { kind: 'next' }

/** Reads `catch_up`; without one, a missed time may start for 2 hours. Throws with the forms it takes. */
export function parseCatchUp(data: { catch_up?: unknown }): CatchUp {
  const text = typeof data.catch_up === 'string' ? data.catch_up.trim().toLowerCase() : undefined
  if (text === undefined) return { kind: 'for', minutes: 120 }
  if (text === 'no') return { kind: 'no' }
  if (text === 'until end of day') return { kind: 'end-of-day' }
  if (text === 'until next time') return { kind: 'next' }
  const span = /^for (\d+) (minutes?|hours?)$/.exec(text)
  if (span && Number(span[1]) > 0) return { kind: 'for', minutes: Number(span[1]) * (span[2].startsWith('hour') ? 60 : 1) }
  const until = /^until (\d{1,2}):(\d{2})$/.exec(text)
  if (until && Number(until[1]) < 24 && Number(until[2]) < 60) return { kind: 'until', hour: Number(until[1]), minute: Number(until[2]) }
  throw new Error(`catch_up "${data.catch_up}" isn't one Jezo reads. Write no, for 90 minutes, for 2 hours, until 18:00, until end of day, or until next time.`)
}
