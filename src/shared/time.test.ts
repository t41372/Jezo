// The time module is pure and has many edges, so it's tested on its own
// (AGENTS.md, "Testing"). Ways it could fail, written before these tests:
//
// Reading
//  1. A real date that doesn't exist (Feb 30, 25:00, 24:60) is accepted, or wrapped into another date.
//  2. A zone name nobody defines is accepted, and later resolves as UTC or the device's zone.
//  3. A clock with no zone is accepted for a todo or a record, and silently read in whatever zone the device is in.
//  4. A moment's recorded offset is lost, so it can't be shown as the clock it was recorded at.
//  5. An old zone name (Asia/Calcutta) and its new one (Asia/Kolkata) count as different zones.
//  6. Seconds are dropped from a moment, or added to a clock that had none, changing the file.
// 20. An offset that can't be one (+25:00, -05:60) is accepted, and only throws later, when something resolves it.
// Resolving
//  7. A time fixed to New York moves when the viewer's zone changes.
//  8. A floating calendar event doesn't follow the viewer's zone.
//  9. The second 01:30 of a fall-back day (with its offset) resolves to the first.
// 10. An offset that no longer fits the zone's rules makes the value unreadable, instead of the clock and zone winning.
// 11. A floating event in a spring-forward gap is dropped or throws, instead of shifting by the gap (not to the hour).
// 12. Lord Howe's 30-minute gap is treated as an hour.
// 13. The date a time belongs to is taken from its written date rather than where its moment falls.
// 14. A day-only event's date moves with the viewer's zone.
// 15. Elapsed time between two moments in different zones is computed from their clocks.
// Placing and moving
// 16. A new clock in a gap is silently stored; or a repeated clock isn't flagged.
// 17. Moving a New York todo from Tokyo stores the Tokyo clock with New York's zone.
// 18. Moving a time drops its zone, or gives it the zone it was moved in.
// 19. Stamping writes the process's zone instead of the one passed in, or drops the offset.
// 21. Moving a time to the second of a repeated clock in its own zone stores the first, an hour early.
// 22. Moving a time to a clock in a gap gives it the zone it was moved in.

import { describe, expect, test } from 'bun:test'
import { dateOf, epochOf, formatTime, moveTo, parseTime, place, readTime, resolve, stamp, TimeError } from './time'

const at = (text: string, zone: string) => resolve(parseTime(text), zone)!.at.toString({ timeZoneName: 'never' })
const event = (text: string, zone: string) => resolve(parseTime(text, 'event'), zone)!.at.toString({ timeZoneName: 'never' })

describe('reading', () => {
  test('dates and clocks that do not exist are refused (1)', () => {
    for (const text of ['2026-02-30', '2026-02-30T09:00', '2026-10-05T25:00', '2026-10-05T09:60[Asia/Tokyo]', '2026-02-29T09:00:00+08:00']) {
      expect(() => parseTime(text)).toThrow(TimeError)
    }
  })
  test('an unknown zone is refused (2)', () => {
    expect(() => parseTime('2026-10-05T09:00[Mars/Olympus]')).toThrow(TimeError)
  })
  test('a clock with no zone is refused for a todo and a record, saying what to write; an event may float (3)', () => {
    expect(() => parseTime('2026-10-05T11:00')).toThrow(/no zone.*\[Asia\/Taipei\]/)
    expect(() => parseTime('2026-10-05T11:00', 'record')).toThrow(/offset/)
    expect(parseTime('2026-10-05T11:00', 'event').kind).toBe('floating')
    expect(() => parseTime('2026-10-08')).toThrow(TimeError)
    expect(parseTime('2026-10-08', 'event').kind).toBe('day')
  })
  test('a moment keeps the offset it was recorded with (4)', () => {
    const value = parseTime('2026-10-05T16:00:00+09:00', 'record')
    expect(value.kind === 'moment' && value.at.hour).toBe(16)
    expect(formatTime(value)).toBe('2026-10-05T16:00:00+09:00')
    expect(formatTime(parseTime('2026-10-05T07:00:00Z'))).toBe('2026-10-05T07:00:00Z')
  })
  test('an old zone name and its new one are the same zone (5)', () => {
    expect(at('2026-10-05T09:00[Asia/Calcutta]', 'UTC')).toBe(at('2026-10-05T09:00[Asia/Kolkata]', 'UTC'))
  })
  test('writing back gives the same text (6)', () => {
    for (const text of ['2026-10-08', '2026-10-08T09:00', '2026-10-08T09:00:30', '2026-10-05T09:00[America/New_York]', '2026-11-01T01:30-05:00[America/New_York]', '2026-10-05T16:00:00+09:00']) {
      expect(formatTime(parseTime(text, 'event'))).toBe(text)
    }
  })
  test('an offset that can not be one is refused (20)', () => {
    for (const text of ['2026-11-01T01:30+25:00[America/New_York]', '2026-11-01T01:30-05:60[America/New_York]']) {
      expect(() => parseTime(text)).toThrow(TimeError)
    }
  })
  test('readTime gives null for anything it cannot read', () => {
    expect(readTime(undefined)).toBeNull()
    expect(readTime('tomorrow')).toBeNull()
    expect(readTime(42)).toBeNull()
    expect(readTime('2026-10-05T09:00')).toBeNull()
  })
})

