# Handoff: where the work stands (2026-09-29)

This is a working note, not a design doc. It holds what the agent building
Jezo was in the middle of, and the decisions waiting on Tim. Delete it once
it's empty.

## Decisions waiting on Tim

### 1. Should memory stay as markdown files?

Tim's view (2026-09-29): the files-first rule exists so Jezo's agent can edit
things the way coding agents like best, with files and bash-like tools. The
agent doesn't work on memory that way, so memory doesn't have to be files.
Deleting a memory is fine too, as long as it's no longer treated as fact.
Writing our own is OK, but it has to be swappable like any pi extension.

What's built now (`packages/pi-memory`, uncommitted, tests pass):

- Each memory is `memory/items/m-*.md`. An FTS5 trigram index in memory is
  rebuilt from the files on load.
- The files go through a `MemoryStore` interface (`load`/`write`/`remove`).
  Jezo's store writes through `Workspace`, so agent writes land in the undo
  log. Standalone pi uses `fileStore(./memory)`.
- Forget deletes the file and writes a hash of the normalized text to
  `memory/forgotten.yaml`, so the same words aren't saved again unless the
  user asks (`again: true` only works when the words came from the user).
- Sessions a deleted memory cited as evidence can't be read by the agent.
  Otherwise it would learn the deleted memory again from the old conversation.

**Recommendation: keep the files for now.** The store is already an
interface, so a SQLite store is one class away if we want it. Files still
buy us three things: undo works through the same path as everything else,
the memory page reads it like any plugin, and a person can open memory in
Typora. Nothing makes files painful for memory yet. If Tim drops rule 1 for
memory, that's a change to AGENTS.md (principle 1), so it's his call.

Tim also asked whether Hindsight and pi-hermes-memory were ruled out for
good reasons. If files-first is dropped for memory, "the data isn't in the
workspace" stops counting against them. What's left against Hindsight:
- It runs as a Python service and worker, with an embedded Postgres and
  pgvector. That's local and doesn't need Docker, but the full install pulls
  in torch and downloads models on first run.
- Every save calls an LLM.
- A single memory can't really be deleted: PATCH only marks it invalid, and
  that can be undone. DELETE removes a whole document.

That last point is the blocker, because Tim's rule is "no longer treated as
fact".

For pi-hermes-memory, re-check the Codex report before deciding. Its
consolidation now runs in-process by default.

### 2. Google Calendar OAuth client (deferred, Tim's leaning: a + b)

(a) Jezo ships its own Desktop OAuth client, with (b) "use your own client"
as a fallback. Tim asked whether publishing it leaks private info or bills his
account. The answers:

- **Is the client ID public info?** Yes. For Desktop ("installed") apps,
  Google says the client secret can't be kept secret and isn't treated as one.
  Open-source apps like rclone ship theirs. We use PKCE and a loopback
  redirect, so a copied client ID can't get anyone's tokens.
- **Privacy:** the consent screen shows the project's app name, support
  email, and developer contact. Create the project under a separate
  Google account (or a Jezo org) with a non-personal email, not
  Tim's own account.
- **Billing:** the Calendar API has no charges, only quotas. Don't attach
  a billing account to the project, and turn on only the Calendar API. The
  worst someone can do by abusing the published ID is use up the quota or get
  the project suspended. That's why (b) is worth having.
- **Verification:** `calendar.readonly` / `calendar.events` are *sensitive*
  scopes, not *restricted* ones. An unverified app shows a warning and caps
  at 100 users. Verification needs a privacy policy page and a homepage on a
  domain we own, but not the paid security assessment (that's for Gmail
  scopes).

What Tim needs to do before Google can be built: create the Google Cloud
project and the consent screen. The ICS and EventKit sources don't need it.

## Work in progress, in order

1. **Memory: finish and commit.** Everything is uncommitted: the
   `packages/pi-memory` package, `src/main/agent/{acting,memory}.ts`, host
   and tools changes, `Workspace.removeFile`, the renderer store, the
   templates in `resources/workspace{,.en}/memory`, fixture memories, and the
   tsconfig includes. Checks:
   - `node --test packages/pi-memory/src/memory.test.ts` (12 pass; Bun has
     no node:sqlite)
   - E2E: `memories are files…` (workspace.spec) passes, and `the agent
     remembers…` (agent.spec, needs LM Studio) passes.
   - Still to do: run the whole E2E suite, write `docs/design/memory.md`
     (the Codex research, the decision, and what was rejected and why), take
     pi-hermes-memory out of `concept.md`, and update the Memory section of
     `backend.md`.
2. **Codex UI polish patches.** Copied from /private/tmp (which gets wiped
   on reboot) to `.claude/polish/patches/`:
   `01-time-picker`, `02-provider-controls`, `03-page-polish`. Before/after
   screenshots are next to them. Next steps:
   - `git apply` them on this branch and review the diff yourself.
   - Run `bun run typecheck`, the screenshot script
     (`scratchpad/shots/pages.mjs`, in the old session's scratchpad; rewrite
     it if it's gone), and `npx playwright test e2e/workspace.spec.ts`.
   - Commit with `Co-Authored-By: Codex <noreply@openai.com>`.
   - Remove the worktree `.claude/worktrees/agent-af13bd0bd9a198a34`.
   - Known gap from Codex: the connection icon tiles are blank.
3. **Calendar.** ICS first, then macOS EventKit, then Google (after
   decision 2). Several sources and accounts at once, shown together, and any
   single calendar can be hidden.
4. **Slash commands.** A "/" menu in the composer for skills, prompt
   templates, and extension commands. `/model`, `/new` and similar map to
   UI actions.
5. **更多 → 自動化 list UI.** Waits for the polish patches.
6. Later:
   - memory cards in the check-in, and a memory preview
   - the rework card
   - experiments and connections, which are still mock
   - bundling uv for the packaged app

## Things that bit us (keep in mind)

- **pi must load after its env is set.** `src/main/index.ts` imports
  `./env` and then dynamically imports `./app`. A static import gets
  hoisted, and pi then reads the user's own `~/.pi`.
- **Tool schemas for LM Studio** stay plain: no `pattern`, no nullable
  unions. Check values when the tool runs instead.
- **Fake mic in E2E** needs
  `--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox`.
- **Node strip-only TS** (the memory package tests) rejects constructor
  parameter properties.
- **Codex runs:** calling the codex companion directly from Bash worked
  when the subagent path didn't. Codex's sandbox can't commit or launch
  Electron, so ask it for patches.
