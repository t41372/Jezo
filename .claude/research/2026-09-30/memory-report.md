## Recommendation: (b), our own memory, with parts ported from OpenClaw and Hermes

None of the three can store memory the way Jezo needs: one markdown file per memory in the workspace, each saying who said it and where it came from, with an index that can be rebuilt. (a) keeps memory in Postgres, outside the workspace. (c) cannot be pulled out of OpenClaw. The workable path is to write about 1–2k lines of TS ourselves, port a few of OpenClaw's small pure modules (MIT), and copy Hermes' wording and budget rules. Hindsight can still be a backend someone opts into later, as concept.md:40/45 already says, but it can't be dropped in as is (see below).

Repos were cloned into `refs/` (hindsight eb021da, openclaw e92ab30, hermes-agent), all as of 2026-09-29.

## Hindsight: rejected as the default, not even a drop-in for the opt-in slot

- **What it needs to run:**
  - A Python ≥3.11 FastAPI server plus a worker.
  - Postgres with pgvector. The default is `pg0`, an embedded Postgres, so Docker isn't needed.
  - `uv` on PATH: even the npm package `@vectorize-io/hindsight-all` just runs `uvx hindsight-embed@latest`.
  - The JS packages are HTTP clients only.
  - On first run it downloads embedding and reranker models from HuggingFace, and the full install pulls in torch.
- **LLM calls:**
  - Retain makes one LLM extraction call per 3000-char chunk.
  - Consolidating facts into observations and refreshing mental models make more calls.
  - Local OpenAI-compatible servers are supported, but the docs want untested models to handle 65k output tokens (`hindsight-docs/.../models.mdx:156`).
- **Deletion doesn't fit the GUI's "delete this memory."**
  - `PATCH /memories/{id}` only invalidates a fact, and the fact is "kept for audit (reversible)" (`hindsight-api-slim/hindsight_api/api/http.py:5894`). There is no route to delete a single memory.
  - `DELETE /documents/{id}` removes every fact extracted from that document at once (`http.py:~7939`).
  - "Opinions with confidence" were removed in 2026-04 (`alembic/versions/g2h3i4j5k6l7_remove_opinion_fact_type.py`). Observations now carry a `proof_count` and quotes instead.
- **Markdown:** it can only export pages to markdown (`hindsight fs`). It can't store memory as markdown.
- **The official pi extension** (`@vectorize-io/hindsight-coding-agents` 0.8.0) is built for coding:
  - It installs by writing `~/.pi/agent/settings.json`, which Jezo deliberately never loads.
  - It keeps one bank per git repo and seeds it from git history.
  - It saves the whole transcript after every run.
- **Maturity:** MIT, v0.10.2, releases about weekly, ~42.8k stars, claims state of the art on LongMemEval. The technology is strong; it just doesn't fit Jezo.

## Hermes Agent: borrow the behaviour, not the storage

- **Storage:** `MEMORY.md` (2200 chars) and `USER.md` (1375 chars), as flat entries separated by `§` with no metadata (`tools/memory_tool_store.py`, `hermes_cli/config_defaults.py:1321`). They go into the prompt as a frozen snapshot at session start.
- **Tool:** add, replace or remove, found by an exact match first, then a substring match. An ambiguous match is an error, and the result returns the text it replaced.
- **When memory is full:** the tool returns the current entries and "Consolidate now," and gives up after 3 failed tries.
- **Background review:** every 10 turns a forked agent reviews the conversation. It can only add; deletions wait for approval (`agent/background_review.py`).
- **Guidance worth copying** (`agent/prompt_builder.py:193`): write "declarative facts, not instructions," keep only "facts that apply to EVERY session," and skip task progress and anything easy to find again.
- **Providers:** built-in memory plus at most one external provider (`agent/memory_manager.py:337`). Recalled memory is fenced as `<memory-context>… NOT new user input</memory-context>`.
- **Session search:** FTS5 over the sessions with no LLM call (`tools/session_search_tool.py`).
- **Declined:** threat-pattern scanning on write, which scrubs the owner's input (AGENTS.md trust model), and approval gates on deletion (we use undo).

## OpenClaw: port ideas and pure modules, not the code

- **Files:** `USER.md` and `MEMORY.md` are loaded at start. The daily `memory/YYYY-MM-DD.md` files are reached only through `memory_search`.
- **Search** (`src/agents/memory-search.ts`, `extensions/memory-core/src/memory/`):
  - Hybrid FTS5/BM25 with a trigram tokenizer, plus vectors, weighted 0.7 vector / 0.3 text.
  - Then a 30-day decay, which spares the curated files, and MMR diversity (λ=0.7).
  - It uses `node:sqlite`, with sqlite-vec as an optional extra. Without embeddings it falls back to BM25.
