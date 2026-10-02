# Handoff: where the work stands (2026-10-02)

This is a working note, not a design doc. It holds what the agent building
Jezo was in the middle of, and the decisions waiting on Tim. Delete it once
it's empty.

## Decisions waiting on Tim

### Offline sync (designing ahead)

Tim, 2026-09-30: decide about the phone later; the desktop app comes first. No phone app soon, but likely later, working offline and merging with the desktop, peer to peer with something like iroh. Design the architecture for it now. Codex's report is in `.claude/research/2026-09-30/sync-astra.md`; its last section has eight questions for Tim (can devices sync without being online together, may user-owned storage hold encrypted data, what exactly "forget" promises, does the phone run its own agent, and more). Hazards already known:
- Which device's zone is the user's, with several devices (sync.md, time.md).
- Some config is per device (EventKit sources, hidden calendars), some per user (ICS subscriptions). calendar.md marks which is which. A subscription's address is in each device's keychain, so a phone would ask for it again.

### Decided on 2026-09-30 (kept here until the work lands)

- **Trust model rewritten** (AGENTS.md): outside content is data, marked and checked on the way in; defend against leaks and irreversible harm, not against the owner. "Guard the exits, not the inputs" is gone: it read as "lock everything down".
- **Bash is on**, in the OS sandbox with the network open (backend.md, "Tools"). Done.
- **Outside content** is screened once on the way in (backend.md, "Outside content"). Done for the calendar and MCP tool results; red-team E2E in `e2e/outside.spec.ts`. More payloads could come from AgentDojo, promptfoo's red-team plugins or Spikee.
- **Extensions, not built-ins.** Search, the browser and similar are plugins the user installs (skills, MCP servers, pi packages) through one install entry, built on pi's package manager and MCP. Jezo recommends, the user picks. Built and merged (docs/design/extensions.md). The research: `.claude/research/2026-09-30/pipkg-sol.md`.
- **Chat UI on assistant-ui** with its pi adapter over IPC, and Streamdown. Built and merged (frontend.md, "Chat").
- **這輪沒有改動 under a run that changed nothing, with 請它動手** (frontend.md, "Chat"). Done.
- **No checks that read the reply's words, and no extra model calls per run** to rescue weak models.

### Time zones and missed automations (decided and built 2026-10-01)

[time.md](design/time.md) and [automations.md](design/automations.md). The research and reviews are in `.claude/research/2026-10-01/`.

- **Every todo time and record carries its zone** (Tim, 2026-10-01): there's no time without a zone, and no 跟著我走. The display is always right after travel. Moving a plan after travel is a proposal the user accepts.
- **No migration mechanisms for now** (Tim, 2026-10-01): Jezo isn't released.
- **One default Tim can still flip:** the weekly review catches up for 24 hours; the other choice is "until next time".

Health connectors: none for now (Tim, 2026-10-01). Apple Health waits for the phone app. Google's Health API is closed to new projects.

### Connectors

