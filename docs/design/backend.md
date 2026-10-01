# Backend

Status: decided on 2026-09-29, after the prototype ended. How the main process holds the workspace, runs Jezo's agent, and talks to the windows. The file formats are in [storage.md](storage.md) and undo in [undo.md](undo.md); this doc is how they're built.

## Processes

Everything runs in Electron's main process, apart from speech recognition, which is a Python sidecar (below). The windows only draw: they get the workspace's entities over IPC and ask the main process to change them. Context isolation stays on and the renderer has no Node access (see [frontend.md](frontend.md)).

The main process is ESM. pi's packages only export ESM (`require()` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED`), so `package.json` has `"type": "module"`. The preload script stays CommonJS and is built as `index.cjs`, because a sandboxed renderer can't load an ESM preload. Dependencies aren't bundled into the main process (electron-vite's default), which pi needs: it finds its own `package.json` by walking up from its files.

## The workspace

A directory the user picks, `~/Jezo` by default. It isn't under `~/Documents`, which macOS may sync to iCloud ([storage.md](storage.md), "Synced folders"). Where it is, the model choice, and other per-machine settings live in the app's data directory, not in the workspace.

```
<workspace>/
  AGENTS.md              what the workspace is and how it's laid out, for Jezo's agent
  skills/<name>/SKILL.md methods that aren't one plugin's
  todos/   goals/   notes/   memory/
    AGENTS.md            what the directory is for
    manifest.yaml        the schema of its items
    skills/<name>/SKILL.md
    items/<id>.md        one file per entity
    attachments/<id>/    files the user added to an item's notes
  sessions/<id>.jsonl    conversations, as pi writes them
```

**Skills** are the methods concept.md lists as built in (plan in "when X, do Y", estimate from records, track progress, rework a bad day, anchor habits, small experiments), plus each plugin's own, like 隨手記's sort-notes. Their directory names follow the Agent Skills naming rule (lowercase ASCII, which pi checks); the title the user sees is `metadata.title`. Turning a skill off in 它用的方法 sets pi's own `disable-model-invocation: true` in its SKILL.md, so pi leaves it out of the agent's prompt and no list of switched-off skills lives anywhere else.

Adding, updating and removing skills, their provenance, and the source checks are described in [skills.md](skills.md).

Each built-in plugin that stores data owns a directory like the ones above. The files Jezo ships (AGENTS.md, manifest, skills) are copied in when the workspace is created. They're the user's from then on, and the agent may edit them (AGENTS.md, principle 6). What happens to them when a new version of Jezo changes its copy isn't decided yet.

### Reading

