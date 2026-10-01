# Time

How Jezo stores, reads and shows times, so that someone who travels keeps a plan that makes sense. Decided on 2026-10-01, after the research and three reviews in `.claude/research/2026-10-01/`.

## Question

Files used to hold times with no zone, like `2026-09-29T09:30`, read in whatever zone the device was in. That breaks for travelers:

- a call agreed at 09:00 New York shows at 09:00 wherever the user is;
- a prep block drifts hours away from the meeting it was placed before;
- a run started in Tokyo and finished in Los Angeles reads as minus five hours;
- an offline calendar cache no longer knows what its times meant.

## Every time says which clock it's on

A time field in a workspace file holds one string, quoted in YAML, and always says its zone or offset, so it means one moment wherever the user is.

| Field | Form | Example |
|---|---|---|
| A todo's `scheduled` | A time in a zone | `'2026-10-05T09:00[America/New_York]'` |
| Records: `created`, `started`, `completed`, a memory's `recorded` | A moment with its offset, stamped by Jezo | `'2026-10-05T16:00:00+09:00'` |

- **A time in a zone** is the clock and the zone, under the zone's rules. If the rules change before then, the moment moves and the clock stays, which is what the person agreed to. A `scheduled` may also be a moment ("in two hours").
- **A time without a zone is an error,** whoever wrote it. The check says what to write: "it has no zone. Write a time with its zone, like '2026-10-05T09:00[Asia/Taipei]': the zone the time note names, or the one the user named." Nothing is ever read in "whatever zone the device happens to be in".
- **Calendar events** come in whatever their source gives. That can also be a day (all-day events), or a floating clock with no zone (an ICS or EventKit event made that way). Those belong to the calendar; Jezo never writes one.

The forms are the ones JavaScript's Temporal reads and writes.

**Why one string, not a time plus a separate zone field:**
- an edit can't change one half and leave the other;
- sync can't merge one half from one device with the other half from another;
- copying a value copies its meaning.

**Repeated and missing clocks.** The second of a repeated hour (clocks going back) carries its offset: `'2026-11-01T01:30-05:00[America/New_York]'`. It's parsed with Temporal's `offset: 'prefer'`. An offset that no longer fits the zone's rules is reported, and the clock and zone are used. One that can't be an offset at all (`+25:00`) is an error when the file is read, not later.

**No migration.** Jezo isn't released, so there are no older files to read, and a file without zones is simply wrong. Tim, 2026-10-01: no migration mechanisms for now.

## One module

`src/shared/time.ts`, on Temporal (native in Electron 44), owns Jezo's time values: it classifies, parses, validates, serializes, resolves, compares and formats them.

- **Each field says what it takes:** a todo's time, a record, or a calendar event. The module refuses a form a field doesn't take.
- **Callers always pass the zone.** Nothing reads the process's default zone.
- **Invalid dates are rejected.** February 30 and 25:00 fail with `overflow: 'reject'`; Temporal's default would quietly turn them into February 28 at 23:00.
- **Nothing else parses Jezo's time strings:**
  - `new Date(string)` and date-fns `parseISO` read the bracketed form wrong. Measured: `parseISO` put an offset-and-zone value four hours early.
  - The old prefix slicing compares strings, not moments.
- **What stays elsewhere:**
  - Providers' own formats are parsed in their adapters (ical.js, EventKit, Google).
  - The main process watches the OS zone.
  - The automation scheduler owns its own policy ([automations.md](automations.md)).
- **One clock for the whole app.** `now()` reads `Date.now`, so a test that moves the clock moves everything.

## Which zone a new time gets

A new time is fixed to the zone it was placed in.

- **Chat and automations:** the device's zone.
- **A GUI action:** the zone the calendar is showing. Placing a todo on a calendar showing Tokyo fixes it to Tokyo, because that's planning for being there.