- **Size:** memory-core alone is ~38k lines. It imports 57 `openclaw/plugin-sdk/*` subpaths, is `private: true`, and memory-host-sdk imports `../../../../src/...`. It can't be extracted, so (c) is out.
- **Deletion is weak:**
  - There's no delete tool; you edit the file.
  - A deleted fact survives in daily notes and indexed transcripts, and the always-on "dreaming" sweep can promote it again.
  - `memory forget` works on whole sessions, and its forgotten-session records live only in SQLite (`docs/concepts/memory-provenance.md`).
- **Good ideas:**
  - Supersede in place: `<!-- observed: DATE | status: superseded -->`, kept next to the new entry (`docs/concepts/user-model.md`). It cites HorizonBench on agents picking the original preference after the user changed it.
  - memory-wiki's `claims[]` with `evidence[]`, `confidence` and `status` in frontmatter (`docs/plugins/memory-wiki.md:131`).
  - Provenance kept in fields the model can't forge.
  - Content marked untrusted is never promoted or injected automatically.

## Others, briefly

- **Graphiti/Zep:** bi-temporal facts with `valid_at`/`invalid_at`. A contradiction invalidates the old fact instead of deleting it, the same idea as our `superseded_by`.
- **basic-memory:** markdown is the truth and SQLite is the index. It's AGPL-3.0, so we take ideas only, no code.
- **The file-per-memory pattern** is the same one Claude Code's auto-memory uses: one file per memory plus an index.

## Sketch for Jezo

**Layout.** This follows concept.md:63–64; the new parts are the tombstone ledger and the index.

```
memory/
  AGENTS.md  manifest.yaml  skills/
  items/<id>.md          one memory per file
  forgotten.yaml         tombstones: id, normalized-claim hash, evidence refs, deleted_at
```

**Frontmatter** (checked against `manifest.yaml`):

```yaml
kind: stated | inferred
about: preference | fact | pattern | person | ...
scope: global | todos | goals | habit:<id>
observed_at: 2026-09-29
valid_until: null
source: user | agent | connector:calendar:<event-uid> | connector:email:<msg-id>
evidence: [sessions/<id>.jsonl#L42, todos/items/<id>.md, habits/log-2026-09.jsonl#<entry>]
confidence: 0.6        # required when kind: inferred
superseded_by: null    # id of the memory that replaced this one
```

The body is one declarative sentence plus optional notes.

**Checks when a memory is written** (the existing write-service checks, principle 7):

- An `inferred` memory without `evidence` and `confidence` is refused.
- Evidence refs must resolve to real files and entries.
- If the session read outside content, `source` must name the connector. The write service fills `source` itself rather than trusting the model's value.
- A claim whose normalized hash, or whose evidence set, matches a tombstone is refused. The tool result explains why.

**Durable deletion.** When the GUI deletes a memory, it removes the file and appends a tombstone to `forgotten.yaml`. Undo can bring a deleted memory back; nothing else can.

- The tombstone lives in the workspace, not the index, so rebuilding the index can't bring a memory back.
- Sessions can be indexed for search.
- Anything that *extracts* memories from sessions, such as a review pass or a check-in, goes through the same checked write.

**Old preferences.** Supersede in place: the old file stays, with `superseded_by` pointing to the new one.

- The session-start digest and search drop superseded and expired memories by default.
- The GUI folds superseded memories under their replacement (principle 3).

**Index.** It is built with `node:sqlite` in Electron 44 and can be rebuilt from `items/` at any time.

- FTS5 with `tokenize='trigram'`. I tested this on 2026-09-29 in Electron 44 / Node 24.21 and it works for CJK. Queries under 3 characters (e.g. 健身) return nothing from MATCH, so fall back to `LIKE`, which is fine at human scale.
- Optional embeddings from the local server's `/v1/embeddings` (LM Studio and Ollama both serve it), stored with the model id. Similarity is computed in-process; skip sqlite-vec and `loadExtension`.
- Hybrid ranking and MMR ported from OpenClaw's `hybrid.ts` and `mmr.ts`. Decay applies only to `inferred` memories; stated preferences don't age.
- Cloud embeddings only if the user turns them on.

**Agent tools** (typed, shown as cards):

- `remember`: create, or supersede with `replaces: <id>`.
- `recall`: hybrid search that returns ids, frontmatter and body.
- `forget`: writes a tombstone.

The agent can also edit the files directly; the same checks apply.

**Digest.** At session start the agent gets a budgeted block: active stated preferences first, then high-confidence inferences, fenced as Hermes does. The budget limits what goes into the prompt, not what gets stored. Search covers everything else.

**Methodology** (principle 5): what's worth remembering, and when to review, lives in `memory/skills/`, written from Hermes' guidance. It is not hard-coded, and there is no always-on dreaming pass.

## Unverified

- pg0's data path (the docs say `~/.hindsight/pg0`, the code says `~/.pg0/instances`).
- How many LLM calls Hindsight makes per retain.
- The npm state of OpenClaw's plugin packages.
- sqlite-vec / `loadExtension` under Electron's hardened runtime. This doesn't matter if we skip it.
- The internals of Hermes' external providers.
