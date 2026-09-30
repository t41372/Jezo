# Calendar

Status: built on 2026-09-30 for the Mac's own calendars and ICS subscriptions. Google Calendar directly is next (bring-your-own OAuth client first, see [connectors.md](connectors.md)).

## What the user gets

The 行事曆 page shows every calendar the user has, merged into one grid next to their todos. 更多 → 連接 lists where calendars come from. Any calendar can be hidden. Jezo only reads calendars; it never changes them.

- **This Mac's calendars.** One button asks macOS for access, and then every account added to the Mac comes along: iCloud, Google, Exchange, subscriptions made in Calendar.app, birthdays. They're grouped by account, each with a switch. If the user said no to macOS, the row says where to turn it back on and opens System Settings there.
- **Subscriptions.** Paste an address (`https://` or `webcal://`, usually ending in `.ics`). The dialog says where Google Calendar keeps its private address. A bad address fails in the dialog with the reason (`404`, "This isn't a calendar feed"), and nothing is saved. Without a name, the feed's own name is used.

The header of the 行事曆 page says which calendars it shows and when they were last read, or which one can't be read. The Mac's calendars are always current, so they have no "last synced" time.

## Where things live

| What | Where | Why |
|---|---|---|
| Subscriptions (id, name, hidden) | workspace, `calendar/subscriptions.yaml` | The user's own choice, so it's in the workspace (AGENTS.md, principle 1) and moves with it |
| A subscription's address | keychain (`secrets.ts`) | A private calendar's address is all it takes to read it. On another device the user pastes it again |
| Whether the Mac's calendars are on, and which are hidden | app data, `config.json` | They belong to this Mac |
| Events | not stored | The calendar they come from owns them |
| The last copy of each feed | app data, `calendar/<id>.ics` and `<id>.json` | Shown while offline or when a feed fails; safe to lose |

Events aren't copied into the workspace. They'd be a mirror of something another service owns, and syncing that mirror to a phone would be pointless (storage.md, "every stored thing has one role").

## How it works

- **EventKit** is reached through `native/eventkit`, a small Swift program the main process runs and reads JSON from (`status`, `request`, `calendars`, `events FROM TO`, `watch`). Repeating events come expanded. All-day events come as dates with the end the day after, like ICS. `watch` prints a line whenever the calendar store changes, and the windows reload. `scripts/native.ts` builds it in `postinstall`, `dev`, `build` and `e2e`; the packaged app ships it in `Resources/bin`.
  - **Permission.** macOS asks the *responsible* process. In development that's the terminal Jezo was started from, so the terminal needs calendar access. The packaged app asks as Jezo, with `NSCalendarsFullAccessUsageDescription` from `electron-builder.yml`. The packaged path hasn't been tried yet.
- **ICS** is read with ical.js (`src/main/calendar/ics.ts`). ical.js expands repeat rules, EXDATE and moved or cancelled occurrences (RECURRENCE-ID). Jezo turns the times into local time. Feeds get zones wrong in several ways, and each has a test in `ics.test.ts`, written before the code:
  - Windows zone names ("Pacific Standard Time") are only defined by the feed's own VTIMEZONE, as Outlook sends them.
  - An IANA name without a VTIMEZONE is converted with `Intl`, daylight saving included.
  - UTC times are converted to local time.
  - Floating times use `X-WR-TIMEZONE` if the feed has one, and local time otherwise.
  - All-day dates are never shifted by a zone.
- **Refreshing.** Subscriptions are read when Jezo opens, every 30 minutes, and when the window comes back after 5 minutes away. Requests carry `If-None-Match` / `If-Modified-Since`. A failure keeps the last copy and shows the reason; nothing is thrown away.
- **Ids.** Each occurrence has its own id (`uid@recurrence-id`), the same on every read.

## The agent

The calendar is a pi extension (`src/main/calendar/agent.ts`), loaded like memory:

- **`calendar_events(from, to, notes?)`** lists events for any range, repeats expanded.
- **At the start of each run,** today's and tomorrow's events are added to the prompt. This is a starting point, and the tool is the way in (AGENTS.md, principle 2).
- **Outside content.** Titles and descriptions are marked as outside content: facts to plan around, never instructions. Descriptions are left out unless asked for.
- **Clashes.** When the agent schedules or re-estimates a todo, the tool result says if the slot overlaps a timed event ("It overlaps "排球" 19:00–21:00…"). It doesn't refuse, because sometimes overlapping is what the user wants. This caught a local model's arithmetic slip in testing (AGENTS.md, principle 8).
- **Dates.** The digest spells out the next fourteen days with their weekdays, because "next Wednesday" is where models most often went wrong. The first one is labelled tomorrow, since an unlabelled list made a model pick the wrong day for "明天".

## Tests

- `src/main/calendar/ics.test.ts` covers 23 ways feeds go wrong (`bun test`).
- `e2e/calendar.spec.ts` serves an Outlook-shaped and a Google-shaped feed from a real local HTTP server, with the zone pinned to Taipei. It covers:
  - subscribing through the GUI, including the failures;
  - checking each event's time in its detail panel: the moved occurrence, the skipped one, a Seattle call across daylight saving, UTC, and a two-day all-day event;
  - hiding a calendar;
  - a server that starts failing, which keeps the last copy;
  - removing a subscription, which removes its address and cache.
- `e2e/agent.spec.ts`, "plans around the calendar": with a local model, the agent schedules 45 minutes next Wednesday evening around 19:00–21:00 volleyball it isn't shown up front. It passed 3 of 3 once the clash check and the date list were in (earlier runs failed on wrong dates and overlapping slots). In the next full run it failed differently: the model looked up the right day, then asked the user to pick 18:15 or after 21:00 instead of scheduling one as a proposal.
- The Mac's calendars were checked by hand on 2026-09-30 (iCloud, a subscription and Birthdays showed and could be hidden). There's no automated test, because it depends on the machine's accounts and macOS permission.

## Not done

- **Google Calendar through EventKit** isn't verified yet, because the Mac used for testing had no Google account. Calendars not ticked at `calendar.google.com/calendar/syncselect` won't show through EventKit.
- **Writing to calendars.** Todos stay in Jezo, and events stay read-only.
- **Colors.** Events on the grid are one muted color. A calendar's color shows only in 連接.
