# 隨手記 (Notes)

Status: decided on 2026-09-29. The prototype has the page, the proposal card, and ⌥↵ in the ⌥X window; the agent is mocked.

## What it's for

A place to put things down the moment they come up, without deciding what they are: something to do, a half-formed goal, something about yourself, a book title. Sorting is the part that costs energy, so it's the part the agent takes. When the user wants, they hand the unsorted notes to the agent, and it proposes what each one becomes.

It's a first-party plugin, built the way a user's plugin would be: its own directory, page, strings, skill, and its own kind of chat message.

## Decisions

- **A note is free text, one line or several.** No fields, categories, or tags when writing it down; anything asked at that moment makes jotting cost more than forgetting. Each note records when it was written and whether it came from the page or from ⌥X.
- **Sorting starts when the user hands the notes over** (「交給 agent 整理」). It's a short session like the others, with the trigger `notes`, and it shows in the chat list.
- **Five outcomes.** The agent proposes that each note is:
  - a todo, which goes into the backlog with no time;
  - a goal idea, which isn't a goal yet (see below);
  - something to remember about the user, which is written to memory as stated, since the user said it;
  - a note to keep as it is;
  - or a question back to the user, when it can't tell. The user answers with one of the four, and the note becomes that, in the user's own words.
- **Nothing is created until the user accepts.** The proposal card is the draft. Accepting a row creates what it proposes; turning it down puts the note back in the list, so nothing is lost. Every decision on the card can be taken back, which removes what it created.
- **Goal ideas land on the Goals page** under 還在想的目標. A goal needs a direction, a measure, and rules, which come from talking it through, so clicking an idea opens a conversation to do that. The skill tells the agent not to create goals straight from notes.
- **Kept notes stay under 已整理** with the rest, and are never sorted again.
- **The page shows the newest proposal** until every note in it is decided, and after that until the user puts it away, so a decision can still be taken back. The same card is in the conversation.
- **⌥↵ in the ⌥X window files the text in 隨手記** instead of asking the agent, and doesn't bring the main window forward. ↵ still asks. The window says 「記到隨手記了」 for a moment and closes, with no animation.
- **How to sort is a skill,** 整理隨手記, on by default and editable like the others (AGENTS.md, principle 5). It sets the categories, the wording, and when to ask.

## On disk

The plugin is a directory in the workspace:

```
notes/
  AGENTS.md                  what the directory is, and how to sort it
  manifest.yaml              the note schema, which the GUI and the validator read
  skills/整理隨手記/SKILL.md
  items/<id>.md              one file per note
```

Each note is markdown with frontmatter, like todos ([storage.md](storage.md)):

```markdown
---
id: n-01J8Z3
created: 2026-09-29T08:31:00+08:00
source: hotkey        # page | hotkey
state: sorted         # new | sorting | sorted
became:               # set once sorted
  kind: todo          # todo | goal | memory | keep
  ref: t-01J8Z4       # the todo or memory it became
---
記得回房東訊息，問冷氣什麼時候修
```

The validator checks that `became.ref` points at something that exists. Where the proposal is kept while it's open depends on where sessions are stored, which isn't decided yet.

## Rejected

- **One free-form markdown file for all notes.** Notes would be identified by their position in the file, which breaks as soon as the file is edited; [storage.md](storage.md) records this trap from SilverBullet.
- **Creating draft todos in the backlog as soon as the agent proposes them.** The same draft could then be accepted or discarded both on the card and in the backlog, and the two would drift apart.
- **Sorting without being asked.** The notes are half-formed on purpose. Turning them into todos before the user is ready fills the list with things they didn't decide to do.
- **Categories or tags when writing a note down.** See the first decision.

## Not wired

- The real agent. A keyword table in `data/mock-agent.ts` stands in for sorting.
- Voice into 隨手記: holding ⌥X still talks to the agent.
- The morning digest mentioning how many notes wait to be sorted.