| Action | Written |
|---|---|
| A new todo dragged onto the calendar, or given a time in the picker | Fixed to the zone the calendar shows: the device's, unless it's showing another. |
| 讓 agent 幫我找時間 on a calendar showing another zone | The run plans in that zone: its time note, the tools and the calendar answers all read and show times there, and the note says the device is elsewhere. The conversation keeps that zone. |
| `todos_propose` | `date` and `time` are read in the device's zone and fixed to it. A `zone` is passed only when the user names a place ("9am New York"); then it's fixed to that zone. A draft kept when a plan is revised is moved, not placed anew, so it keeps its zone. |
| Moving an existing todo, by drag, picker or `todos_update` | The new clock is read in the action's zone, and the todo keeps its own zone. In Tokyo, "move it to 23:00" on a New York todo stores 10:00 New York. |
| Fixing a time to another zone | The details' 時區 row. It keeps the clock (09:00 Phoenix becomes 09:00 Tokyo) and shows the result before saving. With the tool, `zone` on an update does the same. |
| Writing the file directly | What's written. A time without a zone is refused by the check, which says what to write. |

**The agent doesn't choose or convert a zone in the common case.** The time note names the device's zone, and says times it gives todos are read there and stay fixed there. The tools add the zone; the agent adds one only when the user named a place.

**Whether a time is the user's own or a proposal** is `userAskedForThisTime`, a required argument of `todos_update`. The model has to decide it on every call, instead of leaving it out and getting a proposal.
- **The shortcut is gone.** It treated a time as the user's own when its clock appeared in their message: "Oct 6 at 09:00 New York" could settle a wrongly dated or zoned 09:00 as theirs.

**Tool results** say what was written and how it reads in the device's zone. When a conversion crosses midnight they give both dates: "Fri Oct 9 01:00 here (Thu Oct 8 09:00 Phoenix)".

**Clocks that don't exist or happen twice:**
- **New input in a gap is rejected by the tools.** The result offers the time shifted by the gap's length, as Temporal and Croner both do: 02:30 on New York's spring-forward day becomes 03:30, and 02:15 in Lord Howe's 30-minute gap becomes 02:45.
- **A repeated clock is stored as the first one.** The result says so.
- **A move that lands on the second of a repeated clock in the todo's own zone keeps that offset.** At 06:30 UTC on Nov 1, a New York todo becomes `01:30-05:00[America/New_York]`, not the first 01:30, an hour early.
- **A move into a gap from the GUI** is shifted by the gap, keeps the todo's zone, and says so: "那天沒有 02:30（時鐘往前撥），改成 03:30"。
- **A floating calendar event that lands in a gap** is shifted the same way.

**A time that didn't move is written as it was.** Accepting a proposed time changes only that it's proposed, so `09:00:45` or a second 01:30 stays exactly as the file had it. Undo writes back the strings the file had, not the time as it was shown then: after a flight, undoing "先不排時間" on a New York 10:00 puts back 10:00 New York, not 23:00 Tokyo. What the app shows before the file comes back is read from the strings being written, so a second change made in that moment starts from the first.

## When the user travels

**The display is always right.** Every time is one moment. In Tokyo, a 09:00 New York call shows at 22:00, and a 07:00 Phoenix walk at 23:00. Nothing on disk changes when the device moves.

What travel can make wrong is the plan, not the display: a writing block placed at 09:00 at home is at 01:00 abroad. Whether to move it, and where, is the user's call. So:
- after a zone change, one quiet line says so: "現在用東京時間了";
- the details show each todo's own zone and clock ("Phoenix時間 07:00") next to its time here;
- the 時區 row fixes a todo to the new zone in one step, keeping its clock;
- the agent, when asked, proposes moves with the usual plan card.

## Days, today, ranges

- A time belongs to the date its moment falls on in the zone being asked about. An all-day event belongs to its date.
- "Today" in the chat and the digest is the device's date. In the calendar it's the date in the zone the calendar shows, and the header names that zone.
- Every range query passes its zone: Oct 8 in Tokyo is `[Oct 7 15:00Z, Oct 8 15:00Z)`.
- Ordering and overlaps compare moments, never strings.

