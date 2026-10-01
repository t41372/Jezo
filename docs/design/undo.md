# Undo

Status: decided on 2026-09-29, based on research done that day.

## Question

The original concept made the whole workspace a git repo, with one commit per agent turn and undo as a revert. Was that right, and how do agent products actually implement undo?

## What undo is for

Undo exists so that when Jezo's agent makes a mistake, the user can roll it back right away.

- **The agent's changes are undone.** Ordinary GUI edits are not in history. Removing a top-level skill is one explicit exception: its dialog promises undo in 修改紀錄, so the removal is recorded as a user action ([skills.md](skills.md)).
- **History is bounded.** It keeps the last 100 runs (`src/main/agent/undo.ts`), with each file's content before and after, so it holds private copies until they age out. Losing it, or being unable to rebuild it, is acceptable.
- **Users never see git or a CLI.**

## How agent products do it

Most agents keep checkpoints in their own storage, outside the user's git. The ones that write into the user's repo ran into bugs.

| Product | Mechanism | Undo semantics |
|---|---|---|
| Claude Code | copies of each file taken before an edit, in `~/.claude/file-history/`; only its own edit tools are tracked, not bash | restore to a point |
| Cursor | local store "separate from Git" | restore to a point; with several agents in parallel, restoring one reverted the others |
| Gemini CLI, Roo Code | shadow git repo outside the project (separate `GIT_DIR`) | restore to a point |
| OpenCode | shadow git trees in its data directory; covers the whole worktree, including bash effects | revert per file; bugs include bringing deleted files back and 40 GB of disk use |
| Hermes Agent | a shared shadow store in `~/.hermes/checkpoints/`, never the project's `.git`, plus a ledger of the hashes it wrote | restore to a point, but files the user edited afterward are skipped, not overwritten |
| Codex | "ghost commits" in the user's repo, later removed; the desktop app's refs in `.git` grew to 102 GB of orphaned objects | per turn |
| Aider | real commits in the user's repo | `/undo` only on the last commit |
| Zed | dangling commits in the user's `.git` | restore to a point; files the agent created are left behind |
| pi | nothing built in; extension examples use git stash or refs | restore to a point |

Restoring to a point undoes everything after that point, including the user's own edits. Hermes is the one exception that fits "only undo the agent": it records the hash of every file it writes, and on rollback it skips any file that no longer matches, because that means someone else changed it since.

## Why git in the workspace doesn't fit

- **Restoring to a point also undoes the user's edits.** `git revert` of an agent commit conflicts when the user has since edited the same file, or it half-applies. This matches the measurement in [storage.md](storage.md).
- **The workspace isn't a repo the user wants.** It ends up holding git state they never see and can't manage. That is where Codex's and Zed's problems came from.
- **History would be kept forever**, which undo doesn't need.

## Decision

Follow Hermes' model, with storage outside the workspace. Built on 2026-09-29 (`src/main/agent/undo.ts`), at file level:

1. **Record what the agent writes.** For every file Jezo's agent changes in a turn, store the file's content from before the change and the hash of what the agent wrote, in the app-data directory. Changes made through the shell are caught by comparing hashes of the workspace files before and after the turn.
2. **Undo checks before it reverts.** A file is restored only if its current hash still matches what the agent wrote. If the user has changed it since, it's left alone, and the preview says so, for example: "3 changes undone, 1 kept because you edited it afterward". The restore is written through the workspace as a change by the user, like an edit in the GUI, so the index, the windows, and later a sync see it the same way.
3. **For structured data, go per field** if file-level checks turn out to be too coarse. Record `{entity id, field, old, new}`, so the agent's change to one field can be undone even when the user edited a different field in the same file.
4. **Keep only recent turns.** History older than a short window is dropped. Losing it is fine.

**Saved as it happens** (decided 2026-10-01, [automations.md](automations.md)). Each change is saved to the history before the file itself is written; the workspace waits for the save. So a run cut off by a quit or a crash still appears in 修改紀錄, marked as interrupted, and can be undone. Before this, its changes were only in memory and were lost.
- **A shell command cut off mid-way is the exception.** Its changes are found by comparing the workspace before and after the command, so a crash while it runs leaves what it changed so far out of the history. Recovering them would need the before-snapshot saved and a way to tell its changes from the user's and other runs' after the crash; not worth it yet (review, 2026-10-01).

**Jezo's own records aren't undoable.** Writes with the writer `jezo`, like the automation history in `automations/history/`, are never recorded. The shell's before-and-after snapshot skips that folder, so a scheduler write during a shell command isn't blamed on the agent.

Skill installations and removals go through the workspace, bytes included. A file that isn't text is kept in the history as a blob named by its hash, in `history-blobs/` beside `history.json`, and dropped when no kept run refers to it; like the rest of the history, it's safe to lose. Its diff in 修改紀錄 is one line, `(binary)`. Files a shell command changes are compared as text only, so bytes it writes aren't in the history.

## Open questions

- How long "recent" is.
- Whether file-level checks are enough, or structured data needs per-field undo from the start.

## Sources

- Claude Code checkpointing: https://code.claude.com/docs/en/checkpointing
- Cursor checkpoints: https://cursor.com/docs/agent/chat/checkpoints
- Gemini CLI checkpointing: https://geminicli.com/docs/cli/checkpointing/
- OpenCode snapshots: https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/snapshot/index.ts; bugs are in issues 17397, 44511, and 49732
- Hermes checkpoints and rollback: https://hermes-agent.nousresearch.com/docs/user-guide/checkpoints-and-rollback
- Codex repo bloat: https://github.com/openai/codex/issues/29388
- Codex ghost commits removed: https://github.com/openai/codex/discussions/9618
- Aider: https://aider.chat/docs/git.html
- pi tool override: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/examples/extensions/tool-override.ts