describe('resolving', () => {
  test('a time in a zone stays the same moment wherever it is seen (7)', () => {
    expect(at('2026-10-05T09:00[America/New_York]', 'Europe/London')).toBe('2026-10-05T14:00:00+01:00')
    expect(at('2026-10-05T09:00[America/New_York]', 'Asia/Tokyo')).toBe('2026-10-05T22:00:00+09:00')
  })
  test('a floating event is that clock wherever it is seen (8)', () => {
    expect(event('2026-10-08T07:00', 'Asia/Tokyo')).toBe('2026-10-08T07:00:00+09:00')
    expect(event('2026-10-08T07:00', 'America/Phoenix')).toBe('2026-10-08T07:00:00-07:00')
  })
  test('the second of a repeated clock keeps its offset (9)', () => {
    expect(resolve(parseTime('2026-11-01T01:30-05:00[America/New_York]'), 'UTC')!.at.toString({ timeZoneName: 'never' })).toBe('2026-11-01T06:30:00+00:00')
    expect(resolve(parseTime('2026-11-01T01:30[America/New_York]'), 'UTC')!.at.toString({ timeZoneName: 'never' })).toBe('2026-11-01T05:30:00+00:00')
  })
  test('an offset that no longer fits gives way to the clock and zone (10)', () => {
    // Kazakhstan moved Almaty from +06:00 to +05:00 on 2024-03-01.
    expect(at('2025-03-01T09:00+06:00[Asia/Almaty]', 'UTC')).toBe('2025-03-01T04:00:00+00:00')
  })
  test('a floating event in a gap shifts by the gap (11, 12)', () => {
    const ny = resolve(parseTime('2026-03-08T02:30', 'event'), 'America/New_York')!
    expect(ny.at.toString({ timeZoneName: 'never' })).toBe('2026-03-08T03:30:00-04:00')
    expect(ny.shifted).toBe(true)
    expect(event('2026-10-04T02:15', 'Australia/Lord_Howe')).toBe('2026-10-04T02:45:00+11:00')
  })
  test('a time belongs to the date its moment falls on (13)', () => {
    expect(dateOf(parseTime('2026-10-05T23:00[America/New_York]'), 'Asia/Tokyo').toString()).toBe('2026-10-06')
  })
  test('a day-only event keeps its date (14)', () => {
    expect(dateOf(parseTime('2026-10-08', 'event'), 'Asia/Tokyo').toString()).toBe('2026-10-08')
    expect(dateOf(parseTime('2026-10-08', 'event'), 'America/Phoenix').toString()).toBe('2026-10-08')
  })
  test('elapsed time comes from moments, across zones (15)', () => {
    const start = epochOf(parseTime('2026-10-05T16:00:00+09:00', 'record'), 'UTC')!
    const end = epochOf(parseTime('2026-10-05T11:00:00-07:00', 'record'), 'UTC')!
    expect((end - start) / 3_600_000).toBe(11)
  })
})

describe('placing and moving', () => {
  test('a new clock in a gap is flagged, with the shifted one offered (16)', () => {
    const placed = place('2026-03-08', '02:30', 'America/New_York')
    expect(placed.gap).toBe(true)
    expect(formatTime(placed.value)).toBe('2026-03-08T03:30[America/New_York]')
    expect(place('2026-11-01', '01:30', 'America/New_York').twice).toBe(true)
    expect(place('2026-10-05', '09:00', 'America/New_York')).toEqual({ value: parseTime('2026-10-05T09:00[America/New_York]') })
  })
  test('moving a New York todo from Tokyo keeps it in New York (17)', () => {
    const moved = moveTo(parseTime('2026-10-05T09:00[America/New_York]'), '2026-10-05', '23:00', 'Asia/Tokyo')
    expect(formatTime(moved.value)).toBe('2026-10-05T10:00[America/New_York]')
  })
  test('a moved time keeps its zone (18)', () => {
    expect(formatTime(moveTo(parseTime('2026-10-05T09:00[Asia/Taipei]'), '2026-10-06', '07:30', 'Asia/Tokyo').value)).toBe('2026-10-06T06:30[Asia/Taipei]')
  })
  test('moved to the second of a repeated clock, it keeps that offset (21)', () => {
    // 06:30 UTC on Nov 1 is New York's second 01:30.
    const moved = moveTo(parseTime('2026-10-05T09:00[America/New_York]'), '2026-11-01', '06:30', 'UTC')
    expect(formatTime(moved.value)).toBe('2026-11-01T01:30-05:00[America/New_York]')
    expect(at(formatTime(moved.value), 'UTC')).toBe('2026-11-01T06:30:00+00:00')
    // The first one needs no offset.
    expect(formatTime(moveTo(parseTime('2026-10-05T09:00[America/New_York]'), '2026-11-01', '05:30', 'UTC').value)).toBe('2026-11-01T01:30[America/New_York]')
  })
  test('moved to a clock in a gap, it is offered shifted, in its own zone (22)', () => {
    const moved = moveTo(parseTime('2026-10-05T09:00[Europe/London]'), '2026-03-08', '02:30', 'America/New_York')
    expect(moved.gap).toBe(true)
    expect(formatTime(moved.value)).toBe('2026-03-08T07:30[Europe/London]')
  })
  test('a stamp is the moment in the zone passed in, with its offset (19)', () => {
    const instant = Temporal.Instant.from('2026-10-05T07:00:00Z')
    expect(stamp('Asia/Tokyo', instant)).toBe('2026-10-05T16:00:00+09:00')
    expect(stamp('America/Los_Angeles', instant)).toBe('2026-10-05T00:00:00-07:00')
  })
})
