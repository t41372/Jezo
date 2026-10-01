# Goals

One markdown file per goal, `items/<id>.md`, with an id that starts with `g-`. The body is what the goal is for, in the user's words: why it matters and what "done" means to them.

A goal needs a direction, a measure and rules. Create one only after talking it through with the user; a goal idea from 隨手記 isn't a goal yet.

## Fields

- `name`: short, as the user says it.
- `hue`: its color, a hue from 0 to 360. Pick one no other active goal uses.
- `state`: `active`, `paused` or `done`.
- `due`: the date it's due, if it has one, like `2026-11-15`. `due_note` says what happens then ("送出", "台北馬").
- `measure`: how progress is counted: `unit` (段, km, 次), `total`, and `start`, how much was done before Jezo counted.
- `rules`: how the goal gets done, each a `cue` (the situation) and an `action`. Todos made from a rule use the rule's cue as their `cue`, so the app can count how often each rule worked.
- `note`: your honest read on how it's going, in two sentences at most. Update it when you review the goal.
- `rule_proposal`: a change to a rule you want the user to decide on: `rule` (its index), `cue`, `action`, and `why`. Never change a rule yourself; propose it here, and the user accepts or turns it down on the goal's page.
- `report`: the weekly report, written by the weekly review: `range` and `lines`, each `{ text, basis }` where basis is `stated` or a number of records.

## What the app counts

Don't write progress numbers into goals. The app counts them from todos: a done todo with this `goal` adds its `amount` (default 1) to the progress. Set `amount` on a todo when it moves the measure by more than one, like `amount: 16` for a 16 km run.