## Where the user is

- **One device:** its zone is the truth.
  - The main process reads it independently of its own cached zone (`/etc/localtime` on macOS). It checks on launch, resume, unlock, focus and each tick. Node in the main process doesn't notice an OS zone change on its own.
  - Where the zone isn't a link (Windows, a Linux that copies the file), Jezo unsets `TZ` for a moment and asks the runtime, which then asks the OS; reading the runtime with `TZ` set would only return the zone Jezo set itself.
  - On a change, it updates the zone, tells the windows, and sets `process.env.TZ` as a bridge for code still on the default zone. The windows redraw everything from the new zone.
- **Several devices:** open, decided with sync ([sync.md](sync.md)). The code takes the zone as an input so the answer has a place to plug in.

## What the user sees

- **The calendar header names its zone,** with a switch to show another. Showing another zone moves every block to that zone's hours and changes nothing on disk. Today, the Today button and the week's "nothing planned" prompt follow that zone; so does the time picker in the details opened from the calendar, which says which zone it reads ("以東京時間填寫").
- **A zone is found by its city or the name of its time, in the app's language and in English** (東京, 日本標準時間, Tokyo), or its id; an exact id the list spells differently (Asia/Kolkata) is accepted too. City names are Unicode CLDR's exemplar cities, the data ICU itself uses: `bun run zone-names` (scripts/zone-names.ts) writes them from the `cldr-dates-modern` package for each language in `src/renderer/src/locales`, so a new language gets them by rerunning it. Names of times come from Intl at runtime. Labels use the same city names ("東京時間 09:00"). Rejected: a table of city names of our own, which would grow with every language.
- **A time that's a moment rather than a time in a zone** (`2026-10-05T09:00Z`) is labelled as a fixed moment, in no zone.
- **A todo's details** show:
  - its time here;
  - its own zone and clock, when that's another zone;
  - a 時區 row to fix it to another zone.
- **A calendar block keeps its real endpoints.** The grid (ReUI's event calendar) takes moments and the zone it shows, and does its own conversions with `@date-fns/tz`. Each block is its real start and end, so it keeps its real length across a clock change, in the device's zone or another. Days, today and the day headers are the shown zone's.

## What the agent sees

- **The time note before every request:**
  - says now, with the zone and the UTC offset;
  - says times the agent gives todos are read in that zone and stay fixed to it;
  - lists the next fourteen days, regenerated whenever the date or the zone changes.
- **A time-jump note before a model call.** pi's `context` hook adds one when time jumped since the last call of the same run: a sleep, a zone change, or the date changing (twenty minutes asleep across midnight). Each run starts with its own time note, so jump notes from an earlier run or another branch are never carried into it.
- **Tool results and the digest** show times in the device's zone, plus the time's own zone when it differs.
- **Elapsed time, ordering and overlaps** come from code.

## Calendar sources

The calendar keeps each source's own meaning. See [calendar.md](calendar.md), "Times from each source".

## Rejected

- **Times without a zone, read wherever the user is ("local", or "follow me").**
  - Their meaning depends on where the device happens to be, so a time the agent wrote without a zone changed meaning on a flight, and nobody chose that.
  - As the default for new times, it put an appointment 13 hours early after a move, and drifted a prep block five hours from its meeting without overlapping anything.
  - Offered as a setting (跟著我走), it was a phrase nobody could explain (Tim, 2026-10-01).

  Moving a plan after travel is a proposal the user accepts instead.
- **A log of where the user was, and trips.** Built to repair the default above, and not needed once every time keeps its zone.
- **A separate zone field.** It can be lost in an edit or split in a merge.
- **UTC for everything.** It loses "09:00 by New York's clock" when rules change, and it makes hand-written times unreadable.
- **Inferring intent from a title.** "Call Mom" can be flexible or agreed.
- **A different zone for each day of the week view.** The header's one zone, with a switch, is enough.
- **Migrating older files.** There are none (above).