On start, the main process reads every item file into memory, parsed and checked against its manifest. Measured on this Mac, 10,000 todo files take about half a second ([storage.md](storage.md)), so an in-memory index is enough for now; SQLite (Electron's built-in `node:sqlite`, which has FTS5) comes in when full-text search over memory and sessions does. `better-sqlite3` isn't needed: `node:sqlite` in Electron 44 (Node 24.21) runs FTS5, tested on 2026-09-29, and it needs no native rebuild.

A watcher on the workspace (`fs.watch`, recursive) tells the index when a file changes. Its events are hints: a file is re-read and compared by hash, and a full scan runs when the window regains focus, because file events can be dropped.

### Writing

Every write the GUI makes goes through one write service, and so do the agent's file tools (below). A write:

1. reads the file and checks its hash against the one the caller last saw; if the file changed since, the write fails and the caller reloads;
2. changes only what it was asked to: frontmatter fields are replaced one top-level key at a time, and every other line stays byte for byte;
3. writes a temporary file and renames it over the old one.

**Why key by key.** The `yaml` package's Document API keeps comments but, measured on 2026-09-29, it still rewrites lines nobody touched: `[a, b,   c]` became `[ a, b, c ]`, `0x1F` became `0x1f`, and spacing before comments collapsed. So a write parses the frontmatter to find where each top-level key starts and ends, and replaces only the changed keys' text. A changed nested value (a todo's `steps`) replaces its whole top-level key. A file whose frontmatter doesn't parse is never written; the check reports it instead.

**Files with problems** (not matching their manifest, frontmatter that doesn't parse, an id changed by hand) are still read and shown where they belong. 更多 gets a row, 有問題的檔案, only while there are some. Each lists what's wrong, folded, in the words the agent gets, and 請 Jezo 修 puts a request to fix it in the chat's box. The agent also sees them in the digest.

### Changes reach the windows

After a write, or when the watcher sees an outside change, the main process sends the changed entities to every window. The windows apply the user's own changes at once and then take whatever the main process sends back, so dragging a todo doesn't wait on the disk.

## Entities on disk

The formats follow [storage.md](storage.md): markdown with frontmatter, one file per entity, an immutable `id`. Field names are single English words where possible, since the agent reads and writes them. Times are local, with no time zone, written the way a person would: `2026-09-29T09:30`.

**A todo** (`todos/items/<id>.md`):

```markdown
---
id: t-01J8Z4
title: 寫第五段
state: open            # draft | open | done
goal: g-01J8Z1         # optional
cue: 到公司倒完咖啡       # optional: the situation it's done in
estimate: 70           # minutes
scheduled: 2026-09-29T09:30   # optional; no time means it's in the backlog
proposed: true         # optional: the time is the agent's suggestion, not yet accepted
rank: a0V              # position in the backlog
steps:                 # optional
  - text: 找上次的草稿
    done: true
why: 你早上最有精神，而且這段要專心。   # optional, the agent's reasoning
started: 2026-09-29T09:31     # while the user is working on it
---
Anything else about it, in prose.
```

- **The backlog order is a rank** (a fractional index, like `a0V`). Moving one todo rewrites only that todo's file. Ordering by position in a shared list file would make every move a write to one file that the agent and the GUI both change.
- **Draft is a state,** as the prototype decided ([frontend.md](frontend.md)): a draft doesn't count until the user accepts it.

**A note** (`notes/items/<id>.md`) is as [notes.md](notes.md) describes, plus where the agent's proposal waits while the user decides: `proposal: { as: todo, title: … }`, or `{ as: ask, question: … }`. The proposal stays on the note after the user decides, so taking a decision back shows it again. Keeping it on the note rather than in the conversation means the 隨手記 page and the chat card read the same file.

### Links

Items link to each other the way any markdown does, so the workspace opens in Typora, VS Code, Obsidian or on GitHub with its links working:

- **In a body,** a standard markdown link to the other item's file, relative to this one: `[寫第五段](../../todos/items/t-01j8z4.md)`. File names are ids and directories don't move, so relative links stay good.
- **In frontmatter,** a plain id is a link: `goal: g-01j8z1`, `blocked_by: [t-01j8z4]`, a note's `became.ref`. Frontmatter links aren't clickable in most editors anyway, and an id is harder to get wrong than a path.
- **The app works links out, deterministically,** each time an item is read: every body link that resolves to an item file, and every frontmatter value that is another item's id. Each item carries the items it links to; what links to an item is worked out from those. The agent gets both with `item_links`, and a todo's panel lists them under 相關, each opening the other item.
- **Rejected: Obsidian's `[[wikilinks]]`.** They'd be resolved by file name, which works, but only Obsidian and a few editors understand them; everywhere else they're plain text. Also rejected: writing the link index into the workspace as a file, which would change with every edit, and could fall out of date against the files it's derived from.

## Jezo's agent

Jezo's agent is pi (`@earendil-works/pi-coding-agent`), run in the main process through pi's SDK. A spike on 2026-09-29 ran it inside Electron with a local model through LM Studio: skills and the digest reached the prompt, the session-start and turn-end hooks fired, the agent's edits went through our file functions, and the session was saved and reopened.

### Isolation from the user's own pi

The user may use pi on their own. Jezo's agent must not read their settings, keys, skills or `AGENTS.md`, and must not make network requests the user didn't ask for ([frontend.md](frontend.md), fonts). So Jezo:

- sets `PI_CODING_AGENT_DIR` to a directory in the app's data before loading pi, because some of pi's paths come from it however it's called. The main process's entry (`index.ts`) sets the environment and then loads the rest with a dynamic `import()`. A static import wouldn't do: the bundle runs every import of an outside package before any of its own code, so pi loaded with the user's `~/.pi/agent` as its directory until this was caught on 2026-09-29. Nothing had read the user's keys or models (Jezo's are held in memory and `models.json` is off), and nothing under `~/.pi/agent` had been written;
- sets `PI_OFFLINE=1`, so pi doesn't refresh its model catalog or download `rg` and `fd` from GitHub, and `PI_TELEMETRY=0`;
- persists settings in Jezo's pi directory, with project trust off, so the workspace's `.pi/` and the `AGENTS.md` files above it aren't loaded;
- loads no extensions, skills, prompt templates or context files from the default places, and passes explicit workspace skills, installed package paths and inline extensions with Jezo's hooks and pi's MCP support ([extensions.md](extensions.md));
- replaces pi's system prompt with Jezo's own.

### Sessions

Each session is a pi session saved as JSONL in `<workspace>/sessions/`. Conversations are the user's, so they're in the workspace, not the app's data. The index lists them; the watcher and the undo record skip that directory, because only pi appends to it.

- **A session starts** with Jezo's system prompt, the workspace's AGENTS.md, and the digest in pi's appended system prompt. The AGENTS.md is the workspace's map, as a project's is for a coding agent, and only that one: pi would also load every AGENTS.md in the folders above, and a workspace may sit inside someone's repository. Until 2026-09-30 the digest only said the file existed, and a model asked for an automation never learned that `automations/` was there. The digest has today's date, the next fourteen days with their weekdays, today's todos, active goals, the last check-in and a map of the workspace. The memory and calendar extensions add their own sections at the start of each run. Each message from the user is followed by a hidden one with the time (`jezo.time`), and with the next fourteen days again once the date has moved on. The digest's time is from when the session started, so a conversation picked up at 11:46 was planned from 11:10 (Tim, 2026-09-30); the E2E test "a conversation picked up two hours later" moves the main process's clock and failed that way before the fix (the call went at start time plus an hour). It's a message rather than a prompt section so a local server doesn't have to read the whole conversation again for a new minute. A request Jezo sends on its own (an automation, sorting notes, finding times) has no user message, so the time goes at the top of the request instead: on 2026-09-30, asked to find times "in the next seven days" with the date only in the system prompt, qwen3.6-35b looked at the calendar from 2026-01-01, three runs of three. pi puts it after the user's message, which left the clock as the model's last input; the `context` hook moves it in front for the model (the session file keeps pi's order). With it after, a local model answered "已更新" to a changed guitar lesson and called nothing in two runs of three; in front, three of three saved it.
- **What started it** (the morning, the evening, ⌥X, the user, 隨手記) is saved in the session as a custom entry, so the chat list can show it.
- **The chat transport** is react-pi's browser-safe `PiClient` over the preload IPC bridge. AgentHost remains the session factory and run owner. Token updates carry the live message, at most every 50 ms; completed display messages are cached until the branch leaf changes. Entry deltas keep the renderer's tree current, and snapshots recover reading, navigation and completion. The renderer extends the adapter with pi entry identity, card parts and an assistant-ui branch repository ([frontend.md](frontend.md), "Chat").
- **Versions** are paths in the same pi JSONL. Edit and retry use `navigateTree` without an abandoned-path summary, then start a new run. A `jezo.retry` custom entry links repeated input to its original displayed turn; `jezo.branch` saves a selected leaf by appending on that path. Switching versions does not change the workspace or call undo.
- **Pending input** uses pi's native `followUp` and `steer` queues. It stays outside the saved transcript until delivered. One uninterrupted run, including native queued continuation, keeps one acting/undo context until `waitForIdle`; a fresh edit or retry gets another run ID. Stop clears pending input before aborting.
- **After a crash,** the session file has everything up to the last finished message. Opening it again restores the conversation, and the agent continues from there. That makes a half-done turn recoverable, but it isn't a transaction: related files can disagree after a crash, and it can't tell whether an outside action (an email sent) happened. Each file is written atomically; changes that must agree across files need their own recovery when one comes up.

### Tools

- **Files:** `read`, `ls`, `write` and `edit`. `write` and `edit` are pi's own tools with Jezo's file functions plugged in, so every agent write goes through the write service and is recorded for undo.
- **`todos_list`** shows every todo in one compact table. Without it, a local model read each todo file one at a time; a morning plan took four minutes, most of it reading.
- **`install_from_address`** installs a method, pi package or MCP server when the user asks in chat or ⌥X. It accepts GitHub/archive addresses, local folder/archive paths, `npm:name[@version]`, MCP URLs, commands and MCP JSON. Multiple methods are listed for a second call with `path`; unattended runs cannot install lasting behavior. Methods and their provenance go through workspace undo; package declarations and MCP provenance live in Jezo's pi settings and mcp.json. Resources take effect in the next conversation ([skills.md](skills.md), [extensions.md](extensions.md)). It was called `skill_install` until 2026-09-30, when gemma-4-e4b kept calling it to *use* a skill it already had, passing the skill's own SKILL.md; with "skill" out of the name, and an error that names the SKILL.md to read, that stopped. The error comes when the source names an installed skill and isn't a web address or `npm:`.
- **Package and MCP tools** come from pi's resource loader and MCP extension. Jezo uses `defaultTools` for its initial tools, leaving dynamically registered tools available. pi's `tool_search` and `codemode` handle larger tool lists. Extension confirm/select/input calls use conversation cards, and notifications use toasts ([extensions.md](extensions.md)).
- **`calendar_events`** lists the user's calendar events for any range ([calendar.md](calendar.md)). Scheduling a todo with `todos_propose` or `todos_update` reports any timed event the slot overlaps.
- **Made for the smallest models.** These were found by running the E2E tests with gemma-4-e4b, about the least capable model a computer user runs locally in 2026, and reading the traces:
  - `todos_propose` refuses a todo whose title is already an open todo and says to use `todos_update` with its id. Asked to schedule a backlog todo, the model had proposed a copy of it.
  - A time the user's message names (20:00, 8:30) counts as theirs even when the model leaves out `userAskedForThisTime`.
  - The plan's name in `todos_propose` is optional; the first todo names it.
- **Revising a plan, by id.** `todos_propose` with `revise` takes the whole new list, each kept draft with its `id`; a draft left out is deleted. Read on 2026-09-30 with qwen3.6-35b: told to drop 繳電費, the model first planned to leave it out, then kept it with an empty `scheduled`, because the only rule it had read about taking a todo off was `todos_update`'s "empty string puts it back in the backlog", and the removal rule sat at the end of a long sentence. It also passed each draft's `id`, which the tool ignored and matched by title instead. Now each todo takes an `id`, and the description and every result say in their own sentence that a draft left out is deleted. The other failures in that test were the model repeating one line in its thinking until the answer ran out of tokens. With `id` added, the same model invented ids for new todos (`t-x1`), which are ignored, and gave `revise` every draft's id in one string, which was refused: `revise` now asks for one id, and a list is read for any id in it. Its drafts with a goal were also dropped from a revision, because they were compared as objects, and an item with links is a new object each time it's read; they're compared by id now.
  - `notes_propose` reads the kind leniently ("Todo", "Goal Idea") and takes a note's path as well as its id. When it can't, the error lists the kinds or the waiting notes' ids.
  - Sorting notes lists the waiting notes in the request. Told only how many there were, the model asked the user for them.
- **Garbled field names are reported, not refused.** A local model sometimes sends a key like `"estimate /"`. `todos_update` and `todos_propose` apply the fields they know and say in the result which ones they ignored and what the fields are called. Refusing the whole call made the same model send the same garbled name 149 times.
- **Paths relative to the workspace.** The system prompt asks for them. A local model copying the E2E tests' long temporary path dropped a digit, found nothing, and went looking through `/` and the home folder (2026-09-30).
- **Typed tools** for what the GUI shows as a card: proposing todos (a plan), proposing what notes become, and saving to memory. The result names the entities, and the chat draws the card from it. Typed tools make structured writes easier for any model, but the agent can still edit the files directly; the checks catch mistakes either way (AGENTS.md, principle 8).
- **`bash` is on, in the OS sandbox** (`src/main/agent/shell.ts`, 2026-09-30). It was off until then, as the exit a steered agent would use; Tim: without it the agent can hardly do anything, skills that wrap a CLI can't run, and there's little point building on pi. The trust model was rewritten the same day (the old "guard the exits, not the inputs" read as "lock everything down"). The shell guards against damage that can't be undone, not against the owner:
  - `@anthropic-ai/sandbox-runtime` (the sandbox Claude Code uses) wraps each command. It can write in the workspace, temporary folders, tool caches (`~/.cache`, `~/Library/Caches`, `~/.npm`, `~/.local` and the like) and folders the user named **by path** in the conversation, as Claude Code lets a user name a directory. Anywhere else it can read but not write, so a wrong `rm` can't take the user's files.
  - Paths, not words, so it works in any language: to write somewhere else the agent asks with `ask_user`, putting the folder's path in an option; picking it puts the path in the user's words. A refused write tells the agent this.
  - It can't read credentials (`~/.ssh`, cloud keys, the keychain, the user's own `~/.pi`) or the conversations closed after the user deleted a memory.
  - The network is open. Outside content is marked and checked where it comes in (AGENTS.md, trust model).
  - What a command changes in the workspace is recorded for undo like the agent's other writes: text files are compared before and after each command (`Workspace.changedOutside`). A file written through the workspace while the command runs, by the user in the GUI say, isn't counted as the command's, or undoing the agent would undo the user. Binary files aren't kept, as elsewhere.
  - If the sandbox can't be set up, the command fails; it never runs without it. The sandbox points `TMPDIR` at `CLAUDE_CODE_TMPDIR` and doesn't create it, so Jezo sets and creates its own.
  - Rejected: sandbox-runtime's network allowlist per skill (every skill's hosts end up in one list, and each new host is a question for the user), a reviewer model on every command, and the pi packages that do this (pi-sandbox fails open, pi-permission-modes asks to run unsandboxed; see `.claude/research/2026-09-30/pipkg-sol.md`).
  - `src/main/agent/shell.test.ts` runs real commands in the real sandbox.
- **`grep` and `find`** call `rg` and `fd`, which a packaged app can't count on finding. They're off until Jezo ships the binaries or plugs in its own search.

### Checks and the undo record

- **An item file is checked when the agent writes it.** If it wouldn't match its manifest, the write is refused and the tool result tells the agent what's wrong, so it fixes its own mistake in the next step; the history notes how many writes were refused. Checking at the write rather than after the turn means a broken file never reaches the disk or the GUI. pi's `agent_before_settle` hook holds the checks that need the whole run.
- **Every file the agent writes is recorded** in the undo record in the app's data, with its content from before and what the agent wrote ([undo.md](undo.md)). An idle send, automation, edit or retry starts one entry in 修改紀錄; native queued continuation stays in that entry until pi settles. The entry's summary is the first sentence of the agent's last reply.
- **The checks read what the tools did, never the reply's words.** From 2026-09-29 to 2026-09-30 a reply that said something was done (排好, 加進, scheduled…) while no file changed was sent back to the agent. It caught a local model claiming a change it never made, but a word list only covers the languages and phrasings it lists: it missed Simplified Chinese ("记在长期记忆裡") and "存好了", and would miss every other language. A separate model call to judge the reply works in any language but doubles the latency and, with a paid API, the cost of every run that changes nothing. Tim, 2026-09-30: neither scales. So it's gone. What's done shows in the chat anyway: the step summary ("改了 1 個") and the cards come from the tool results, not from the reply. The system prompt tells the agent to describe a change only after the tool's result shows it, and E2E traces catch models that still don't. The user sees 這輪沒有改動 under a run that changed nothing, and can send the agent back with one tap ([frontend.md](frontend.md), "Chat").
- **Undo restores a file only if it still holds what the agent wrote.** Files changed since, by the user or by anything else, are left alone, and the toast says how many.


**Sending a run back doesn't start it again.** A `continue: true` from `agent_before_settle` goes to pi's `agent.continue()`, which doesn't fire `before_agent_start` (read in pi 0.99.1's `agent-session.js`, 2026-09-30). So what extensions set up at the start of a run, like memory's held-back saves, lasts through the checks.

