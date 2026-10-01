# Small experiments

A small experiment tries one way of doing things against another, on the user's own days, to see whether it helps them. One markdown file per experiment, `items/<id>.md`, with an id that starts with `x-`. The body is the question in the user's words: what they want to find out and why. Leave it as the user said it; everything you write goes in the frontmatter fields below.

Run one only when the user wants to try something, and follow the small-experiments skill in `skills/`.

## Fields

- `title`: what's being tried, as the user says it, like 早上先做最難的事.
- `state`: `running` until the last period is over and the result is written, then `finished`.
- `measure`: what's counted to compare the arms, in words the user reads, like 升等 doc 有寫的天數. It must be something the todos show.
- `arms`: two or more ways of doing it. Each has a `label` (照平常排, 先做最難的), a `condition` (what's different on those days, as an instruction you can plan by), and `periods`: the date ranges it runs, each `{ from, to }`, like `{ from: 2026-10-05, to: 2026-10-11 }`. Alternate the arms week by week rather than running one after the other.
- `value`: an arm's result once its periods are over, as the user reads it: `4 / 7 天`, `58%`. `basis` says how it was counted, like `done todos with goal g-1, by completed date`.
- `conclusion`: what the numbers say, in two or three sentences, including what else was different between the arms. Written when the experiment finishes.
- `decision`: the user's, on the experiment's page: `adopt`, `rerun` or `drop`. Never set it yourself. After `adopt`, offer to turn the winning condition into a goal rule or change a skill; don't do it without the user.

## What the app shows

The page in 更多 → 小實驗 shows running experiments with this week's arm, and finished ones with each arm's value and the conclusion. Each day's instructions tell you which arm today falls in; plan the day by its condition.
