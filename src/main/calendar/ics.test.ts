// Written before ics.ts, from the ways reading a real calendar feed goes wrong.
// Every case is something Google, Outlook or Apple feeds actually do.
// Times are checked in Taipei (UTC+8, no daylight saving) so they're exact.
process.env.TZ = 'Asia/Taipei'

import { describe, expect, test } from 'bun:test'
import { readIcs } from './ics'

const feed = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR'].join('\r\n')
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
const read = (text: string, from = '2026-09-28', to = '2026-10-12') => readIcs(text, from, to)
const titled = (text: string, title: string, from?: string, to?: string) => read(text, from, to).events.filter((e) => e.title === title)

describe('times', () => {
  test('UTC times become local time', () => {
    const [e] = read(feed(...event('UID:a', 'SUMMARY:A', 'DTSTART:20260930T010000Z', 'DTEND:20260930T020000Z'))).events
    expect([e.start, e.end]).toEqual(['2026-09-30T09:00', '2026-09-30T10:00'])
  })

  test('a Windows zone name is read from the feed’s own VTIMEZONE, as Outlook sends it', () => {
    const text = feed(
      'BEGIN:VTIMEZONE', 'TZID:Pacific Standard Time',
      'BEGIN:STANDARD', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11', 'END:STANDARD',
      'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3', 'END:DAYLIGHT',
      'END:VTIMEZONE',
      ...event('UID:b', 'SUMMARY:B', 'DTSTART;TZID=Pacific Standard Time:20260930T090000', 'DTEND;TZID=Pacific Standard Time:20260930T100000'),
    )
    // 09:00 in PDT (UTC-7) is 00:00 the next day in Taipei.
    expect(read(text).events[0].start).toBe('2026-10-01T00:00')
  })

  test('an IANA zone with no VTIMEZONE is still converted, daylight saving included', () => {
    const text = feed(
      ...event('UID:c1', 'SUMMARY:Summer', 'DTSTART;TZID=America/New_York:20261001T090000', 'DURATION:PT1H'),
      ...event('UID:c2', 'SUMMARY:Winter', 'DTSTART;TZID=America/New_York:20261105T090000', 'DURATION:PT1H'),
    )
    expect(titled(text, 'Summer')[0].start).toBe('2026-10-01T21:00')
    expect(titled(text, 'Winter', '2026-11-01', '2026-11-10')[0].start).toBe('2026-11-05T22:00')
  })

  test('floating times use the feed’s X-WR-TIMEZONE, and local time without one', () => {
    const withZone = feed('X-WR-TIMEZONE:Europe/London', ...event('UID:d', 'SUMMARY:D', 'DTSTART:20261001T090000', 'DTEND:20261001T100000'))
    expect(read(withZone).events[0].start).toBe('2026-10-01T16:00')
    const without = feed(...event('UID:d', 'SUMMARY:D', 'DTSTART:20261001T090000', 'DTEND:20261001T100000'))
    expect(read(without).events[0].start).toBe('2026-10-01T09:00')
  })

  test('DURATION stands in for DTEND', () => {
    const [e] = read(feed(...event('UID:e', 'SUMMARY:E', 'DTSTART:20261001T010000Z', 'DURATION:PT90M'))).events
    expect(e.end).toBe('2026-10-01T10:30')
  })
})

describe('all-day events', () => {
  test('DTEND is exclusive, so a one-day event is one day', () => {
    const [e] = read(feed(...event('UID:f', 'SUMMARY:F', 'DTSTART;VALUE=DATE:20261001', 'DTEND;VALUE=DATE:20261002'))).events
    expect(e).toMatchObject({ allDay: true, start: '2026-10-01', end: '2026-10-02' })
  })

  test('with no DTEND it lasts one day', () => {
    const [e] = read(feed(...event('UID:g', 'SUMMARY:G', 'DTSTART;VALUE=DATE:20261001'))).events
    expect(e).toMatchObject({ allDay: true, start: '2026-10-01', end: '2026-10-02' })
  })

  test('an all-day date is not shifted by the time zone', () => {
    const text = feed('X-WR-TIMEZONE:America/Los_Angeles', ...event('UID:h', 'SUMMARY:H', 'DTSTART;VALUE=DATE:20261003', 'DTEND;VALUE=DATE:20261006'))
    expect(read(text).events[0]).toMatchObject({ start: '2026-10-03', end: '2026-10-06' })
  })
})

