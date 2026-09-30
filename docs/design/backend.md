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
  sessions/<id>.jsonl    conversations, as pi writes them
```

**Skills** are the methods concept.md lists as built in (plan in "when X, do Y", estimate from records, track progress, rework a bad day, anchor habits, small experiments), plus each plugin's own, like 隨手記's sort-notes. Their directory names follow the Agent Skills naming rule (lowercase ASCII, which pi checks); the title the user sees is `metadata.title`. Turning a skill off in 它用的方法 sets pi's own `disable-model-invocation: true` in its SKILL.md, so pi leaves it out of the agent's prompt and no list of switched-off skills lives anywhere else.

Each built-in plugin that stores data owns a directory like the ones above. The files Jezo ships (AGENTS.md, manifest, skills) are copied in when the workspace is created. They're the user's from then on, and the agent may edit them (AGENTS.md, principle 5). What happens to them when a new version of Jezo changes its copy isn't decided yet.

### Reading

On start, the main process reads every item file into memory, parsed and checked against its manifest. Measured on this Mac, 10,000 todo files take about half a second ([storage.md](storage.md)), so an in-memory index is enough for now; SQLite (Electron's built-in `node:sqlite`, which has FTS5) comes in when full-text search over memory and sessions does. `better-sqlite3` isn't needed: `node:sqlite` in Electron 44 (Node 24.21) runs FTS5, tested on 2026-09-29, and it needs no native rebuild.

A watcher on the workspace (`fs.watch`, recursive) tells the index when a file changes. Its events are hints: a file is re-read and compared by hash, and a full scan runs when the window regains focus, because file events can be dropped.

### Writing

Every write the GUI makes goes through one write service, and so do the agent's file tools (below). A write:

1. reads the file and checks its hash against the one the caller last saw; if the file changed since, the write fails and the caller reloads;
2. changes only what it was asked to: frontmatter fields are replaced one top-level key at a time, and every other line stays byte for byte;
3. writes a temporary file and renames it over the old one.

**Why key by key.** The `yaml` package's Document API keeps comments but, measured on 2026-09-29, it still rewrites lines nobody touched: `[a, b,   c]` became `[ a, b, c ]`, `0x1F` became `0x1f`, and spacing before comments collapsed. So a write parses the frontmatter to find where each top-level key starts and ends, and replaces only the changed keys' text. A changed nested value (a todo's `steps`) replaces its whole top-level key. A file whose frontmatter doesn't parse is never written; the check reports it instead.

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

## Jezo's agent

Jezo's agent is pi (`@earendil-works/pi-coding-agent`), run in the main process through pi's SDK. A spike on 2026-09-29 ran it inside Electron with a local model through LM Studio: skills and the digest reached the prompt, the session-start and turn-end hooks fired, the agent's edits went through our file functions, and the session was saved and reopened.

### Isolation from the user's own pi

The user may use pi on their own. Jezo's agent must not read their settings, keys, skills or `AGENTS.md`, and must not make network requests the user didn't ask for ([frontend.md](frontend.md), fonts). So Jezo:

- sets `PI_CODING_AGENT_DIR` to a directory in the app's data before loading pi, because some of pi's paths come from it however it's called. The main process's entry (`index.ts`) sets the environment and then loads the rest with a dynamic `import()`. A static import wouldn't do: the bundle runs every import of an outside package before any of its own code, so pi loaded with the user's `~/.pi/agent` as its directory until this was caught on 2026-09-29. Nothing had read the user's keys or models (Jezo's are held in memory and `models.json` is off), and nothing under `~/.pi/agent` had been written;
- sets `PI_OFFLINE=1`, so pi doesn't refresh its model catalog or download `rg` and `fd` from GitHub, and `PI_TELEMETRY=0`;
- keeps settings in memory, with project trust off, so the workspace's `.pi/` and the `AGENTS.md` files above it aren't loaded;
- loads no extensions, skills, prompt templates or context files from the default places, and passes its own: the skill directories in the workspace, and an inline extension with Jezo's hooks;
- replaces pi's system prompt with Jezo's own.

### Sessions

Each session is a pi session saved as JSONL in `<workspace>/sessions/`. Conversations are the user's, so they're in the workspace, not the app's data. The index lists them; the watcher and the undo record skip that directory, because only pi appends to it.

- **A session starts** with Jezo's system prompt and the digest (today's date and todos, active goals, the last check-in, a map of the workspace), in pi's appended system prompt.
- **What started it** (the morning, the evening, ⌥X, the user, 隨手記) is saved in the session as a custom entry, so the chat list can show it.
- **After a crash,** the session file has everything up to the last finished message. Opening it again restores the conversation, and the agent continues from there. That makes a half-done turn recoverable, which is why the workspace doesn't need transactions across files ([storage.md](storage.md)).

### Tools

- **Files:** `read`, `ls`, `write` and `edit`. `write` and `edit` are pi's own tools with Jezo's file functions plugged in, so every agent write goes through the write service and is recorded for undo.
- **Typed tools** for what the GUI shows as a card: proposing todos (a plan), proposing what notes become, and saving to memory. The result names the entities, and the chat draws the card from it. Typed tools make structured writes easier for any model, but the agent can still edit the files directly; the checks catch mistakes either way (AGENTS.md, principle 7).
- **`bash` is off for now.** It's the exit a steered agent would use to send data out (AGENTS.md, trust model). The plan is to turn it on inside an OS sandbox that allows writing in the workspace and blocks the network (`sandbox-exec` on macOS, a network namespace on Linux), so a steered agent can still work but can't send anything out. Until that exists, it stays off.
- **`grep` and `find`** call `rg` and `fd`, which a packaged app can't count on finding. They're off until Jezo ships the binaries or plugs in its own search.

### Checks and the undo record

- **An item file is checked when the agent writes it.** If it wouldn't match its manifest, the write is refused and the tool result tells the agent what's wrong, so it fixes its own mistake in the next step; the history notes how many writes were refused. Checking at the write rather than after the turn means a broken file never reaches the disk or the GUI. pi's `turn_end` hook stays free for checks that need the whole turn, like the agent saying it did something the files don't show.
- **Every file the agent writes is recorded** in the undo record in the app's data, with its content from before and what the agent wrote ([undo.md](undo.md)). One run of the agent (one message from the user, or one request Jezo makes) is one entry in 修改紀錄. The entry's summary is the first sentence of the agent's last reply.
- **Undo restores a file only if it still holds what the agent wrote.** Files changed since, by the user or by anything else, are left alone, and the toast says how many.

### Tool schemas

Tool parameters are plain: strings, numbers, booleans and objects, with no regex patterns and no nullable unions. Local model servers turn tool schemas into grammars for sampling, and on 2026-09-29 a time field declared as "a string matching a pattern, or null" left LM Studio able to send only null: the agent called the tool sixteen times, was told "Updated" each time, and finally edited the file by hand. Formats are checked when the tool runs, with a message the model can act on, an empty string clears a field, and every result says what the item looks like now, so a call that didn't do what the model meant is visible to it.

### Requests Jezo makes

A session Jezo starts on the user's behalf, like sorting 隨手記, begins with a request to the agent that the user doesn't see (a pi custom message with `display: false`). The conversation shows what the agent did and said, not the request. The requests are product content, in `src/main/agent/prompt.ts`.

### Models

Settings offers a local model or a cloud one. The local one is any OpenAI-compatible server on this machine: Jezo tries the configured address, then LM Studio's and Ollama's defaults, and asks the server which models it has. Unless the user picked one, it uses a model that's already loaded, so the first answer doesn't wait on loading. The cloud providers offered are Anthropic, OpenAI, Google and OpenRouter (which reaches most others with one key); their models come from pi's built-in catalog. Keys are encrypted with Electron's `safeStorage`, which uses the OS keychain, and handed to pi at runtime. They're never written to a file in the clear and never sent back to a window.

## Speech

Speech recognition runs through [Standard ASR](https://github.com/standard-voice/standard_asr), its protocol 0.2, in a Python environment Jezo manages with uv. Jezo starts `standard-asr serve` on a free local port and streams to its WebSocket (`/v1/stream/<model>`); there's no JavaScript client, and the protocol is small enough to speak directly.

- **Audio.** While ⌥X is held, the window records with `AudioContext({ sampleRate: 16000 })`, so Chromium does the resampling, converts to 16-bit PCM and sends it on. The standard layer resamples uploaded files but not streamed audio yet; the spec says streamed audio will be resampled too, and until then engines reject rates they don't take.
- **Engines** are Python packages installed into the same environment (they're found by entry point). The core and the engines come from git for now, since the PyPI release predates protocol 0.2.
- **Installing** is one button in 設定. Jezo makes a Python 3.12 environment in the app's data with uv, installs the core and the engine for this machine (MLX's Qwen3-ASR 0.6B on Apple Silicon, faster-whisper's small model elsewhere), and has the engine fetch its model. Models go where the engine keeps them by default (the Hugging Face cache), so a model the user already has isn't downloaded again. uv has to be installed; a packaged Jezo will need to bring its own.
- **The server** starts a few seconds after Jezo does, so the first hold of ⌥X doesn't wait for Python, and runs with downloads turned off: nothing downloads while the user talks.
- **Traditional Chinese.** Qwen3-ASR often writes Simplified Chinese or a mix. When the app is in Traditional Chinese, the ⌥X window converts what it heard with OpenCC (`cn` → `tw`) before showing it or sending it.
- **Known upstream bug:** the reference server loads the model again for every connection, so each hold of ⌥X pays the load time. It's being fixed upstream; Jezo doesn't work around it.

## Not built yet

- Scheduled sessions: the morning plan, the evening check-in, the weekly review. The conversation cards they use (reworking a bad day, what a check-in will write to memory) are still drawn only from mock data, which no conversation produces now.
- Goals, memory, experiments and connections still come from mock data in the store.
- A skill change the agent proposes for the user to review (the 它用的方法 page can show one); for now the agent edits a skill directly, and the change shows in 修改紀錄 like any other.

## Memory

Not decided. [concept.md](concept.md) names pi-hermes-memory and also asks for a record format it can't store (one file per memory, with where it came from and whether the user said it or the agent inferred it). The options and the trade-off went to the user on 2026-09-29.

## Tests

`bun run e2e` builds the app and runs the Playwright tests in `e2e/`. Each test starts Jezo with a workspace of its own, written by `scripts/fixture.ts`, and app data of its own, then drives the GUI and reads the files to see what happened, and changes files to see the GUI follow. The report (`e2e/report/`) names each test's workspace, which is left on disk to look at. Frontmatter editing, which has to be right for every file the user owns, also has unit tests written before the code (`bun test`).
