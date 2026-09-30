# Todos

One file per todo in `items/`. The body is optional prose about it.

## Fields

- `title`: what to do, starting with a verb.
- `state`: `draft`, `open` or `done`. A todo you propose is a `draft` until the user accepts it. Drafts are not progress: never count them as done work, and never set a draft to `open` yourself.
- `goal`: the id of the goal it serves, if any.
- `cue`: the situation it gets done in ("到公司倒完咖啡"), when there is one.
- `estimate`: minutes. Base it on how long similar todos actually took, not on what sounds right.
- `scheduled`: when it's planned, like `2026-09-29T09:30`. No `scheduled` means it's in the backlog.
- `proposed`: `true` when the time is your suggestion and the user hasn't accepted it. Set it whenever you schedule something the user didn't ask for at that time.
- `rank`: the order in the backlog. Leave it to the app; tools set it.
- `steps`: smaller steps, each `{ text, done }`.
- `why`: your reasoning for when and how long, in a sentence the user would say back to you.
- `started`: set by the app while the user works on it.
- `completed`: when it was done.

A todo is only `done` when the user said so or a tool result shows it. Planning it is not doing it.
