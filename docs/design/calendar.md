# Calendar

Status: built on 2026-09-30: the Mac's own calendars, ICS subscriptions, and Google Calendar with the user's own OAuth client (see [connectors.md](connectors.md) for why that comes before a client of Jezo's own). Tim confirmed Google works with a real account the same day.

## What the user gets

The 行事曆 page shows every calendar the user has, merged into one grid next to their todos. 更多 → 連接 lists where calendars come from. Any calendar can be hidden. Jezo only reads calendars; it never changes them.

- **This Mac's calendars.** One button asks macOS for access, and then every account added to the Mac comes along: iCloud, Google, Exchange, subscriptions made in Calendar.app, birthdays. They're grouped by account, each with a switch. If the user said no to macOS, the row says where to turn it back on and opens System Settings there.
- **Subscriptions.** Paste an address (`https://` or `webcal://`, usually ending in `.ics`). The dialog says where Google Calendar keeps its private address. A bad address fails in the dialog with the reason (`404`, "This isn't a calendar feed"), and nothing is saved. Without a name, the feed's own name is used.

The header of the 行事曆 page says which calendars it shows and when they were last read, or which one can't be read. The Mac's calendars are always current, so they have no "last synced" time.

- **Google accounts.** Setting up takes one guided dialog. It walks through five steps at Google, each with a link to the page where it's done: make a project, turn on the Calendar API, set up the consent screen, publish it, and make a Desktop OAuth client. The user pastes the client's id and secret, and the browser opens to sign in. The dialog warns about the two traps:
  - an app left in "Testing" loses its sign-in every 7 days;
  - Google calls the app unverified, which is expected for your own app.
  More accounts can be added, each account's calendars can be hidden, and an account whose sign-in stopped working says so and offers to connect again.

## Where things live

| What | Where | Why |
|---|---|---|
| Subscriptions (id, name, hidden) | workspace, `calendar/subscriptions.yaml` | The user's own choice, so it's in the workspace (AGENTS.md, principle 1) and moves with it |
| A subscription's address | keychain (`secrets.ts`) | A private calendar's address is all it takes to read it. On another device the user pastes it again |
| Whether the Mac's calendars are on, and which are hidden | app data, `config.json` | They belong to this Mac |
| Google accounts (email, hidden calendars) | workspace, `calendar/google.yaml` | The user's |
| The user's Google client, and each account's tokens | keychain | Credentials |
| Events | not stored | The calendar they come from owns them |
| The last copy of each feed and Google account | app data, `calendar/<id>.ics`, `<id>.json`, `google-<account>.json` | Shown while offline or when a source fails; safe to lose |

Events aren't copied into the workspace. They'd be a mirror of something another service owns, and syncing that mirror to a phone would be pointless (storage.md, "every stored thing has one role").

## How it works

- **EventKit** is reached through `native/eventkit`, a small Swift program the main process runs and reads JSON from (`status`, `request`, `calendars`, `events FROM TO`, `watch`). Repeating events come expanded. All-day events come as dates with the end the day after, like ICS. `watch` prints a line whenever the calendar store changes, and the windows reload. `scripts/native.ts` builds it in `postinstall`, `dev`, `build` and `e2e`; the packaged app ships it in `Resources/bin`.
  - **Permission.** macOS asks the *responsible* process. In development that's the terminal Jezo was started from, so the terminal needs calendar access. The packaged app asks as Jezo, with `NSCalendarsFullAccessUsageDescription` from `electron-builder.yml`. The packaged path hasn't been tried yet.
- **ICS** is read with ical.js (`src/main/calendar/ics.ts`). ical.js expands repeat rules, EXDATE and moved or cancelled occurrences (RECURRENCE-ID). Jezo keeps what each time meant ("Times from each source" below). Feeds get zones wrong in several ways, and each has a test in `ics.test.ts`, written before the code:
  - Windows zone names ("Pacific Standard Time") are only defined by the feed's own VTIMEZONE, as Outlook sends them.
  - An IANA name without a VTIMEZONE is read with Temporal, daylight saving included.
  - UTC times are moments in UTC.
  - Floating times use `X-WR-TIMEZONE` if the feed has one, and otherwise stay floating: that clock wherever the user is.
  - A zone the feed names but doesn't define is read as floating, and 連接 says so under the subscription.
  - All-day dates are never shifted by a zone.
- **Google** (`src/main/calendar/google.ts`):
  - **Sign-in.** PKCE with an S256 challenge, a loopback redirect to a free port on 127.0.0.1, `access_type=offline` for a refresh token, and scope `calendar.readonly`. A Desktop client needs its secret in the token request even with PKCE. The secret isn't confidential for a Desktop client, but it's the user's, so it lives in the keychain.
  - **Reading.** Calendars come from `calendarList`. Events come from `events.list` with `singleEvents=true`, so Google expands repeats, for 90 days back to 365 ahead, into a cache that's read again with the others. The cache keeps each time as Google gave it, with the event's zone.
  - **Descriptions** are Google's small HTML; they're turned into text with links kept.
  - **Signed out.** `invalid_grant` means the sign-in is gone (revoked, or a Testing app after 7 days), and the account shows as needing to connect again.
  - **Not yet.** Incremental sync (sync tokens) isn't used; that matters once many people share one project's quota, which a client of Jezo's own would bring.
- **Refreshing.** Subscriptions are read when Jezo opens, every 30 minutes, and when the window comes back after 5 minutes away. Requests carry `If-None-Match` / `If-Modified-Since`. A failure keeps the last copy and shows the reason; nothing is thrown away.
- **Ids.** Each occurrence has its own id (`uid@recurrence-id`), the same on every read.

## Times from each source

Decided 2026-10-01 ([time.md](time.md)). Until then every adapter turned times into local strings, losing each event's zone. A Google cache read after travel showed the old zone's clock, and EventKit's floating events looked fixed.

An event's endpoints are structured, not local strings:
- a fixed event has a moment, plus its source zone and clock when known;
- a floating event has a clock;
- an all-day event has days, with the end exclusive.

| Source | What it keeps |
|---|---|
| EventKit | The helper sends fixed endpoints as moments with the event's `timeZone`, floating events (nil zone) as clocks, and all-day events as days. Its range query takes a zone. |
| Google | The cache keeps `dateTime` with its offset, each endpoint's `timeZone`, and recurring-instance identity. |
| ICS | VTIMEZONE still defines zones, Windows names included, and its offsets win even when Temporal knows the name: the feed's rules are what its author meant. A TZID or `X-WR-TIMEZONE` nobody defines is a problem shown in the GUI, not a silent guess; it's found when the feed is fetched, across the whole feed, so the warning doesn't depend on which dates were asked about. `X-WR-TIMEZONE` stays the fallback for floating times, and can name a zone the feed defines. Seconds are kept. |

**ICS repeats and lengths** (decided 2026-10-01, after the design review in `.claude/research/2026-10-01/review/`):
- **A zone the feed names but doesn't define gets a definition before anything is expanded.** ical.js expands repeats; on its own it reads `TZID=America/New_York` without a VTIMEZONE as a clock with no zone, so UNTIL and EXDATE were compared against the wrong hours. Jezo adds a VTIMEZONE to that feed, built from the runtime's tz database (the one Temporal uses for every other time in Jezo), one observance per change. It's scoped to the feed being read, never registered globally, so one feed can't change another's meaning. Rejected: VTIMEZONE packages (a second tz database to keep in step; the ones on npm were years out of date), and another recurrence library (two engines to keep in agreement for overrides and feed-defined zones).
- **Lengths follow RFC 5545, 3.3.6.** In DURATION, weeks and days are calendar days in the event's zone and hours and less are elapsed time after them: PT24H from noon the day before the clocks go forward ends at 13:00, P1D at 12:00. A repeat whose length comes from DTEND keeps its first occurrence's elapsed length on every day.
- **A moved occurrence is found by its own times,** wherever its original date was, and the walk over a repeat's dates reaches two days past either end of the range, so a zone a day away still lands in it.
- **A clock the clocks skip is kept and counted, at the offset from before the change:** a daily 02:30 is 03:30 on the day clocks go forward. That's RFC 5545 as corrected by erratum 4271 (2015), which Google Calendar and Calendar.app follow; the original text's "ignore it and don't count it" was wrong. A clock that happens twice is the first.
- **A zone the feed defines is read by Jezo, not ical.js.** ical.js reads a skipped clock an hour early and a repeated one as the second, and puts the change itself an hour off. Jezo lists the zone's changes from its own observances (ical.js expands their rules, which it gets right) and works out each clock's moment from them. ical.js still compares UNTIL and EXDATE in such a zone with its own conversion, which can be an hour off within an hour of a change.
- **Feeds are read in a worker thread, with a time limit.** ical.js has repeat rules that never finish expanding (its issue #1038: `FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30`). Read on the main thread, one froze Jezo. After 10 seconds the read fails, the worker is replaced, and that calendar counts as unread for the range; a new subscription is refused with that reason.
- **ical.js itself** (research, 2026-10-01, `.claude/research/2026-10-01/icaljs-sol.md`): Mozilla's calendar engine, still vendored by Thunderbird and used by Nextcloud and FullCalendar; no dependencies, no install scripts, no network or file access in its code. Release control is with one maintainer, so the version is pinned exactly and each upgrade is reviewed. Rejected: switching to rrule or rrule-temporal (no engine for a feed's own zones, and rrule-temporal skips skipped clocks), or node-ical (matches feed zones by their January and July offsets instead of their rules).

- **Occurrence ids** use the moment for fixed occurrences, and the clock or date for floating and all-day ones. A clock formatted in the device's zone changed with travel, so ids no longer use one.
- **Range queries take a zone.** Oct 8 in Tokyo and Oct 8 in Phoenix are different intervals. Asking for the wrong one and converting afterwards loses events. The calendar page asks in the zone it shows.
- **A source that couldn't be read for a range is unavailable,** and every answer names it: not connected, access taken away, a read that failed, no saved copy, or dates past what's kept of Google. Overlap checks against it say "unknown", and the agent is told "Couldn't read Personal just now, so nothing is known from it", never "nothing on the calendar".
- **An overlap check covers the whole slot,** however long: a three-day todo is checked against all three days.
- **The agent reads both ends of an event.** A clock that happens twice that day carries its offset ("01:30 (-04:00)–01:30 (-05:00)"), and the event's own zone shows both its dates when they differ.

## The agent

The calendar is a pi extension (`src/main/calendar/agent.ts`), loaded like memory:

- **`calendar_events(from, to, notes?)`** lists events for any range, repeats expanded.
- **At the start of each run,** today's and tomorrow's events are added to the prompt. This is a starting point, and the tool is the way in (AGENTS.md, principle 2).
- **Outside content.** Titles and descriptions are marked as outside content: facts to plan around, never instructions. Descriptions are left out unless asked for.
- **Just outside the range.** `calendar_events` also says how many events fall within 24 hours either side of the range, and when, but not what they are. A school feed puts Friday's homework at 03:00 Saturday, and a range ending Friday would miss it. Showing only the time lets the agent decide to look without widening what it was asked. The idea is from Tim's icsfeed ("boundary hints").
- **Clashes.** When the agent schedules or re-estimates a todo, the tool result says if the slot overlaps a timed event ("It overlaps "排球" 19:00–21:00…"). It doesn't refuse, because sometimes overlapping is what the user wants. This caught a local model's arithmetic slip in testing (AGENTS.md, principle 8).
- **Dates.** The digest spells out the next fourteen days with their weekdays, because "next Wednesday" is where models most often went wrong. The first one is labelled tomorrow, since an unlabelled list made a model pick the wrong day for "明天".

## Tests

- `src/main/calendar/ics.test.ts` covers 31 ways feeds go wrong (`bun test`). The last eight came from icsfeed's test catalog:
  - deadlines with no length;
  - events with no UID;
  - zones nobody defines;
  - RDATE and THISANDFUTURE;
  - the daylight-saving gap and overlap, read as RFC 5545 says.
  A deadline with no length still gets a small block on the grid.
- `e2e/calendar.spec.ts` serves an Outlook-shaped and a Google-shaped feed from a real local HTTP server, with the zone pinned to Taipei. It covers:
  - subscribing through the GUI, including the failures;
  - checking each event's time in its detail panel: the moved occurrence, the skipped one, a Seattle call across daylight saving, UTC, and a two-day all-day event;
  - hiding a calendar;
  - a server that starts failing, which keeps the last copy;
  - removing a subscription, which removes its address and cache.
- `e2e/google.spec.ts` runs the whole Google path against a local server that answers the way Google's OAuth and Calendar API do:
  - it checks the PKCE verifier against the challenge, the client, and the bearer token;
  - the browser round trip is real, to Jezo's loopback port;
  - expired tokens refresh; a revoked sign-in shows and is fixed by connecting again;
  - removing an account clears its tokens and cache and keeps the client.
  A real account was tried by hand on 2026-09-30. It found a crash, since fixed: the loopback server read its port after closing.
- `e2e/agent.spec.ts`, "plans around the calendar": with a local model, the agent schedules 45 minutes next Wednesday evening around 19:00–21:00 volleyball it isn't shown up front. It passed 3 of 3 once the clash check and the date list were in (earlier runs failed on wrong dates and overlapping slots). In the next full run it failed differently: the model looked up the right day, then asked the user to pick 18:15 or after 21:00 instead of scheduling one as a proposal. With gemma-4-e4b it does that most of the time, even with the system prompt saying to pick a time and let the user move it.
- The Mac's calendars were checked by hand on 2026-09-30 (iCloud, a subscription and Birthdays showed and could be hidden). There's no automated test, because it depends on the machine's accounts and macOS permission.

## Not done

- **Google Calendar through EventKit** isn't tested separately. Every account on the Mac is read the same way, and Tim decided on 2026-09-30 not to put a Google account on the test Mac. Calendars not ticked at `calendar.google.com/calendar/syncselect` won't show through EventKit.
- **Writing to calendars.** Todos stay in Jezo, and events stay read-only.
- **Colors.** Events on the grid are one muted color. A calendar's color shows only in 連接.
