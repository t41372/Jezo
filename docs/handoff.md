# Handoff: where the work stands (2026-09-30, evening)

This is a working note, not a design doc. It holds what the agent building
Jezo was in the middle of, and the decisions waiting on Tim. Delete it once
it's empty.

## Decisions waiting on Tim

### Offline sync (designing ahead)

Tim, 2026-09-30: decide about the phone later; the desktop app comes first. No phone app soon, but likely later, working offline and merging with the desktop, peer to peer with something like iroh. Design the architecture for it now. Codex's report is in `.claude/research/2026-09-30/sync-astra.md`; its last section has eight questions for Tim (can devices sync without being online together, may user-owned storage hold encrypted data, what exactly "forget" promises, does the phone run its own agent, and more). Hazards already known:
- Times are written as local time with no zone (backend.md). That's fine on one Mac, but ambiguous once a phone in another zone writes.
- Some config is per device (EventKit sources, hidden calendars), some per user (ICS subscriptions). calendar.md marks which is which. A subscription's address is in each device's keychain, so a phone would ask for it again.

### Decided on 2026-09-30 (kept here until the work lands)

- **Trust model rewritten** (AGENTS.md): outside content is data, marked and checked on the way in; defend against leaks and irreversible harm, not against the owner. "Guard the exits, not the inputs" is gone: it read as "lock everything down".
- **Bash is on**, in the OS sandbox with the network open (backend.md, "Tools"). Done.
- **Outside content** is screened once on the way in (backend.md, "Outside content"). Done for the calendar and MCP tool results; red-team E2E in `e2e/outside.spec.ts`. More payloads could come from AgentDojo, promptfoo's red-team plugins or Spikee.
- **Extensions, not built-ins.** Search, the browser and similar are plugins the user installs (skills, MCP servers, pi packages) through one install entry, built on pi's package manager and MCP. Jezo recommends, the user picks. Built and merged (docs/design/extensions.md). The research: `.claude/research/2026-09-30/pipkg-sol.md`.
- **Chat UI on assistant-ui** with its pi adapter over IPC, and Streamdown. Built and merged (frontend.md, "Chat").
- **這輪沒有改動 under a run that changed nothing, with 請它動手** (frontend.md, "Chat"). Done.
- **No checks that read the reply's words, and no extra model calls per run** to rescue weak models.

### Connectors

`docs/design/connectors.md`. Tim, 2026-09-30:
- ICS and EventKit first.
- Google still has to be built, because many people won't add Google to the Mac's calendar, and Gmail needs it anyway.
- For Google, do b (bring your own client) before a (Jezo's verified client): review is a hassle, and b falls under the personal-use exception, which covers Gmail too.
- Use pi's MCP for connectors the agent uses.

Google through EventKit won't be tested separately (Tim, 2026-09-30: every account on the Mac is read the same way).

## Work in progress, in order

1. **Left over from merged work:**
   - The install entry isn't verified in the packaged app, with a native addon, or with a live OAuth sign-in (extensions.md). The pi directory (packages, MCP config) isn't in the workspace backup.
2. **Sync:** designed (docs/design/sync.md); its eight questions are for Tim. The cheap changes are done; the rest waits for sync itself, with reasons in the doc.
3. **Test model.** `qwen3.6-35b-a3b-splash` (Tim, 2026-09-30, replacing gemma-4-e4b). Read traces with `bun scripts/trace.ts` and fix the input first (AGENTS.md, "How we work"). It sometimes repeats a line in its thinking until it runs out of tokens (3 of ~20 runs); the chat now says so and offers a retry. The agent tests pass most runs; single failures are usually that loop.
4. Later:
   - an experiment's arm isn't checked against the morning plan in a test (the digest line is there, the effect isn't measured)
   - bundling uv for the packaged app
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
- **The agent tests' model** is pinned: `e2e/jezo.ts` writes it into each test's own config.json (`JEZO_TEST_MODEL`, default `qwen3.6-35b-a3b-splash`; Tim, 2026-09-30: gemma-4-e4b is too weak, stop optimizing for it, since what helps it may cost a stronger model latency and money), and `e2e/setup.ts` loads it with `lms`. Unpinned, Jezo used whatever LM Studio had loaded, so the developer's own model choice leaked into the tests, and each side's just-in-time loads could unload the other's model.
- **Codex runs:** calling the codex companion directly from Bash worked
  when the subagent path didn't. Codex's sandbox can't commit or launch
  Electron, so its work arrives untested in the real app: both branches
  on 2026-09-30 had bugs only the E2E run showed (cards not registered as
  assistant-ui data parts; `require.resolve` of pi's ESM-only package
  crashing the main process).
- **The clipboard is Tim's.** A test that copies must put back what was there (chat.spec.ts); one failed when Tim copied something mid-run, and every run overwrote his clipboard.
- **E2E evaluate in the main process** can't use dynamic `import()`; use
  `process.getBuiltinModule('node:fs')` and the electron modules passed in.