describe('repeating events', () => {
  const weekly = (...extra: string[][]) =>
    feed(
      ...event('UID:w', 'SUMMARY:Standup', 'DTSTART:20260902T013000Z', 'DTEND:20260902T014500Z', 'RRULE:FREQ=WEEKLY;BYDAY=WE', 'EXDATE:20261007T013000Z'),
      ...extra.flat(),
    )

  test('each occurrence in the range, none outside it, and none on an EXDATE', () => {
    expect(titled(weekly(), 'Standup').map((e) => e.start)).toEqual(['2026-09-30T09:30'])
  })

  test('a moved occurrence shows at its new time, not its old one', () => {
    const moved = event('UID:w', 'RECURRENCE-ID:20260930T013000Z', 'SUMMARY:Standup (moved)', 'DTSTART:20261001T060000Z', 'DTEND:20261001T061500Z')
    const events = read(weekly(moved)).events
    expect(events.filter((e) => e.title.startsWith('Standup')).map((e) => [e.title, e.start])).toEqual([['Standup (moved)', '2026-10-01T14:00']])
  })

  test('a cancelled occurrence is left out', () => {
    const cancelled = event('UID:w', 'RECURRENCE-ID:20260930T013000Z', 'SUMMARY:Standup', 'STATUS:CANCELLED', 'DTSTART:20260930T013000Z', 'DTEND:20260930T014500Z')
    expect(titled(weekly(cancelled), 'Standup')).toEqual([])
  })

  test('occurrences have their own ids, the same on every read', () => {
    const text = feed(...event('UID:daily', 'SUMMARY:Daily', 'DTSTART:20260901T000000Z', 'DURATION:PT30M', 'RRULE:FREQ=DAILY'))
    const ids = read(text).events.map((e) => e.id)
    expect(ids.length).toBe(14)
    expect(new Set(ids).size).toBe(14)
    expect(read(text).events.map((e) => e.id)).toEqual(ids)
  })

  test('a series that began years ago still only yields the range, quickly', () => {
    const text = feed(...event('UID:old', 'SUMMARY:Old', 'DTSTART:20100101T000000Z', 'DURATION:PT30M', 'RRULE:FREQ=DAILY'))
    const started = performance.now()
    expect(read(text).events.length).toBe(14)
    expect(performance.now() - started).toBeLessThan(500)
  })

  test('COUNT and UNTIL end a series', () => {
    const text = feed(
      ...event('UID:n', 'SUMMARY:Count', 'DTSTART:20260928T000000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=3'),
      ...event('UID:u', 'SUMMARY:Until', 'DTSTART:20260928T000000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;UNTIL=20260929T235959Z'),
    )
    expect(titled(text, 'Count').length).toBe(3)
    expect(titled(text, 'Until').length).toBe(2)
  })

  test('repeating all-day events keep their dates', () => {
    const text = feed(...event('UID:bd', 'SUMMARY:Birthday', 'DTSTART;VALUE=DATE:20001003', 'DTEND;VALUE=DATE:20001004', 'RRULE:FREQ=YEARLY'))
    expect(titled(text, 'Birthday')).toMatchObject([{ allDay: true, start: '2026-10-03', end: '2026-10-04', repeats: true }])
  })
})

describe('what counts as in range, and what is kept', () => {
  test('an event that started before the range and ends inside it is included', () => {
    const text = feed(...event('UID:x', 'SUMMARY:Trip', 'DTSTART;VALUE=DATE:20260925', 'DTEND;VALUE=DATE:20260930'))
    expect(titled(text, 'Trip').length).toBe(1)
  })

  test('an event that ends exactly when the range starts is not', () => {
    const text = feed(...event('UID:y', 'SUMMARY:Before', 'DTSTART;VALUE=DATE:20260927', 'DTEND;VALUE=DATE:20260928'))
    expect(titled(text, 'Before')).toEqual([])
  })

  test('a cancelled event is left out', () => {
    expect(read(feed(...event('UID:z', 'SUMMARY:Z', 'STATUS:CANCELLED', 'DTSTART:20261001T010000Z', 'DURATION:PT1H'))).events).toEqual([])
  })

  test('escaped text is unescaped, and location, notes and link are kept', () => {
    const [e] = read(
      feed(...event('UID:t', 'SUMMARY:Lunch\\, then a walk', 'LOCATION:Da\;an Park', 'DESCRIPTION:Line one\\nLine two', 'URL:https://example.com', 'DTSTART:20261001T040000Z', 'DURATION:PT1H')),
    ).events
    expect(e).toMatchObject({ title: 'Lunch, then a walk', location: 'Da;an Park', notes: 'Line one\nLine two', url: 'https://example.com' })
  })

  test('an event with no title gets an empty one, not "undefined"', () => {
    expect(read(feed(...event('UID:nt', 'DTSTART:20261001T040000Z', 'DURATION:PT1H'))).events[0].title).toBe('')
  })

  test('the feed’s own name is read, for naming the subscription', () => {
    expect(read(feed('X-WR-CALNAME:Taiwan holidays')).name).toBe('Taiwan holidays')
  })

  test('something that isn’t a calendar is an error, not an empty calendar', () => {
    expect(() => read('<html>Sign in</html>')).toThrow()
  })

  test('one broken event doesn’t hide the rest', () => {
    const text = feed(...event('UID:bad', 'SUMMARY:Bad', 'DTSTART:not-a-date'), ...event('UID:ok', 'SUMMARY:Ok', 'DTSTART:20261001T040000Z', 'DURATION:PT1H'))
    expect(read(text).events.map((e) => e.title)).toEqual(['Ok'])
  })
})
