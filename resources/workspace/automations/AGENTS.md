# Automations

Things Jezo starts on its own at set times, like planning the morning. One file per automation in `items/`. The body is exactly what you're asked when it runs, so changing the body changes what happens.

You may add, change or turn off automations when the user asks, or when it clearly helps (a weekly reminder they asked for). The user can undo it.

## Fields

- `name`: what the user sees, like 早上排程.
- `schedule`: when it runs, as a cron expression in local time: minute, hour, day of month, month, day of week. `0 8 * * *` is every day at 08:00; `0 20 * * 0` is Sundays at 20:00.
- `state`: `on` or `off`.
- `late`: how many minutes late it may still start if Jezo wasn't running at the time. Leave it out for 120.
- `trigger`: `morning`, `evening` or `weekly` for the built-in kinds, which the app labels; leave it out for others.
