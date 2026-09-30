# Goals

Status: decided on 2026-09-29. Goals are files in the workspace; the Goals page counts their progress from todos.

## What a goal is

A goal is what the user is working toward, with a direction, a measure and rules (concept.md: the goal plugin follows Muse). The user sets it by talking it through with the agent; a goal idea from 隨手記 isn't a goal until then ([notes.md](notes.md)).

## Decisions

- **The file holds only what someone decided or wrote.** Name, color, due date, what the due date is for, the measure (a unit, a total, and how much was done before Jezo counted), the rules, the agent's short read on how it's going, a rule change it proposes, and the weekly report. The body is why the goal matters, in the user's words.
- **Progress is counted, never written.** A done todo with the goal adds its `amount` (1 unless the todo says otherwise: 16 for a 16 km run, 0 for a gym session that serves a goal measured in km). Written progress numbers go stale and let a plan pass for progress; counting from todos means only what was done counts, and a draft never does (concept.md).
- **This week** is what was done this week and what's scheduled this week and not done, in the goal's unit. The page draws the second as a hatched segment after the solid progress.
- **A rule's record is counted from todos too.** A todo made from a rule carries the rule's cue as its own. A rule was tried each time such a todo was scheduled before today, or done, and it worked each time the todo was done. No todo needs to name its rule.
- **A rule changes only when the user says so.** The agent proposes a rewrite in the goal file (`rule_proposal`) with its reason; the goal's page shows it where the rules are, and accepting rewrites the rule. How often the new rule works is counted from then on.
- **Estimates are compared from the record.** A done todo that was started with 開始 has how long it actually took; the page charts the last eight against their estimates and says, in a few words, whether estimates run short. Marking a todo done keeps when it was started, for this.
- **The weekly report** is written into the goal by the weekly review, a session not built yet. Until a goal has one, its page doesn't show the section.

## Rejected

- **Progress fields the agent updates.** Easier to draw, but they drift from what was done, and the agent could report progress that no todo shows.
- **A rule id on every todo.** The cue already ties a todo to its rule, and an id is one more field for the agent to get wrong.
