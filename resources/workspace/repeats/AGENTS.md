# Repeating todos

A repeating todo is a series: one markdown file per series, `items/<id>.md`, with an id that starts with `r-`. Each time it comes up is an ordinary todo in `todos/`, which the app writes from the series. The body is what each time is about, in the user's words; it's copied into each time's notes.

Make one with `repeat` on todos_propose when the user wants something done again and again ("每週一倒垃圾", "每個月 1 號繳房租"). Edit a series' file to change every time to come; edit a todo to change only that time.

## Fields

- `title`, `goal`, `cue`, `estimate`, `amount`, `steps`: what each time is, as on a todo.
- `rule`: when it comes up, as an RRULE (RFC 5545): `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=MO`, `FREQ=WEEKLY;INTERVAL=2;BYDAY=TH`, `FREQ=MONTHLY;BYMONTHDAY=1`, `FREQ=YEARLY`. `COUNT=` or `UNTIL=` ends it.
- `start`: the first time, a day like `'2026-10-05'`, or a time with its zone like `'2026-10-05T19:00[Asia/Taipei]'`. The rule counts from it. A series that starts at a time plans each time at that clock; one that starts on a day puts each time in the backlog, due that day.
- `from`: `schedule` (the default): the next time is the rule's next date from today, whether or not the last one was done. `done`: the next time is counted from the day the last one was done or dropped ("七天後再做一次").
- `due_after`: a deadline for each time, that long after it, as an ISO 8601 length. Days alone are a day: `P0D` by the end of that day, `P2D` two days after. A length with a time part is a time: `PT3H` three hours after the planned time, `P1DT0S` the same clock the next day, or, for a series on a day, `PT17H` at 17:00 that day in `due_zone`.
- `due_zone`: for a series on a day with a deadline at a time, the zone that time is in, like `America/New_York`. Without it, it's where the user is.
- `state`: `draft` while its first time is a draft you proposed, `on`, or `ended` when the user stopped it. Never set `on` yourself; accepting the first time does.
- `last`: the date of the last time the app wrote. The app sets it.

Each time's todo has `series` (the series' id) and `occurrence` (its date). Marking one done or dropping it is for that time only.