**A failed call that was never fixed goes back to the agent.** If a run changed nothing and some tool's last call failed, the agent is told before the run ends that nothing happened and why. It then fixes the call or tells the user plainly. This doesn't depend on the reply's wording: a small model said "已為您提出計畫" after two failed calls.

**Reading a trace.** `bun scripts/trace.ts <session.jsonl | workspace>` prints a conversation as a timeline:
- the prompt sections as they changed (`--sections memory,calendar` to pick);
- each tool call with its result;
- the hidden checks;
- the replies.
pi's session file already keeps all of this, so no tracing service is needed.
### What the prompt must say plainly

Found on 2026-09-30 by reading everything the model was given when it said it had done something it hadn't (Tim: when the agent keeps making a mistake, look at its input first):
- **"Propose" meant writing it in the reply.** The prompt said "You plan, propose, and follow up" and "You propose; the user decides", and the model listed a plan as a table and asked "沒問題我就轉成待辦". It now says that drafts are how the user decides, to make them right away without asking, and that a plan only in the reply can't be accepted.
- **Nothing said that words change nothing.** The model's own thinking read "Action: replace the old memory", then it answered "已更新". The prompt now opens its rules with: only tool calls change anything; call the tool in this turn, then say what its result shows.

### Outside content

Text other people wrote (calendar invites, and whatever the user's MCP servers bring in: email, web pages) is data, not instructions (AGENTS.md, trust model). Decided 2026-09-30, from Tim's proposal to defend where connectors come in rather than cut what the agent can do; what personal assistants do (Google's Gemini in Workspace, Microsoft's Spotlighting and Prompt Shields, Claude for Chrome, Perplexity's BrowseSafe) is the same: mark it, check it on the way in, and ask before the few actions that send things out.

- **Marked.** It reaches the agent inside `<outside source="…">` tags, and the system prompt says text in them is information for the user, never instructions.
- **Checked once, on the way in** (`src/main/agent/outside.ts`). The background model is asked whether the text reads like instructions to an AI (to ignore its instructions, run commands, send or fetch things). One question per distinct text: answers are kept by the text's hash in `outside.json` in the app's data (a cache, safe to lose), so a calendar read on every run costs nothing after the first time.
  - The calendar screens each event on its own (title, location, and notes when asked), so one bad invite doesn't hide the day; the time stays, since it's the calendar's own. Clash notes screen the titles they name.
  - Results of MCP tools (`mcp__*`) are screened whole through pi's `tool_result` hook.
- **Held back, and shown.** A text that reads like instructions is replaced, for the agent, by a note saying it was held back. The chat shows a quiet card: how many pieces were held, where each came from, and the text itself folded away.
- **A check that fails lets the text through, marked.** No model, a timeout or an unclear answer isn't a reason to hide someone's calendar; the mark and the prompt still apply.
- **What it doesn't do.** Detectors miss some attacks, and adaptive attacks get past most of them, so this is one layer (AGENTS.md: no layer is the whole defense). Actions that send the user's data out get their own check, in the tools that do them (sending mail, inviting, sharing), when those exist.
- **Tested** by `e2e/outside.spec.ts`: a real feed with ordinary events and three injections in the styles red-team suites use, a collector server where the attacker's would be, and the local model. Nothing may reach the collector, the injections may appear nowhere the agent reads, and the ordinary events must.

### Tool schemas

Tool parameters are plain: strings, numbers, booleans and objects, with no regex patterns and no nullable unions. Local model servers turn tool schemas into grammars for sampling, and on 2026-09-29 a time field declared as "a string matching a pattern, or null" left LM Studio able to send only null: the agent called the tool sixteen times, was told "Updated" each time, and finally edited the file by hand. Formats are checked when the tool runs, with a message the model can act on, an empty string clears a field, and every result says what the item looks like now, so a call that didn't do what the model meant is visible to it.

### Automations

Sessions Jezo starts on its own are automations: files in the workspace's `automations/items/`, one per automation. The frontmatter has a name, a cron schedule in local time, on or off, how many minutes late it may still start (120 unless it says), and for the built-in ones which kind it is. **The body is what the agent is asked when it runs**, so what the morning plan does is editable like a skill (AGENTS.md, principle 6), and the agent can add, change or turn off automations when the user asks, with undo like any other change.

- **Built in:** the morning plan (08:00, may start until 14:00), the evening check-in (21:30), and the weekly review (Sundays 20:00, may start a day late). The rows in 設定 set the first two's times and turn them on or off by editing their files.
- **Running them:** Jezo's own timer looks every 30 seconds, and ten seconds after launch. For each automation that's on, it takes the most recent time its schedule was due (croner); if that was no longer ago than it may be late, and no session of that automation has started since, it starts one. It doesn't start without a usable model, which would only record a failure every time. pi has no scheduler of its own; Hermes has one, but Jezo doesn't use Hermes.
- **When it's done,** a system notification names it, and clicking it opens the conversation.
- **What it may do:** the morning plan only proposes; todos it adds are drafts and times it suggests are proposals, which the E2E test checks.
- **Seeding:** a plugin's directory is copied into the workspace only when the workspace doesn't have it yet, so a built-in automation the user deleted stays deleted.
- **更多 → 自動化** lists them in the order of the day, with the schedule in words (「每天 08:00」「每週日 20:00」「週一到週五 09:00」; other shapes through cronstrue, whose Chinese reads stiffly for the common ones) and a switch. An automation's page has its time (for a schedule with a plain hour and minute), what it's asked (the body, saved when the box loses focus), when it last ran with a link to that conversation, 現在跑一次, and 刪掉 with undo. 新增 opens the chat with 「幫我新增一個自動化：」 in the box: the agent writes the file, as it would when asked anywhere else. A form would have to ask for everything the body says in words. Read on 2026-09-30: qwen3.6-35b made such a request into a todo until the workspace's AGENTS.md was in its instructions (below), and then once saved the file as `.yaml`; `automations/AGENTS.md` now names the file `items/<id>.md`, and a write into `items/` that isn't markdown is refused with the right name.

### Requests Jezo makes

A session Jezo starts on the user's behalf, like sorting 隨手記, begins with a request to the agent that the user doesn't see (a pi custom message with `display: false`). The conversation shows what the agent did and said, not the request. The requests are product content, in `src/main/agent/prompt.ts`.

### Models

There's one list of model providers, with no split between local and cloud: where a model runs doesn't matter to how it's chosen. 設定 → 模型服務商 follows LobeHub's layout, simplified for one person:

- **The list** puts the providers that work on top, then the ones most people start with (Anthropic, OpenAI, Google, OpenRouter, DeepSeek, Mistral, xAI, Groq, and LM Studio and Ollama when they aren't running), then every other provider in pi's catalog, folded. Providers that need more than a key (Bedrock, Azure, Vertex, Cloudflare, sign-in-only Codex) aren't offered yet.
- **LM Studio and Ollama are found without setup.** Jezo asks each at its usual address which models it has, and a server that answers is ready. The address can be changed.
- **A provider's page** has its address (for servers), its key, a connection test that sends one word with a chosen model and says plainly whether it worked (the provider's own error folded under 詳細), and its models with what pi's catalog says they can do: images, reasoning, context size, price. A server's models only show what the server said. Each model can be turned off, which hides it from the pickers.
- **Keys** are encrypted with Electron's `safeStorage`, which uses the OS keychain, and handed to pi at runtime. The window only ever sees the last four characters. A key is never written to a file in the clear and never sent back to a window.
- **Any OpenAI-compatible server** can be added with a name, an address and an optional key.
- **Which model the agent uses** is one choice in 設定, with a search picker over the enabled models of every ready provider. Until the user picks, Jezo uses a model that works: one a local server already has loaded, otherwise the first model of a provider that's set up, and says so. A second, folded choice sets the model for work Jezo starts on its own (sorting notes, and later the morning plan), which can be cheaper; by default it's the same model. A conversation that's already open switches to a newly picked model at its next message.
- **Signing in with a subscription** (pi can do it for Anthropic, OpenAI and others) isn't offered: whether a subscription may be used from another app differs by provider.
- **Not taken from LobeHub:** per-conversation models, a dozen task-specific model slots, client-side requests, reordering providers, and guessing a model's abilities from its name.

Provider settings (addresses, models turned off, added servers, the choices) are per machine, in the app's data, not in the workspace.

- **How hard the model thinks** is one setting next to the model (medium unless changed), offered as the levels pi says the model supports. A model without the chosen level uses the nearest one it has.
- **Importing from pi.** A button on the providers page copies what the user set up for their own pi: keys from `~/.pi/agent/auth.json`, OpenAI-compatible servers from `models.json` (keys written as `$NAME` are read from the environment; ones that run a command are skipped and named), and the default model and thinking level from `settings.json`. It reads those files only when pressed. A server at LM Studio's or Ollama's address updates that entry rather than adding a second one.

## Speech

Speech recognition runs through [Standard ASR](https://github.com/standard-voice/standard_asr), its protocol 0.2, in a Python environment Jezo manages with uv. Jezo starts `standard-asr serve` on a free local port and streams to its WebSocket (`/v1/stream/<model>`); there's no JavaScript client, and the protocol is small enough to speak directly.

- **Audio.** While ⌥X is held, the window records with `AudioContext({ sampleRate: 16000 })`, so Chromium does the resampling, converts to 16-bit PCM and sends it on. The standard layer resamples uploaded files but not streamed audio yet; the spec says streamed audio will be resampled too, and until then engines reject rates they don't take.
- **Engines** are Python packages installed into the same environment (they're found by entry point). The core and the engines come from git for now, since the PyPI release predates protocol 0.2.
- **Installing** is one button in 設定. Jezo makes a Python 3.12 environment in the app's data with uv, installs the core and the engine for this machine (MLX's Qwen3-ASR 0.6B on Apple Silicon, faster-whisper's small model elsewhere), and has the engine fetch its model. Models go where the engine keeps them by default (the Hugging Face cache), so a model the user already has isn't downloaded again. uv has to be installed; a packaged Jezo will need to bring its own.
- **The server** starts a few seconds after Jezo does, so the first hold of ⌥X doesn't wait for Python, and runs with downloads turned off: nothing downloads while the user talks.
- **Traditional Chinese.** Qwen3-ASR often writes Simplified Chinese or a mix. When the app is in Traditional Chinese, the ⌥X window converts what it heard with OpenCC (`cn` → `tw`) before showing it or sending it.
- **Known upstream bug:** the reference server loads the model again for every connection, so each hold of ⌥X pays the load time. It's being fixed upstream; Jezo doesn't work around it.

## Not built yet

- The mockup's chat cards for reworking a bad day (choose your energy, then keep, move, drop) and for previewing what a check-in will remember were removed on 2026-09-30 (Tim): nothing in the app produced them, and the rework one read fixed plans. A bad day is reworked by the rework-a-bad-day skill with `ask_user` and a plan card; memories are confirmed in their own cards.
- Experiments and connections still come from mock data in the store.
- A skill change the agent proposes for the user to review (the 它用的方法 page can show one); for now the agent edits a skill directly, and the change shows in 修改紀錄 like any other.

## Memory

See [memory.md](memory.md). The extension is `packages/pi-memory`. Jezo's side is `src/main/agent/memory.ts`:
- Its store writes through the workspace as whoever is acting. The run's actor, source and session file are in an AsyncLocalStorage (`acting.ts`).
- The IPC lets the windows remember, forget, restore and discard, always as the user.

The read tool refuses the conversation files a deleted memory cited.

## Tests

`bun run e2e` builds the app and runs the Playwright tests in `e2e/`. Each test starts Jezo with a workspace of its own, written by `scripts/fixture.ts`, and app data of its own, then drives the GUI and reads the files to see what happened, and changes files to see the GUI follow. The report (`e2e/report/`) names each test's workspace, which is left on disk to look at. Frontmatter editing, which has to be right for every file the user owns, also has unit tests written before the code (`bun test`).
