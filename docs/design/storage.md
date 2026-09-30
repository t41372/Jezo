# Storage

Status: decided on 2026-09-29, based on research done that day. Markdown for prose, fields for structure. Revised on 2026-09-30: formats are defaults, not principles (see below).

## Question

Can plugins, UI layouts, todos, calendar data, and the rest of the user's data all live as files, using markdown wherever possible?

## Verdict

Yes, for data at human scale that people and the agent write: todos, goals, check-ins, memory, manifests, and layouts. Several projects already run this architecture: files are the truth, and the index can be thrown away and rebuilt. Four parts of the original concept needed to change:

1. **"Markdown wherever possible" becomes "markdown for prose, fields for structure."**
2. **The GUI never re-serializes a whole file.** Edits are surgical and normally go through one write service. Writes that bypass it, such as the agent's shell commands, are detected rather than forbidden.
3. **"Undo = git revert" is not safe in general.** See the measurements below. Resolved: the workspace is no longer a git repo, see [undo.md](undo.md).
4. **One commit per turn conflicts with real deletion.** Resolved the same way: with no git in the workspace, deleting a file removes it from the workspace. Copies remain in the undo record (the last 100 runs, in the app's data directory) until they age out, and forgetting a memory keeps a hash of its words so it isn't saved again.

**Revised 2026-09-30.** AGENTS.md now keeps two principles from this: the user's data lives in the workspace (principle 1), and the agent reaches it with files and tools it can find, with anything we put into its context as a starting point only (principle 2). Formats are defaults that serve those, decided here:

- **The default is a format the agent can edit directly:** markdown for prose, frontmatter fields for what's queried, JSONL for logs, YAML for layouts and configuration. Opening the workspace in Typora or Obsidian is a side benefit of this, not a promise.
- **A plugin may pick its own format** (SQLite, say) inside its own directory when the agent never needs to read or fix a record by hand, because it works through the plugin's tools. Todos, goals and notes don't qualify. Memory does, though it stays as files for now ([memory.md](memory.md)). Dense logs like health data would. A plugin that does this still owes what files give for free: the GUI shows its data, the agent can search and change it through tools, and it supports backup, export, deletion and undo for the agent's changes.
- **Every stored thing has one role:** Jezo's own records (the truth), a copy of something an outside service owns (a mirror: the service is the truth), derived data (indexes), or temporary state. A mirror of an outside calendar isn't user data in the workspace; local notes about it and changes not yet sent are.

Files don't make sync between devices impossible (SilverBullet merges outside and concurrent edits), but they don't provide it either: identity, conflicts and deletions need their own design. Logseq left files largely over sync. A phone that works offline is likely later, so sync is being designed ahead of time (see the handoff; the design will get its own doc).

## Precedents

- **Logseq moved from files to a database.** The reasons its team gave: creating a block rewrote the whole file, renames touched every referencing file, blocks had no persistent IDs or timestamps, sync lost data, and undo was unreliable. The cost is that markdown export "cannot capture all data in a graph". Sources: https://discuss.logseq.com/t/why-the-database-version-and-how-its-going/26744 and https://github.com/logseq/docs/blob/master/db-version.md
- **Taskwarrior 3 moved from text files to SQLite (TaskChampion).** The stated goals were reliability, encrypted sync, and embeddability. Sync works on an ordered log of operations. Source: https://github.com/GothenburgBitFactory/taskwarrior/discussions/3208
- **Obsidian keeps files and an index.** Properties are YAML frontmatter, and Bases write back into frontmatter.
  - The Properties UI can't edit nested YAML, and it once dropped YAML comments.
  - Links are updated only when a rename happens inside Obsidian.
  - `workspace.json` changes constantly and has to be kept out of git.
- **Obsidian Tasks keeps checkboxes with inline metadata.** It is fragile.
  - Unicode edge cases break its parser.
  - Recurring tasks insert new lines and drop IDs.
  - Its docs say not to use recurrence in daily notes: https://publish.obsidian.md/tasks/Getting+Started/Recurring+Tasks
- **SilverBullet, org-roam v2, and basic-memory use this architecture: markdown is the truth and the index is rebuildable.** SilverBullet's default task reference is `page@pos`, which changes when the page is edited, so identity by position is a known trap. Source: https://docs.silverbullet.md/Object
- **Beancount's Fava is the best example of a GUI over text files.**
  - It rewrites only the edited entry's lines.
  - Every save carries a sha256 of the file and fails if the file changed on disk.
  - `bean-check` validates the files.
  - Source: https://beancount.github.io/fava/api/fava.core.html
- **vdir (vdirsyncer/khal)** stores one `.ics` file per item, named by UID, and writes atomically.
- **Hermes Agent memory** is a set of markdown files with size limits. A write over the limit returns an error listing the current entries, and the agent must consolidate. Source: https://hermes-agent.nousresearch.com/docs/user-guide/features/memory

## Failure modes and mitigations

**Round-tripping GUI edits.**
- Complete markdown round-tripping through mdast is not possible.
- Home Assistant's UI dashboards lose comments because the frontend moves JSON around.
- With the `yaml` package, a Document API edit kept comments but reformatted unrelated lines. A CST edit (`CST.setScalarValue`) changed exactly one line.
- GUI edits replace only the top-level fields that changed, found by their position in the parsed frontmatter, and leave every other byte as it was; see [backend.md](backend.md), "Why key by key". The body is replaced only when it changed.

**Identity.**
- Every entity gets an immutable ID in frontmatter, and the filename is only a slug.
- Links use IDs, and the index maps ID to path.
- The agent can rename files through bash, so links can't depend on paths.

**Concurrency and file watchers.**
- File events can be dropped. VS Code's wiki says there is "no 100% guarantee".
- Mitigations:
  - One write service as the normal path for the GUI, the agent, and connectors. Writes that bypass it, such as shell commands, are detected by the watcher and hash checks, not forbidden.
  - A hash check before each write.
  - Temp-file-and-rename writes.
  - Watcher events treated as hints, backed by a periodic scan.

**Scale.** Measured on this Mac:
- Parsing 10,000 todo files took 0.51 s.
- 3,000 commits took about 60 ms each, and after them `git status` and `git revert HEAD` took 23 ms each.
- One file per entity is fine at tens of thousands of files.

**Undo by revert.** Measured:
- Reverting a turn from ten turns back conflicted on a shared log file.
- With `merge=union`, the revert "succeeded" but left the reverted line in place, so the undo was silently incomplete.
- Reverting only the newest turn works. This is why the workspace is no longer a git repo; see [undo.md](undo.md).

**Data that fits files badly.**
- High-frequency events (habit completions, time tracking): append-only JSONL.
- Connector mirrors: a rebuildable cache, not source data.
- Recurring items: an RRULE plus exceptions, not inserted lines.
- Secrets: the OS keychain.
- Ephemeral UI state: app-local storage.

**Synced folders.**
- Syncthing's lead: "Do not use Syncthing to sync Git repositories."
- iCloud and Dropbox create conflict copies of files.
- Jezo should warn when the workspace is inside iCloud, Dropbox, or Syncthing, and should treat conflict copies as errors.

**How reliably LLMs write each format.**
- Tam et al. (EMNLP 2024) found that format restrictions hurt reasoning, and that YAML and JSON parse failures depend heavily on the model: https://arxiv.org/html/2408.02442v1
- This argues for offering typed tools with flat arguments for structured data, and letting the service write the file. They make the job easier, but the agent can still edit files directly, and checks catch mistakes.

**Privacy and deletion.**
- In a git repo, history keeps everything, and reverting a turn that deleted something brings it back. A real purge would mean rewriting history (`git filter-repo`).
- Without git in the workspace, deleting a file removes it, apart from the undo record (the last 100 runs), session transcripts that mentioned it, and any backups the user runs. A way to remove every copy Jezo controls is still to be built.

## Page and dashboard layouts

- **Precedents.**
  - Home Assistant: YAML-mode dashboards can't be edited in the UI, and UI-mode dashboards lose comments. Once you "take control" of the default dashboard, it no longer updates. A missing custom card shows an inline error.
  - Grafana: provisioned dashboards overwrite UI edits. It runs schema migrations, and a missing panel plugin shows a placeholder.
- **Format.** One small YAML file per page, validated against JSON Schema. Operations such as add, move, and set props make layout changes easy for the agent, but it can still edit the file directly, and validation catches mistakes.
- **Missing or changed widgets** render as placeholders, and the GUI keeps the unknown node intact when it saves.
- **Built-in pages** are layouts of the same kind users build, shipped with the app as read-only defaults. User changes are stored as overrides keyed by widget instance. That avoids Home Assistant's dead end, where forking the default dashboard stops it from receiving updates.

## Mapping

| Data | Format | Granularity | Source of truth |
|---|---|---|---|
| Todos, goals, projects | MD + frontmatter | 1 file per entity | yes |
| Check-ins, journal | MD + frontmatter | 1 file per day | yes |
| Memory | the memory plugin's own choice (now MD + frontmatter) | its own directory | yes |
| Local events | MD + frontmatter with `rrule` | 1 file per series | yes |
| Habit, completion, and time logs | JSONL, append-only | 1 file per plugin per month | yes |
| Manifests and schemas | YAML / JSON Schema | per plugin | yes |
| Page layouts and overrides | YAML | 1 file per page | yes |
| Connector mirrors | `.ics` / JSON cache | 1 per item | no (rebuildable) |
| Index, FTS, embeddings | SQLite | 1 database | no (rebuildable) |
| Secrets | OS keychain | n/a | never in the workspace |
| UI state | app-local JSON | n/a | no |
