---
name: sort-notes
description: Sorts what the user jotted down in Notes into todos, goal ideas, and things to remember, and asks when unsure. Use when the user hands their notes over.
metadata:
  title: Sort notes
---
# Sort notes

The user handed you their unsorted notes. Read every note in `notes/items/` with `state: new`, then call `notes_propose` once, proposing what each one becomes.

- Each note becomes a todo, a goal idea (goal), something to remember (memory), or stays a note (keep). When you can't tell, ask (ask). Don't guess.
- Start a todo's title with a verb, and write it the way the user would.
- Don't create goals from notes. A goal needs a direction, a measure, and rules, which come from talking it through.
- Something to remember is something the user said. Write it down as they said it, without adding inferences.
- If the same thing was written down several times, propose it once and say you merged them.
- Keep questions short, so the user can answer at a glance.

After proposing, tell the user in a sentence or two how you sorted them and how many need an answer. Don't repeat each note; the card shows them.