`docs/design/connectors.md`. Tim, 2026-09-30:
- ICS and EventKit first.
- Google still has to be built, because many people won't add Google to the Mac's calendar, and Gmail needs it anyway.
- For Google, do b (bring your own client) before a (Jezo's verified client): review is a hassle, and b falls under the personal-use exception, which covers Gmail too.
- Use pi's MCP for connectors the agent uses.

Google through EventKit won't be tested separately (Tim, 2026-09-30: every account on the Mac is read the same way).

### GitHub #1, #3, #4 (built 2026-10-01)

Research, reviews and measurements are in `.claude/research/2026-10-01/issues/`. Decisions are in frontend.md ("Chat", "The todo list") and backend.md ("Speech"). Waiting on Tim:

Left over:
- std-mlx-audio's own tests: four in `test_batch.py` fail on macOS before and after `474277b`, comparing `/var/...` with `/private/var/...`.

### Release (2026-10-02)

Tim asked for a code review loop with Codex until nothing worth fixing was left, a squashed history, CI, a README with pictures in English and Simplified Chinese, and Simplified Chinese in the app, ahead of merging and the first release.
- Four review rounds ran (round 1 in six parts by area, then each round on the previous round's fixes); round 4 found nothing. Each finding was checked against the code and the docs before anything changed; the ones judged deliberate are written into the design docs.
- CI is `.github/workflows/ci.yml` (typecheck, unit tests, build, E2E without `@speech`; the model tests skip without a local model). `release.yml` builds an unsigned dmg and zip on a `v*` tag into a draft release.
- The README's pictures come from `node scripts/screenshots.ts` after a build.
- Waiting on Tim: pushing the squashed branch, merging to main, and tagging v0.1.0.
- Not done: speech on Windows (backend.md, "Speech"); signing and notarizing the app.

## Work in progress, in order

1. **Time zones and missed automations: left over.**
   - Try in the packaged app: start at login (`wasOpenedAtLogin` may be false on macOS 13+, which only means the window opens), EventKit against real calendars.
   - The code reviews of 2026-10-01 and what was done about them are in `.claude/research/2026-10-01/review/` (each part with its verification; `decisions-astra*.md` is the review of design decisions, `long-term-designs-sol.md` the research behind the fixes). A repeat that lands in a skipped hour is kept and counted, at the offset from before the change, as erratum 4271 to RFC 5545 says and as ical.js already does (calendar.md); an earlier note here had it as a bug.
   - The voice E2E failed once while another Jezo ran in development with its own speech server; on 2026-10-02 it passed with one running.
2. **Left over from merged work:**
   - The install entry isn't verified in the packaged app, with a native addon, or with a live OAuth sign-in (extensions.md). The pi directory (packages, MCP config) isn't in the workspace backup.
3. **Sync:** designed (docs/design/sync.md); its eight questions are for Tim. The cheap changes are done; the rest waits for sync itself, with reasons in the doc.
4. **Test model.** `qwen3.6-35b-a3b-splash` (Tim, 2026-09-30, replacing gemma-4-e4b). Read traces with `bun scripts/trace.ts` and fix the input first (AGENTS.md, "How we work"). It sometimes repeats a line in its thinking until it runs out of tokens (3 of ~20 runs); the chat now says so and offers a retry. The agent tests pass most runs; single failures are usually that loop.
5. Later:
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
- **Don't `git stash` in this tree.** Another session may have uncommitted work in it (on 2026-10-01 one was doing the app icon); commit only your own files, and stage your hunks of a shared file with `git apply --cached`.
- **Test requests that name a plugin's folder** ("在 notes 資料夾") get that plugin's conventions from a model (items/, frontmatter). The bash test writes to scratch/ now.
- **Model tests that flake on qwen3.6** as of 2026-10-02:
  - "一小時後" read as "within an hour";
  - a revised plan proposed without `revise`, so the old card doesn't say 拿掉了;
  - times described in the reply without calling the tool;
  - an experiment's conclusion or decision written by the agent;
  - "一小時後我要打給媽" answered with ask_user when that hour has a todo, instead of a time to move;
  - a tool call with keys and values run together (`"date2026-10-07": 2026`), repeated until it runs out of tokens;
  - a deadline the user said left out of the todo (4 of 6 set it; frontend.md, "Deadlines"), or a question asked first ("拆成 3 段還是一次寫完") instead of a plan;
  - "我今天有哪些待辦？先查再回答" answered from the digest without calling a tool;
  - three backlog errands merged into one new todo in the morning plan instead of scheduling the three;
  - field names with " /" appended (`"date /"`), sent again and again.
  - "每週一早上九點" written as a Sunday cron. The automations' instructions give a Monday example and say 0 is Sunday, and since 2026-10-02 the write's result reads the schedule back as dates with weekdays. It still happened in 2 of 6 runs on 2026-10-02: the model's first thought turned 週一 into 周日 before it read anything, once explaining that "it's Sunday evening now" with Friday in its time note, and it went on past the read-back that said Sun. Not caused by what it's given; a check would have to read the user's words.

  Each passes on a rerun. Read the trace before changing anything for them.
- **Bun has no Temporal.** Scripts and unit tests load `scripts/temporal.ts` (bunfig.toml preloads it for `bun test`); Electron and Node have it natively.
- **E2E evaluate in the main process** can't use dynamic `import()`; use
  `process.getBuiltinModule('node:fs')` and the electron modules passed in.
