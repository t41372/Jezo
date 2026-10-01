// Written before ics.ts, from the ways reading a real calendar feed goes wrong.
// Every case is something Google, Outlook, Apple or school (Canvas) feeds
// actually do. The second batch came from icsfeed's test catalog (2026-09-30).
// Times are checked as seen from Taipei (UTC+8, no daylight saving) so they're
// exact. Since 2026-10-01 an event keeps what its time meant (docs/design/time.md):
// the tests read each time as Taipei's clock, and the last group checks the meanings.
// The review of 2026-10-01 found these, written down before the fix:
//  - X-WR-TIMEZONE naming a zone the feed itself defines is ignored, and an unknown one isn't said;
//  - a zone the feed defines with a name Temporal also knows loses the feed's offset;
//  - seconds are dropped from IANA and floating times;
//  - an unknown zone is only found when an event using it falls in the dates asked about.

import { describe, expect, test } from 'bun:test'
import { formatTime, parseTime, resolve } from '../../shared/time'
import { readIcs, unknownZonesIn } from './ics'

const feed = (...lines: string[]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//test//EN', ...lines, 'END:VCALENDAR'].join('\r\n')
const event = (...lines: string[]) => ['BEGIN:VEVENT', ...lines, 'END:VEVENT']
const read = (text: string, from = '2026-09-28', to = '2026-10-12') => {
  const calendar = readIcs(text, from, to, 'Asia/Taipei')
  // Each timed event's times as Taipei's clock, the way these tests were first written.
  return { ...calendar, events: calendar.events.map((e) => (e.allDay ? e : { ...e, start: here(e.start), end: here(e.end) })) }
}
const here = (time: string) => resolve(parseTime(time, 'event'), 'Asia/Taipei')!.at.toPlainDateTime().toString({ smallestUnit: 'minute' })
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

describe('what school and hand-made feeds do', () => {
  test('a deadline with only DTSTART is an instant, not missing, even right at the start of the range', () => {
    const text = feed(...event('UID:due', 'SUMMARY:Essay due', 'DTSTART:20260927T160000Z'))
    const [e] = read(text).events
    expect([e.start, e.end]).toEqual(['2026-09-28T00:00', '2026-09-28T00:00'])
  })

  test('two events with the same UID and no RECURRENCE-ID are both kept, with different ids', () => {
    const text = feed(...event('UID:same', 'SUMMARY:One', 'DTSTART:20261001T010000Z', 'DURATION:PT1H'), ...event('UID:same', 'SUMMARY:Two', 'DTSTART:20261002T010000Z', 'DURATION:PT1H'))
    const ids = read(text).events.map((e) => e.id)
    expect(ids.length).toBe(2)
    expect(new Set(ids).size).toBe(2)
  })

  test('an event with no UID gets an id that is the same on every read', () => {
    const text = feed(...event('SUMMARY:No uid', 'DTSTART:20261001T010000Z', 'DURATION:PT1H'), ...event('SUMMARY:Also none', 'DTSTART:20261001T010000Z', 'DURATION:PT1H'))
    const ids = read(text).events.map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
    expect(read(text).events.map((e) => e.id)).toEqual(ids)
  })

  test('a zone nobody defines is read as local time, not dropped, and said', () => {
    const text = feed(...event('UID:cz', 'SUMMARY:Custom', 'DTSTART;TZID=Customized Time Zone:20261001T090000', 'DURATION:PT1H'))
    expect(read(text).events[0].start).toBe('2026-10-01T09:00')
    expect(read(text).unknownZones).toEqual(['Customized Time Zone'])
  })

  test('RDATE adds occurrences to a series', () => {
    const text = feed(...event('UID:rd', 'SUMMARY:Extra', 'DTSTART:20261001T010000Z', 'DURATION:PT1H', 'RRULE:FREQ=WEEKLY;COUNT=1', 'RDATE:20261003T010000Z'))
    expect(titled(text, 'Extra').map((e) => e.start)).toEqual(['2026-10-01T09:00', '2026-10-03T09:00'])
  })

  test('THISANDFUTURE moves that occurrence and every later one', () => {
    const text = feed(
      ...event('UID:tf', 'SUMMARY:Class', 'DTSTART:20260928T010000Z', 'DURATION:PT1H', 'RRULE:FREQ=DAILY;COUNT=5'),
      ...event('UID:tf', 'RECURRENCE-ID;RANGE=THISANDFUTURE:20260930T010000Z', 'SUMMARY:Class', 'DTSTART:20260930T020000Z', 'DURATION:PT1H'),
    )
    expect(titled(text, 'Class').map((e) => e.start)).toEqual(['2026-09-28T09:00', '2026-09-29T09:00', '2026-09-30T10:00', '2026-10-01T10:00', '2026-10-02T10:00'])
  })

  test('a time that doesn’t exist, in the hour skipped for daylight saving, uses the offset from before the gap', () => {
    // 02:30 on 2026-03-08 doesn't happen in New York; RFC 5545 reads it as 02:30 EST, 07:30 UTC.
    const text = feed(...event('UID:gap', 'SUMMARY:Gap', 'DTSTART;TZID=America/New_York:20260308T023000', 'DURATION:PT1H'))
    expect(read(text, '2026-03-01', '2026-03-15').events[0].start).toBe('2026-03-08T15:30')
  })

  test('a time that happens twice, when the clocks go back, is the first one', () => {
    // 01:30 on 2026-11-01 happens twice in New York; the first is EDT, 05:30 UTC.
    const text = feed(...event('UID:twice', 'SUMMARY:Twice', 'DTSTART;TZID=America/New_York:20261101T013000', 'DURATION:PT1H'))
    expect(read(text, '2026-10-25', '2026-11-08').events[0].start).toBe('2026-11-01T13:30')
  })
})

describe('what each time meant is kept', () => {
  const raw = (text: string, from = '2026-09-28', to = '2026-10-12') => readIcs(text, from, to, 'Asia/Taipei').events

  test("a time in a named zone is a moment with that zone's offset, and the zone", () => {
    const [e] = raw(feed(...event('UID:k1', 'SUMMARY:K', 'DTSTART;TZID=America/New_York:20261001T090000', 'DURATION:PT1H')))
    expect([e.start, e.end, e.zone]).toEqual(['2026-10-01T09:00:00-04:00', '2026-10-01T10:00:00-04:00', 'America/New_York'])
  })

  test('a zone only the feed defines keeps its name and the offset the feed gives', () => {
    const text = feed(
      'BEGIN:VTIMEZONE', 'TZID:Pacific Standard Time',
      'BEGIN:STANDARD', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11', 'END:STANDARD',
      'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3', 'END:DAYLIGHT',
      'END:VTIMEZONE',
      ...event('UID:k2', 'SUMMARY:K', 'DTSTART;TZID=Pacific Standard Time:20260930T090000', 'DURATION:PT1H'),
    )
    const [e] = raw(text)
    expect([e.start, e.zone]).toEqual(['2026-09-30T09:00:00-07:00', 'Pacific Standard Time'])
  })

  test('a floating time stays floating: that clock wherever the user is', () => {
    const [e] = raw(feed(...event('UID:k3', 'SUMMARY:K', 'DTSTART:20261001T090000', 'DTEND:20261001T100000')))
    expect(parseTime(e.start, 'event').kind).toBe('floating')
    expect(e.zone).toBeUndefined()
  })

  test('the range is days in the zone asked for', () => {
    // 2026-10-01 01:00 UTC is Oct 1 in Taipei but Sep 30 in New York.
    const text = feed(...event('UID:k4', 'SUMMARY:Edge', 'DTSTART:20261001T010000Z', 'DURATION:PT30M'))
    expect(readIcs(text, '2026-10-01', '2026-10-02', 'Asia/Taipei').events.length).toBe(1)
    expect(readIcs(text, '2026-10-01', '2026-10-02', 'America/New_York').events.length).toBe(0)
    expect(formatTime(parseTime(readIcs(text, '2026-09-30', '2026-10-01', 'America/New_York').events[0].start, 'event'))).toBe('2026-10-01T01:00:00+00:00')
  })
})

describe('found in review', () => {
  const pacific = [
    'BEGIN:VTIMEZONE', 'TZID:Pacific Standard Time',
    'BEGIN:STANDARD', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0700', 'TZOFFSETTO:-0800', 'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11', 'END:STANDARD',
    'BEGIN:DAYLIGHT', 'DTSTART:16010101T020000', 'TZOFFSETFROM:-0800', 'TZOFFSETTO:-0700', 'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3', 'END:DAYLIGHT',
    'END:VTIMEZONE',
  ]

  test('X-WR-TIMEZONE can name a zone the feed defines, and an unknown one is said', () => {
    const defined = feed('X-WR-TIMEZONE:Pacific Standard Time', ...pacific, ...event('UID:x1', 'SUMMARY:X', 'DTSTART:20261001T090000', 'DTEND:20261001T100000'))
    // 09:00 PDT (UTC-7) is 00:00 the next day in Taipei.
    expect(read(defined).events[0].start).toBe('2026-10-02T00:00')
    const unknown = feed('X-WR-TIMEZONE:Customized Time Zone', ...event('UID:x2', 'SUMMARY:X', 'DTSTART:20261001T090000', 'DTEND:20261001T100000'))
    expect(read(unknown).unknownZones).toEqual(['Customized Time Zone'])
  })

  test('a zone the feed defines keeps the feed’s offset, even when Temporal knows its name', () => {
    const text = feed(
      'BEGIN:VTIMEZONE', 'TZID:America/Mexico_City', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE',
      ...event('UID:x3', 'SUMMARY:X', 'DTSTART;TZID=America/Mexico_City:20261001T090000', 'DURATION:PT1H'),
    )
    expect(readIcs(text, '2026-09-28', '2026-10-12', 'Asia/Taipei').events[0].start).toBe('2026-10-01T09:00:00-05:00')
  })

  test('seconds are kept', () => {
    const tokyo = feed(...event('UID:x4', 'SUMMARY:X', 'DTSTART;TZID=Asia/Tokyo:20261001T090030', 'DTEND;TZID=Asia/Tokyo:20261001T090130'))
    expect(readIcs(tokyo, '2026-09-28', '2026-10-12', 'Asia/Taipei').events[0].start).toBe('2026-10-01T09:00:30+09:00')
    const floating = feed(...event('UID:x5', 'SUMMARY:X', 'DTSTART:20261001T090030', 'DTEND:20261001T090130'))
    expect(readIcs(floating, '2026-09-28', '2026-10-12', 'Asia/Taipei').events[0].start).toBe('2026-10-01T09:00:30')
  })

  test('unknown zones are found in the whole feed, whatever dates are asked about', () => {
    const text = feed(
      'X-WR-TIMEZONE:Europe/London', ...pacific,
      ...event('UID:x6', 'SUMMARY:X', 'DTSTART;TZID=Customized Time Zone:20300101T090000', 'DURATION:PT1H'),
      ...event('UID:x7', 'SUMMARY:Y', 'DTSTART;TZID=Pacific Standard Time:20261001T090000', 'DURATION:PT1H'),
    )
    expect(unknownZonesIn(text)).toEqual(['Customized Time Zone'])
  })
})
