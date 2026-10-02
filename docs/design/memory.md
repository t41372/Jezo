# Long-term memory

Status: decided and built on 2026-09-29. On 2026-09-30 the storage rule was loosened (see [storage.md](storage.md)): the agent never edits memory by hand, so memory may pick its own format inside its own directory.

## Decision

Jezo's memory is our own pi extension, `@jezo/pi-memory` (in `packages/pi-memory`). Anyone using pi can load it with `pi -e @jezo/pi-memory`, and Jezo loads it with a store and a sense of where words came from that Jezo supplies itself. It's one extension like any other, so if something better shows up, we replace it.

What it has to get right, in the order it matters to the person coming back after two weeks away:

1. **It forgets reliably.** Once the user deletes something, it's no longer treated as a fact, and it doesn't come back.
2. **It takes corrections.** When a preference changes, the new one wins, and the old one isn't used again.
3. **It separates what the user said from what the agent guessed.** Two missed workouts are evidence of two missed workouts, not a trait.

## How it works

- **Records.** Each memory is `memory/items/m-*.md`: one short declarative sentence in the body, and in the frontmatter `epistemic` (stated or inferred), `source`, `recorded`, `status`, `evidence`, `confidence`, `valid_until`, and `supersedes` / `superseded_by`. `memory/manifest.yaml` checks them like any other plugin's items, so the 它記住的事 page reads them the same way.
- **Where words came from is set by the host, not the model.** Jezo fills in `source` (did the user's own message start this run, or an automation?) and adds the conversation file as evidence. A memory can be "stated" only if the user said it in this run or evidence points to what they wrote.
- **Inferences need evidence and a confidence.** Without them the tool refuses and says why. Each evidence path has to exist.
- **Corrections.** `replaces` marks the old memory `superseded` and keeps its file for the record. Superseded and expired memories are never recalled or put in context.
- **Related memories.** A save without `replaces` that looks close to a current memory (a quarter of its character pairs in common, which works for Chinese without spaces) is held back. The tool lists the close ones and asks the agent to call again with `replaces` or `separate: true`. Found with a real model on 2026-09-30: asked to change a guitar lesson from Wednesday to Thursday, it left out `replaces` two runs in three, which left two lessons that contradicted each other. The hold is the agent's: a note the user accepts as a memory on 隨手記 is saved beside related memories, and even in words they once deleted, since accepting it is the user saying to keep it.
- **Deleting to update.** The same model also deleted the old memory and saved a new one. That loses the history, and the old words can't be saved again. So when the agent deletes, the first call is held back and says to use `replaces` if something changed. `confirm: true` counts only on the second call, because the model sometimes sent it on the first. `separate: true` likewise counts only after a save was held back in the same run.
- **Nothing held back is left undecided.** The model sometimes stopped right after a save was held back, and then nothing was saved. So before a run ends, anything still held back goes back to the agent once, as a hidden message.
- **Garbled field names.** With qwen3.8-27b-splash, the model once sent `"replaces id=\"m-…\""` as a field name, ten times in a row until the test timed out, sure each time it had set `replaces`. `memory_remember` now says which fields it ignored and names the real ones, the way Jezo's own tools do (backend.md).
- **What this got to.** With a local model (qwen3.6-35b in LM Studio), the E2E test "remembers… replaces it when it changes" went from failing two runs in three to passing six runs in eight. In the remaining failures the model calls no memory tool at all, or saves the new version without marking what it replaces.
- **Forgetting.** Deleting a memory, from the GUI or through `memory_forget`, removes its file and adds a hash of its normalized text to `memory/forgotten.yaml`. Saving the same words again is refused unless the user asked for it in this conversation (`again`, which only counts when the user started the run). The agent also can't read back the conversations the deleted memory cited as evidence, so it doesn't learn the memory again from the old chat. Going on in that same conversation is different: what was said there is the conversation the user sees, and the agent reads it as any chat does. Deleting a memory forgets it from now on; deleting what was said is deleting the conversation. Undo puts the file back and takes the entry out of `forgotten.yaml`. Recall and the prompt's memory section also skip anything `forgotten.yaml` lists, by id or by its words, so a forgotten memory's file that comes back from a backup or a copy stays forgotten (found by the sync research, 2026-09-30).
- **Search** is an SQLite FTS5 index with the trigram tokenizer, built in memory from the files on load. Queries under three characters use LIKE, since trigram can't match them. The index is thrown away with the process.
- **Context.** At the start of each run, the extension adds a memory section to pi's system prompt. It holds how to use memory, then stated memories, then inferences, most confident first, up to about 2400 characters. Memories matching the request that didn't fit are listed after that. What's worth remembering is a skill (`memory/skills/remember`) the user can edit.
- **Writes** go through Jezo's workspace, so the agent's memory changes show in 修改紀錄 and can be undone like any other change.

## Rejected

Research was done on 2026-09-29 (by Claude, with a second, deeper pass by Codex).

- **pi-hermes-memory** (named in the first concept). Its records are flat entries with no field for where a memory came from, whether it was said or inferred, or what replaced it, and SQLite is the authority in its default mode. Its consolidation now runs in-process by default, which removes an earlier objection, but not these.
- **Hindsight.** Strong on benchmarks and MIT, but:
  - It runs a Python server and worker with an embedded Postgres (pg0) and pgvector, and the full install pulls in torch and downloads models on first run.
  - Every save calls an LLM to extract facts.
  - A single memory can't be deleted: invalidating one keeps it and can be reversed, and deletion only works on a whole document. That breaks the first requirement above.
  - Its pi extension writes the user's `~/.pi/agent/settings.json` and keeps one memory per git repository.
- **OpenClaw's memory-core.** It's tied to OpenClaw's plugin SDK and can't be taken out on its own. We took ideas from it instead: supersede in place, claims with evidence and confidence, and provenance the model can't forge.
- **Hermes Agent's memory.** It's two capped markdown files with no metadata. We took its writing rules (facts, not instructions; only what matters in every session; recalled memory marked as reference, not new input from the user) and its FTS5 search without an LLM call.
- **Others.**
  - Mem0 only adds facts and doesn't replace them, and its high scores come from the hosted version.
  - Zep/Graphiti, Honcho and Memobase need database services.
  - Letta would replace pi.
  - Basic Memory is AGPL-3.0.
  - ReMe is the closest match (files are the truth, Apache-2.0, Python) and is the one to compare against if we revisit this. Like every option surveyed, it leaves forgetting and provenance to the application.

## Open

- **Files or SQLite.** Files are what's built. The store is an interface (`MemoryStore`), so an SQLite store is one class away. Files still get undo and the plugin page for free, so there's no reason to switch yet.
- **Putting memory into context.** Memory puts a budgeted section into context at the start of each run, which AGENTS.md principle 2 allows as long as it isn't the only way in: `memory_recall` and the files are there too. If it turns out the agent recalls just as well with only `memory_recall`, drop the section.
- **Review.** The check-in doesn't show what the agent will remember yet (the memory cards are still mock).
