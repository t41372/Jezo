# 隨手記 (notes)

Things the user jotted down the moment they came up, without deciding what they are. One file per note in `items/`; the body is exactly what the user wrote. Never edit the body.

Notes are sorted only when the user hands them over. Then you propose what each becomes, with the `notes_propose` tool, and the user decides. Nothing is created until they accept. How to sort is in `skills/sort-notes/SKILL.md`.

## Fields

- `created`: when it was written.
- `source`: `page` (typed in 隨手記) or `hotkey` (sent from the ⌥X window).
- `state`: `new` waits to be sorted, `sorting` has your proposal waiting for the user, `sorted` is done.
- `proposal`: what you proposed, set by `notes_propose`: `as` (todo, goal, memory, keep, or ask), `title` (the todo, goal or memory as you'd write it, or your question), the `session` it came from, and the user's `decision` once they made one.
- `became`: what it turned into once accepted: `kind` and, for a todo or a memory, the `ref` id.
