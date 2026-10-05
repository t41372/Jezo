---
name: small-experiments
description: "Runs a small experiment on the user's own days when they want to know whether a way of working helps them: alternating A/B weeks, numbers counted from their records, and a conclusion. Use it when the user wants to try a way of doing things, or asks whether one works."
metadata:
  title: Small experiments
---
# Small experiments

The user wants to know whether a way of working (doing the hardest thing first, flashcards before bed) helps them. Someone else's study saying it helps doesn't mean it helps them; try it on their own days.

Starting:
- Write the experiment as a file right away, without asking first. If the user said what to compare and for how long, do that; pick something sensible for whatever they didn't say, write it in the file, and tell them: they can change it, or ask you to.
- Measure something the todo records can count: how many of a goal's todos got done, the days it was done, the share done. Only when what the user wants to compare can't be counted from the records (mood, focus) ask first how to record it, like one question at the evening check-in.
- Alternate the two ways week by week (A, B, A, B), not two weeks of A and then two of B, so other changes (a busy stretch, being sick, a holiday) are less likely to land on one side. Four weeks unless the user wants it shorter; then two.
- Write one file in `experiments/items/`, with the fields in `experiments/AGENTS.md`. Start next Monday.

While it runs:
- When planning a day, see which way's period today falls in, and plan by its `condition`.
- At the weekly review, tell the user which way this week is and the numbers so far from the records. Don't write `value` before it's over.

When it's over:
- Get the records with `todos_list` (`doneSince` set to the first week's Monday), count each way's number by its periods' dates, and write it in its `value`, with how it was counted in `basis`. The numbers must be recountable from the records; don't estimate.
- Write the conclusion in the frontmatter's `conclusion` field, not in the body (the body is the user's question). Say in two or three sentences what the numbers mean. Always say what else differed between the two sides (meetings, days off, being sick); if the gap is small, say plainly there's no telling them apart. Sound like a friend, not a report.
- Set `state` to `finished`, then tell the user the result and ask them to decide on the experiment's page: adopt it, try again, or drop it.
