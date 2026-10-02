# Automations

Things Jezo starts on its own at set times, like planning the morning. One markdown file per automation, `items/<id>.md`, with an id that starts with `a-`. The body is exactly what you're asked when it runs, so changing the body changes what happens.

You may add, change or turn off automations when the user asks, or when it clearly helps (a weekly reminder they asked for). The user can undo it.

## Fields

- `name`: what the user sees, like 早上排程.
- `schedule`: when it runs, as a cron expression in the device's local time, which follows the user when they travel: minute, hour, day of month, month, day of week. `0 8 * * *` is every day at 08:00; `0 9 * * 1` is Mondays at 09:00; `0 20 * * 0` is Sundays at 20:00. The day of the week counts from 0, Sunday, to 6, Saturday.
- `state`: `on` or `off`.
- `catch_up`: how late it may still start when the computer was asleep or off at the time, in words: `no`, `for 90 minutes`, `for 2 hours`, `until 18:00` (that clock on the day it was due), `until end of day`, or `until next time`. Leave it out for `for 2 hours`. It never runs twice for one time, and never past the next one. A run that starts late is told how late, and which earlier times weren't run; what to do about them is up to the request.
- `zone`: leave it out to run on the device's clock; give a zone, like `America/New_York`, for a time that belongs to another place ("09:00 New York, wherever I am").
- `history/<id>.jsonl` records each time: run, skipped, or interrupted. Jezo writes it; read it, don't change it.
- `trigger`: only on the three automations Jezo comes with (`morning`, `evening`, `weekly`), whose conversations the app labels by it. An automation you add has no `trigger`, even a weekly one.
