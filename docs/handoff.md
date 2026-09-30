# Handoff: where the work stands (2026-09-30, night)

This is a working note, not a design doc. It holds what the agent building
Jezo was in the middle of, and the decisions waiting on Tim. Delete it once
it's empty.

## Decisions waiting on Tim

### Offline sync (designing ahead)

Tim, 2026-09-30: decide about the phone later; the desktop app comes first. No phone app soon, but likely later, working offline and merging with the desktop, peer to peer with something like iroh. Design the architecture for it now. Codex's report is in `.claude/research/2026-09-30/sync-astra.md`; its last section has eight questions for Tim (can devices sync without being online together, may user-owned storage hold encrypted data, what exactly "forget" promises, does the phone run its own agent, and more). Hazards already known:
- Times are written as local time with no zone (backend.md). That's fine on one Mac, but ambiguous once a phone in another zone writes.
- Some config is per device (EventKit sources, hidden calendars), some per user (ICS subscriptions). calendar.md marks which is which. A subscription's address is in each device's keychain, so a phone would ask for it again.

### Bash, search and the browser

Tim, 2026-09-30: turning bash off leaves the agent unable to do much (skills that wrap CLIs, the point of using pi), and it also needs search and a browser. Two Codex reports: `.claude/research/2026-09-30/bash-sol.md` and `web-sol.md`. The proposal sent to Tim the same day:
- **Bash** through pi's `BashOperations`, run by `@anthropic-ai/sandbox-runtime` (pinned, 0.0.78 today). Writes only in the workspace and a tool directory; the home directory unreadable apart from the workspace. General bash has no network. A skill that needs the network runs in its own runner with the hosts the user granted for it, since the runtime's policy is global to a process and a union of every skill's hosts would be one big exit. Grants live in app data, set in the GUI, never in a SKILL.md the agent can edit. If the sandbox can't start, the call fails; it never falls back to plain bash.
- **Undo for shell writes** has to come first. `UndoLog` only sees `Workspace.writeFile`, so a bash write can't be undone today.
- **Search and fetch** as Jezo tools, not through bash: one search provider the user picks (Tavily's free tier needs no card, Brave needs one, SearXNG for self-hosters), and fetch run locally.
- **Browser**: a visible Electron view with its own sessions, one signed out for reading and one for accounts the user connects there. The user's own Chrome later, as a separate choice.
- **Exit check**: every search query, fetched URL and text typed into a page is a possible leak. A reviewer model sees the user's messages and the proposed action (not tool results, so a page can't argue with it) and allows, blocks or asks. Run it in shadow mode with the local model first and measure.
Questions for Tim: which CLI must work first; search default (key or keyless); how far the reviewer can go without asking.

### Chat UI

Codex's report: `.claude/research/2026-09-30/chatui-sol.md`. Proposal: Streamdown (with its code, math and CJK plugins) for markdown, shadcn's Base UI `MessageScroller` for scrolling, keep pi, IPC and the composer ours. Before any of it, the session projection needs stable message ids and the active branch (`host.ts` `view()`/`toMessages()`). Edit makes a branch, retry makes another version with arrows, Enter while running queues (`followUp`) and a second action steers. Questions for Tim: single-dollar inline math (clashes with prices) or `$$`/`\(…\)` only.

### Connectors

`docs/design/connectors.md`. Tim, 2026-09-30:
- ICS and EventKit first.
- Google still has to be built, because many people won't add Google to the Mac's calendar, and Gmail needs it anyway.
- For Google, do b (bring your own client) before a (Jezo's verified client): review is a hassle, and b falls under the personal-use exception, which covers Gmail too.
- Use pi's MCP for connectors the agent uses.

Google through EventKit won't be tested separately (Tim, 2026-09-30: every account on the Mac is read the same way).

## Work in progress, in order

1. **Skills: adding and installing** is done (docs/design/skills.md), built by Codex from a spec and reviewed. Left over:
   - 「這個方法附了程式。Jezo 的 agent 目前不能執行程式」 has to change when bash lands.
   - Undoing an install leaves binary files behind (undo only keeps text).
2. **Sync design doc.** Write `docs/design/sync.md` from `.claude/research/2026-09-30/sync-astra.md`:
   - the recommendation: one replication document per item, Automerge 3 as the first candidate, iroh as transport;
   - the cheap changes to make now: stronger ids, a committed-change feed, undo through the write service, a workspace id and format version, and one device that runs automations;
   - eight questions only Tim can answer (see the report's last section). Ask him.
3. **Stress model.** Tim, 2026-09-30: test with `google/gemma-4-e4b`, about the least capable model a computer user runs in 2026. No outside observability tools: read traces with `bun scripts/trace.ts` and fix what they show.
4. **Prompt: act, don't ask.** In the calendar planning test the model once asked "18:15 or after 21:00?" instead of scheduling. todos_update already marks the time as a proposal the user can drag, so the system prompt should say to pick one and let the user move it. Also check once, by logging, that pi doesn't fire `before_agent_start` again on a `continue: true` from `agent_before_settle`; the memory extension resets its held-back list there.
5. **Slash commands.** A "/" menu in the composer for skills, prompt templates and extension commands. `/model`, `/new` and similar become UI actions.
6. **更多 → 自動化 list UI.**
7. Later:
   - memory cards in the check-in, and a memory preview
   - the rework card
   - experiments and the non-calendar connections, which are still mock
   - bundling uv for the packaged app
   - the connection icon tiles are blank (noted by Codex in the polish pass)
   - trying the packaged app's EventKit permission

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
