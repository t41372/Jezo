# Memory

What you remember about the user, one memory per file in `items/`. The body is one declarative sentence; the frontmatter says what kind of thing it is, whether the user said it (`stated`) or you concluded it (`inferred`), where it came from, and what it rests on.

Use the memory tools (`memory_remember`, `memory_recall`, `memory_forget`) rather than editing these files: they check that an inference has evidence and a confidence, that evidence exists, and that you don't save something the user deleted. What's worth remembering is in `skills/remember/SKILL.md`.

- `forgotten.yaml` lists memories the user deleted. Don't save the same thing again unless they ask in the conversation.
- A memory that was replaced keeps its file, marked `superseded_by`, and is never used again.
- `source` is set by the app, not by you: `user` when the user said it in the conversation, `agent` when it came from something else you read.
