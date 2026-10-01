# Todos

One markdown file per todo, `items/<id>.md`. The body is the user's notes about it, in markdown, and the app shows it as an editable page. Files the user added to the notes (a photo, a PDF) are in `attachments/<id>/`, linked from the body with a relative link like `![白板.png](../attachments/t-1/白板.png)`.

## Fields

- `title`: what to do, starting with a verb.
- `state`: `draft`, `open` or `done`. A todo you propose is a `draft` until the user accepts it. Drafts are not progress: never count them as done work, and never set a draft to `open` yourself.
- `goal`: the id of the goal it serves, if any.
- `amount`: how much of the goal's measure it moves when done, when that isn't 1: `16` for a 16 km run, `0` for a gym session that serves a running goal measured in km.
- `cue`: the situation it gets done in ("到公司倒完咖啡"), when there is one.
- `estimate`: minutes. Base it on how long similar todos actually took, not on what sounds right.
- `scheduled`: when it's planned. No `scheduled` means it's in the backlog. The tools write it for you; by hand, it's always a time with its zone, like `'2026-10-05T09:00[Asia/Taipei]'`: 09:00 by that zone's clock wherever the user is. Use the zone the time note names, or the one the user named for a call, a class or a deadline. A time without a zone is refused.
- `proposed`: `true` when the time is your suggestion and the user hasn't accepted it. Set it whenever you schedule something the user didn't ask for at that time.
- `rank`: the order in the backlog. Leave it to the app; tools set it.
- `steps`: smaller steps, each `{ text, done }`.
- `why`: your reasoning for when and how long, in a sentence the user would say back to you.
- `started`: set by the app while the user works on it.
- `completed`: when it was done, as a moment with its offset (`'2026-10-05T16:00:00+09:00'`). The app writes it when the user marks it done.

A todo is only `done` when the user said so or a tool result shows it. Planning it is not doing it.
