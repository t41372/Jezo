# Frontend

Status: decided on 2026-09-29. The UI built from the Claude Design mockup (`Life Agent v2.dc.html`) is the production UI, not a throwaway. Backend logic gets wired in after the UI and features settle, so every decision here assumes this code ships.

## Stack

| Layer | Choice |
|---|---|
| Shell | Electron (decided in [concept.md](concept.md)) with electron-vite |
| Package manager and scripts | Bun |
| UI | React, TypeScript |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui on Base UI |
| Motion | Motion (`motion/react`) |
| Drag and drop | `@dnd-kit/core` |
| Icons | Lucide |
| Command palette | cmdk (shadcn's `Command`) |
| Renderer state | Zustand |
| Translation | i18next with react-i18next |
| Toasts | Sonner (shadcn's toast) |
| Charts | shadcn Chart (recharts) |
| Calendar | ReUI's event calendar, copied into `components/reui/`, with date-fns |
| Fonts | Geist, Geist Mono, Noto Sans TC, bundled through `@fontsource-variable` |

### Why, and what was rejected

- **Bun, not Deno.** Electron's main process runs Electron's own Node, and pi is a Node package, so Deno could only have been a package manager. Bun fills that role and was tested on 2026-09-29: install, rebuilding a native addon (`better-sqlite3`) against Electron 44 with `@electron/rebuild`, and packaging with electron-builder all worked. Jezo ended up using Electron's built-in `node:sqlite` instead ([backend.md](backend.md)). electron-builder has no bun command for reading the dependency tree, so it walks `node_modules` instead. That worked. Electron 44 no longer downloads its binary in a postinstall script; it fetches it on first run.
- **pnpm** would also have worked. Bun was the user's preference and passed the test.
- **Base UI, not Radix,** as the primitives under shadcn. The user's choice.
- **electron-vite 5 with Vite 7.** electron-vite's stable release doesn't support Vite 8 yet. Move to Vite 8 when electron-vite 6 is stable.
- **`@dnd-kit/core`, not `@dnd-kit/react`.** The newer package is still 0.x.
- **The calendar is ReUI's event calendar, copied in.** The first version was our own CSS grid, drawn from the mockup, and it didn't work like a calendar: only 7–23 o'clock, overlapping events drawn on top of each other, a few weeks of navigation, no month view, no all-day row, no resizing. ReUI (MIT, from Keenthemes) is a shadcn registry component with a Base UI version. It uses the same `cn` and Tailwind tokens we do, and it already handles the hard parts: overlap layout, multi-day bars, day/week/month views, move, resize and drag-to-create, auto-scroll while dragging, time zones, and 23- and 25-hour days. Because it's copied into the repo rather than installed, we change it where Jezo needs something it doesn't do.
  - What we changed is marked with `Jezo:` comments, so a later upstream version can be diffed in: a per-event `className` (drafts are dashed, done todos solid); `onEventDropOutside`, called when a block is let go outside the calendar; a `data-ec-moving` attribute on `<body>` while a block is moved, so the backlog can show it takes drops, and `data-ec-outside` while it's outside the calendar, so the grid hides its own landing spot; `slotAtPoint`, which turns a screen point into a day and minute for drops from outside; and a Vite dev check in place of `process.env`. It was installed with `shadcn add @reui/event-calendar` on 2026-09-29; apart from the CLI's icon and header rewrites, it matched upstream commit `6e433dd`.
  - Its drag engine is its own pointer-event code, not dnd-kit. The backlog stays on dnd-kit, and the two meet at the edges: a todo dragged from the backlog is dropped on the grid through `slotAtPoint`, and a block dragged off the grid comes back through `onEventDropOutside`, which hands it to the shell's `dropAtPoint` (below).
  - We don't use its nav bar (the header is ours: the relative title, the sync status, and a link to the calendars in 連接), its agenda view, or its resource view. Its nav bar's date picker is why shadcn's `ui/calendar.tsx` and `react-day-picker` came along; nothing renders them yet.
  - **FullCalendar v7** (MIT, and everything we need is in the free part) was the other candidate. Its external dragging is its own system, so the backlog would have had to leave dnd-kit, and dragging a block back out to a list is awkward in it. **schedule-x** puts drag, resize and drag-to-create in paid plugins whose terms exclude open-source projects. **react-big-calendar** is themed with SASS and drags with react-dnd. Extending our own grid was estimated at about a thousand lines to reach what ReUI already does.
- **i18next, not Lingui, Paraglide, or react-intl.** A plugin brings its own strings, and a user's plugin is added while the app runs. i18next loads strings per namespace at runtime, which matches one namespace per plugin. Lingui and Paraglide compile messages at build time, so strings a plugin brings later don't fit their model. react-intl would work, but needs more code at every call site for the same result.
- **Charts use shadcn's Chart (recharts).** The first one is the estimate chart on a goal's page.
- **Fonts ship with the app.** The mockup loaded them from Google Fonts. Jezo makes no network requests the user didn't ask for, so nothing loads from a CDN.

## What came from the mockup

The mockup ran on Claude Design's own runtime (React 18 and Babel from unpkg, a template language, inline styles) and had no animation. None of its code is reused. What carries over:

- **Tokens.** Its CSS variables already use shadcn names. The extras are `--card-border`, `--win`, `--win-border`, the `--draft*` family for agent proposals, `--ok`, `--warn`, and goal colors `oklch(0.68 0.16 H)` with H = 255, 150, 300, 20.
- **`data-ui` annotations** that name the component each element should be.
- **Copy**, all of it.
- **One license note** from its component map: open-sunsama's license is non-commercial, not MIT. Borrow layout ideas from it, never code.

## Structure

```
src/main/        Electron main process: windows, global shortcut
src/preload/     the typed bridge between main and renderer
src/renderer/    React
  src/app/         window chrome, the icon rail, the page host, the plugin registry, drag and drop
  src/components/  shadcn components (ui/), ReUI's event calendar (reui/), shared todo views (todo/), small shared pieces
  src/plugins/     one directory per built-in plugin: chat, today, notes, calendar, goals, more, settings
  src/data/        mock data and the store
  src/i18n/        translation setup
  src/locales/     strings shared by the shell and shared components
src/shared/      types used by both main and renderer
native/hotkey/   the Node-API addon for the ⌥X key
```

shadcn components are copied into `components/ui/` and edited freely. They import `cn` from shadcn's `cn` package, which is what the registry generates now. The CLI can't detect electron-vite, so `components.json` was written by hand and `shadcn init` doesn't run; `shadcn add` works.

Built-in pages are made of plugins (principle 7). Each built-in plugin under `src/renderer/src/plugins/` registers its pages and widgets through one registry, the same way a user's plugin will. A page is a YAML file in the plugin's directory (`page.yaml`) with an id, a title, a Lucide icon name (loaded with Lucide's `DynamicIcon`, so any icon name works; the build emits one small chunk per icon), a position in the rail, which end of the rail it sits at (`rail: bottom` for settings-like pages), and a layout of rows, columns, and widgets. The icon rail is built from the registered pages, not hard-coded. A layout that names a widget nobody registered renders a placeholder instead of crashing, as [storage.md](storage.md) asks.

Widgets on the same page don't know about each other. They share state through the store, and drag and drop between them (the backlog and the calendar on 行事曆) goes through a drag context owned by the shell: a draggable says what it carries, a drop target says what to do with it. A drag that isn't dnd-kit's, like a block moved on the calendar grid, lands through `dropAtPoint`, which calls the drop target under the pointer the same way.

**The layout format is provisional.** [concept.md](concept.md) says not to fix the plugin contract until a second plugin exists, so the format is the minimum that renders the current pages. Some pages are one large widget for now; they get split up when a user needs to rearrange them.

**A plugin can bring its own kind of chat message.** 隨手記 ([notes.md](notes.md)) was the first plugin to need one: its proposal card shows in the conversation. A message of kind `plugin` names the plugin and a type, and the chat draws it with the view the plugin registered as `<plugin>.<type>`. If that plugin is gone, the message shows a placeholder, as a missing widget does. This is the first part of the contract a second plugin shaped.

How a user's plugin code gets loaded at runtime is not decided.

## Data

Todos and notes come from the workspace ([backend.md](backend.md)): the store applies a change at once, writes it through the main process, and takes the file as it comes back. Experiments are files too since 2026-09-30 ([experiments.md](experiments.md)). The mockup's other connections (Strava, Anki, Gmail with its connect dialog) were removed on 2026-09-30: they looked connected and weren't. 連接 has the calendars, and says other services come in as MCP servers or pi packages through 已安裝 ([extensions.md](extensions.md)). `bun scripts/fixture.ts <directory>` writes a workspace with the mockup's todos and notes, for development and tests. Its dates are moved so the mockup's "today" is the real today.

- **Each window changes only the entities it's told about.** When a file comes back, the store replaces that entity and leaves the rest, which may have writes of their own on the way; re-reading the whole list would briefly undo a drag that hasn't reached the disk yet.

- **A todo** has an ID, a title, a goal ID, a cue (the situation it's done in), an estimate, a schedule, and a `why` written by the agent.
- **A todo has a state: `draft`, `open`, or `done`.** A draft is a todo the agent proposed. It only counts once the user accepts it, because a plan is not progress (see [concept.md](concept.md)). Draft is data, not a style.
- **A time slot can be proposed.** When the agent suggests a time for a todo the user already accepted, only the time is a draft. The user confirms it, drags it somewhere else, or sends it back to the backlog.
- **讓 agent 幫我找時間** under the backlog hands the backlog to the agent in a conversation of its own (trigger `backlog`), which proposes times for the next seven days with `todos_update`. The button says it's working while it runs, then offers the conversation, where the agent says what it left in the backlog and why. Until 2026-09-30 the button wrote fixed times from the mockup, which only matched the fixture's todos. Times the agent proposes arrive on the calendar one by one wherever they come from (the morning plan too), not only from this button.
- **Drafts show up everywhere the todo does,** marked as drafts, and don't count toward "做了". The mockup only showed them in the chat; showing them on Today and the calendar too means the morning plan is visible wherever the user looks first.
- **A calendar event** comes from a connected calendar and is read-only in Jezo. An all-day event starts at 0 and its hours are whole days.
- **The backlog has an order,** and a todo dropped on it goes where it was dropped. On disk the order is each todo's `rank`, a fractional index, so a move writes one file ([backend.md](backend.md)).
- **Moving a todo on the calendar settles it:** a draft becomes a real todo and a proposed time becomes the user's. Resizing its block changes its estimate.
- **The change history** is a list of agent actions with per-entry undo, following the semantics in [undo.md](undo.md). Ordinary GUI edits are not in history. Skill removal is an explicit exception: its dialog offers undo in 修改紀錄 ([skills.md](skills.md)).
- **Conversations and the change history come from Jezo's agent** ([backend.md](backend.md)). The chat folds what the agent did into one line (「看了 3 個檔案，改了 1 個」) that opens to each step, shows a quiet 「正在想…」 until the first words arrive, and turns the send button into a stop button while the agent works. Enter during a run queues the next message; a separate action steers the current work. Pending input shows above the box.

## Chat

Decided on 2026-09-30. The conversation uses **assistant-ui** headless primitives, **react-pi** over Electron IPC, and **Streamdown** through `@assistant-ui/react-streamdown`. Buttons, cards, type sizes and colors still come from Jezo's components and tokens. assistant-ui owns scrolling, message actions, the edit composer and version arrows. There is no separate scroll-to-bottom effect in the main chat.

AgentHost creates and keeps every pi session. It still supplies Jezo's tools, checks, memory, calendar and time extensions, pi directory, model choice and undo context. The preload bridge implements the browser-safe `PiClient`; react-pi's node supervisor and session factory are not used. Opening a saved conversation reads its records without creating a model session. Sessions.tsx remains the session list, including conversations started by automations.

- **Rendering:** Streamdown uses the installed code, math and CJK plugins, with their default settings and math delimiters. KaTeX fonts and styles ship locally. Markdown images show their alt text, and the existing CSP still blocks remote images. Links open in the browser through Electron's existing window handler. Code and tables can scroll sideways. Code/table toolbars are hidden; the message action copies the whole message.
- **Sending:** idle Enter sends. During a run, Enter calls pi `followUp`; the second action, or Cmd/Ctrl+Shift+Enter, calls pi `steer`. Pi decides when each is delivered. Pending messages stay outside the transcript until pi delivers them. Taking them back clears the whole native queue and puts the text back in the box: pi has no per-message removal or promotion. Stop clears the queue before aborting. The shared Composer keeps dictation and the ModelChip in both windows. ModelChip still changes Jezo's global choice and supported thinking level; react-pi's per-thread controls do not cover that choice.
- **Versions:** editing navigates to the original user entry with `navigateTree`, then prompts with the edited text. Retry replays that user input on another path; a `jezo.retry` custom entry associates the repeated input with the original displayed user turn. Automation retry replays its hidden request. The old path stays in pi's tree. assistant-ui's BranchPicker selects a version with its continuation, and AgentHost navigates pi to the corresponding leaf without summarizing. A `jezo.branch` custom entry saves the selection in the session JSONL so reopening restores it.
- **The adapter extension:** react-pi 0.0.25 has no tree/edit/retry API and projects IDs from transcript positions. Jezo adds those IPC operations and builds an assistant-ui repository from `getTree`. Persisted message IDs come from pi entry IDs; a streaming message has a temporary UUID until pi appends it. The library still projects text, tools, streaming results and status. Jezo adds tool-result cards (as assistant-ui data parts), the card for outside content kept from the agent, the folded step summary and registered plugin views. Messages with `display: false`, and system records, stay hidden.
- **A run that changed nothing says so.** Under its reply, a muted line: 這輪沒有改動. It shows when no file changed and nothing happened outside the workspace (an install, an outside tool that isn't read-only), so a reply that says 排好了 without having done it is plain to see, in any language. On the latest reply it has a small 請它動手 button, which sends the agent a hidden message (`jezo.nudge`): do what the reply described with the tools, or say nothing needed doing. The user doesn't have to type it. Tim chose this on 2026-09-30 over sending such a run back automatically, which needed either a word list per language or a second model call on every run. The line is a `jezo.unchanged` custom entry, which pi keeps out of the model's context.
- **A reply cut off by its length says so,** with the retry button, instead of ending in silence. On 2026-09-30 qwen3.6-35b in LM Studio repeated one line in its thinking until it ran out of tokens in three of about twenty E2E runs, and the chat showed nothing at all. pi sends no sampling settings, so the server's preset for the model decides them. It isn't retried on its own: a loop takes half a minute, and the next try can loop too.
- **Undo:** switching versions only changes conversation context. It never restores files or external actions. Each edit or retry starts a new undo run. Native steering and queued follow-ups within one uninterrupted run share its undo context until pi settles; they never start overlapping undo runs. 修改紀錄 remains the place to undo workspace changes.
- **Updates:** AgentHost caches completed display messages until the active leaf changes. Streaming updates are coalesced at 50 ms and carry the live message over IPC. New session entries travel once; full snapshots recover a connection, navigation or a finished run. The main window receives full SessionViews only for record, queue or run changes; the quick window keeps its small streaming preview. The tree is not rebuilt or broadcast on every token.

The hand-made chat was replaced because retry, editing, queues, markdown and scroll behavior are already maintained by a chat library. **AI Elements** supplies presentation components but would leave Jezo responsible for the pi runtime and conversation tree. **LobeHub UI** supplies polished rendering and controls, but does not provide this pi adapter and would bring another component system. assistant-ui fits Jezo's existing components and offers the pi transport contract. We extend only the parts that the installed adapter cannot carry.

The PiClient archive/delete and extension-dialog methods reject when called: Jezo's session list does not expose those actions, and its tools ask through existing cards. These methods are not new GUI features.

## Todo details

Decided on 2026-09-30, after Tim: the drawer's details couldn't be edited, and a todo tool should have a Notion-like editor that takes images and other files.

- **Every value edits in place.** The title and the cue are text fields that save on Enter or leaving them. 排在 opens a month view and a time; 大約 offers common lengths in one tap and any number of minutes. They write through the store's existing actions, so a time the user picks is theirs, not a proposal.
- **The notes are the file's body, in a markdown editor:** Milkdown's Crepe, with its "/" menu (headings, lists, to-do lists, quotes, images, tables, code), block handles and image blocks, its labels in the app's language, colored from Jezo's tokens. It writes markdown the way the agent does (`-` bullets, `*` emphasis), so an edit changes only the lines edited: E2E adds a word to a body written like the agent's and the file differs by that word. The one other change it makes is escaping an underscore CommonMark doesn't read as emphasis, like `_不要_` next to Chinese text.
- **The file can change while the drawer is open,** by the agent or another editor. The editor takes the new text unless the user is typing, whose save then wins.
- **Files in the notes live in the workspace,** at `<plugin>/attachments/<item id>/<name>`, linked from the notes with an ordinary relative link (`![白板.png](../attachments/t-1/白板.png)`), so any markdown editor and the agent see them. Pasted, dropped or picked images show in the text; other files are links, listed below the notes with a button that opens them in their own app. The window loads workspace files through the `jezo-file:` scheme, which serves nothing outside the workspace; the content policy allows it for images. Like every GUI edit, adding a file isn't in 修改紀錄.
- **Rejected:** BlockNote, the most Notion-like, because its own block format is the source and its markdown export is lossy: the agent's markdown would be rewritten on every save. MDXEditor, markdown-first but built around a toolbar rather than a "/" menu. Tiptap with its markdown extension stays the fallback; it would need the menus built by hand.
- **Crepe's image block fails on an image without a title,** which is how people write them; a remark step gives such images an empty title while parsing, which isn't written back.
- **Times and zones** (decided 2026-10-01, [time.md](time.md)):
  - 時區 shows the zone the time is fixed to, and its clock there when that's another zone.
  - When the time here differs, it shows that too, with both dates if they differ.
  - Fixing it to another zone keeps the clock, and is previewed before saving.
- **The calendar header names its zone,** with a switch to show another zone. Switching moves fixed times and changes nothing on disk.
- **An automation's page** shows its state in words: waiting for a model, running, waiting for you, interrupted, the catch-up window, and the history, with Skip, Stop, Continue and Run now as [automations.md](automations.md) describes.

## Slash commands

Decided on 2026-09-30. Typing "/" at the start of the box, in the chat or the ⌥X window, opens a menu of what can be run from a message, narrowed by any part of a name, title or description. Arrows move, Enter or Tab picks, Escape closes it until the user types on.

- **What's in it is pi's.** Methods (`/skill:name`, shown by their title), prompt templates, and commands that installed extensions register, read the way pi reads them for a session (`AgentHost.commands()`, each time the menu opens, so something installed a minute ago is there). Picking one puts `/name ` in the box; sending it goes through pi's `prompt()`, which expands a method or template and runs an extension's command. Jezo adds no command format of its own.
- **Jezo's own actions** are two: /new starts a conversation and /model opens the model list. They run on the spot. pi's terminal commands (/tree, /compact, /export and the like) aren't offered: the chat has buttons for what the GUI needs of them.
- **Arguments, as pi's own editor offers them.** After `/name `, a command whose extension gives `getArgumentCompletions` lists what it suggests for what's typed so far, and picking one puts it after the command; a prompt template shows its `argument-hint`. The main process asks the extensions the menu last read, and gives up on one after two seconds.
- **An extension's command needs no model** and runs even while the agent works, as pi runs it. It doesn't get 這輪沒有改動 under it.
- **The chat shows a method command as typed.** pi puts the whole SKILL.md into the user's message for the model; the bubble shows `/skill:name` and what followed it. A prompt template shows expanded, since the text is what was sent.
- **Our own menu, not assistant-ui's.** assistant-ui has a trigger popover, but it needs its own composer input and runtime, and the ⌥X window uses the same box without either. The menu is one hook and one list.

## Translation

- **Languages:** Traditional Chinese and English. The app follows the OS language; any Chinese locale gets Traditional Chinese, and every other language falls back to English. 設定 lets the user pick one instead. Language names are shown in their own language (繁體中文, English).
- **Where strings live:** each plugin has `locales/zh-TW.json` and `locales/en.json`, registered as the plugin's namespace. A page's title in `page.yaml` is a key in that namespace. Strings for the shell and shared components are in `src/renderer/src/locales/`, the `common` namespace.
- **Catching mistakes:** keys are typed against the Traditional Chinese files, so a mistyped key fails `bun run typecheck`. The typecheck also runs `check:i18n`, which fails when a language is missing a key or has one the reference doesn't.
- **What isn't translated:** the user's content. Goal names, todo titles, what the agent said, and what a connector reports stay as written. Labels the app derives from data are translated, so the data model stores facts (a trigger, a date, a number of records) instead of finished sentences.
- **Dates** use `Intl` in the current language. Times are 24-hour in every language for now. The calendar grid formats its own dates with date-fns, so it gets date-fns's locale for the current language and 24-hour formats set in `Calendar.tsx`.

## Windows

- **The main window** uses a hidden inset title bar on macOS, with the traffic lights centered at the top of the icon rail. The rail is 88 px: the traffic lights are 59 px wide on macOS 26, and at 80 px they sat 11 px from the content panel, which looked cramped. On macOS it uses window vibrancy, and on Windows the acrylic material, so the desktop shows through. Linux gets a solid background.
- **How see-through it is.** The OS material already blurs and tints the desktop, so Jezo's own layers are much lighter than the mockup's: the window wash (`--win`) is 0.2 light / 0.1 dark instead of 0.6, and the content panel (`--background`) 0.55 light / 0.4 dark instead of 0.82 / 0.72. On macOS the material is `fullscreen-ui`. We compared materials by screenshot over a colorful wallpaper: `under-window` (the usual choice) and `sidebar` are a thick grey that hides the desktop, while `fullscreen-ui`, `hud` and `popover` let the colors through and look about the same. We checked over a bright wallpaper and a near-black one. Over the bright one, a panel below about 0.4 puts list text on bright colors. Over the dark one, light mode turns the glass mid-grey, where muted grey text disappears; that's why the rail's unselected items use a faded foreground rather than the muted color. Windows acrylic hasn't been checked yet. macOS "Reduce transparency" turns the material solid.
- **Dragging the window.** On macOS the top 40 px of the window, across its full width, is the title bar you drag it by, and so is the empty part of the icon rail. Buttons, links, inputs and other controls inside that strip opt out through one rule in `globals.css`, so a new control doesn't need to remember to. A plain `div` with a click handler isn't covered: put one in that strip and it drags the window instead.
- **The message box** is one component (`components/composer/`), used by the chat and the ⌥X window: the text, a chip for the model and how hard it thinks, the microphone, and send, which turns into stop while the agent works. The chip follows ChatGPT's: it names the thinking level, its menu is a slider over the levels the model supports, and the model list is one step further in. It changes Jezo's model everywhere, the same choice as in 設定, rather than per conversation. The microphone listens until it's clicked again (or Enter), shows what it hears in the box, faded, and then puts it in the box for the user to send.
- **The ⌥X window** is a separate frameless window: the same message box, anywhere. It's hidden, not closed, between uses, and it has no open or close animation because it opens many times a day. It opens a third of the way down the screen the pointer is on and grows with what it shows.
  - **A press** opens it for typing, with a few common questions under the box. The answer shows above the box, and follow-ups stay in the same conversation; ⌘↵ continues it in the main window, and ⌥↵ files the text in 隨手記 without bringing the main window forward. Each press starts a new conversation; the last one is in the main window's list. The keys are listed under the box.
  - **Holding ⌥X** shows the box without taking focus from the app the user is in, with what Standard ASR has heard so far, the microphone level, and which page of the main window comes along as context. Releasing sends what was said, and the answer shows above the box.
  - The microphone is only opened while ⌥X is held or the microphone button is on. That's the only permission Jezo asks for here.

## The ⌥X key

Decided on 2026-09-29, after research the same day.

- **Why Electron's `globalShortcut` isn't enough.** Chromium registers the hotkey through the OS but only listens for the press. On macOS it handles Carbon's `kEventHotKeyPressed` only; on Windows it uses `RegisterHotKey`, which has no release message. Electron issues #7802 and #26301 asked for a release event and were closed without one. Guessing a hold from key repeat doesn't work either: on macOS the callback fires once however long the key is held (tested), and on Windows it repeats because Chromium doesn't pass `MOD_NOREPEAT`.
- **What we do.** `native/hotkey` is a small Node-API addon that registers the key the same way the OS does for Chromium, but also listens for the release. macOS uses Carbon `RegisterEventHotKey` with both pressed and released events. Windows uses `RegisterHotKey` with `MOD_NOREPEAT` on its own thread and polls `GetAsyncKeyState` every 50 ms after a press to catch the release. It's modeled on tauri's `global-hotkey` crate. The main process turns press and release into a short press or a hold: released within 250 ms is a press.
- **Why this way.** It needs no Accessibility or Input Monitoring permission, the OS still consumes the key so ⌥X doesn't type "≈" into the frontmost app, and it keeps working during Secure Keyboard Entry. The cost is a little native code per OS, and it only supports a modifier plus a key, not Fn alone or a mouse button.
- **Rejected: keyboard hook libraries** such as uiohook-napi. They need Accessibility and Input Monitoring, don't consume ⌥X, and have open lag and crash reports.
- **Fallback.** Where the addon can't load or the OS refuses the key, and on Linux, the app registers ⌥X with `globalShortcut` and only the press works.
- **Build.** `bun install` runs `electron-builder install-app-deps`, which compiles the addon against Electron. That needs the platform's C++ toolchain (Xcode Command Line Tools on macOS). electron-builder unpacks the `.node` file from the asar when packaging. Bun copies `native/hotkey` into `node_modules/@jezo/hotkey` instead of linking it, so after editing its sources, run `bun install` again.
- **Tested** on macOS 27 with synthetic key events, in development and in the packaged app: a 600 ms hold reports press and release 620 ms apart, and a tap reports both about 100 ms apart. Not tested: that "≈" isn't typed (synthetic events didn't type it even without the hotkey, so the test couldn't show it), and anything on Windows, where the code has never been compiled.
- **Not done:** Linux on Wayland needs the GlobalShortcuts portal to report the release.
- **The renderer stays isolated**: context isolation on, Node integration off, and everything it needs from the main process goes through the preload bridge. The renderer will show email and calendar content, which is the attack surface named in AGENTS.md.

## Theme

The theme follows the OS by default. Settings offer light, dark, and follow system. The mockup had only light and dark; "follow system" was added as the default.

## Motion

The mockup has no motion. Motion is added where it tells the user something:

- checking off a todo;
- the detail sheet opening and closing;
- draft blocks arriving one after another, in time order, 50 ms apart, when the agent proposes times; only right after the proposal, not when the week is shown again;
- a proposed plan changing from draft to accepted;
- disclosure sections opening and closing.

- pressing anything clickable: cards and buttons shrink to 0.97 while held (the `pressable` utility in `globals.css`), and wide list rows darken instead, since shrinking a full-width row moves its edges too far;
- the white pill of a segmented control (日／週／月, the settings choices) sliding to the new choice, like the rail's selection;
- the calendar moving to another week, day or month: the new dates slide in 16 px from the side they came from and fade in, over 180 ms. Switching between day, week and month only fades. The grid is animated in place, not remounted, so its scroll position stays;
- a todo lifting (a little larger, a deeper shadow) as it's picked up from the backlog;
- a todo dropped on the backlog, from the grid or from elsewhere in the list, flying from where it was let go into its place while the other cards move aside. While it's dragged over the list, a line marks where it will go. It's a line rather than an opened gap because opening a gap would shift the card being dragged away from the pointer;
- the box for naming a todo drawn on the calendar growing from where the drag ended;
- the theme icon turning as it swaps, a small flourish for something toggled rarely.

Closing the detail panel is faster (150 ms) than opening it (220 ms). Nothing that's opened by a keyboard shortcut animates.

All motion respects the OS reduced-motion setting: pressed things don't shrink, and the calendar fades instead of sliding.

**Toolbar buttons don't take focus when clicked,** like buttons in a macOS toolbar or sidebar: the rail, the calendar's navigation, and segmented controls. Tab still reaches them. Otherwise a click could leave a focus ring on the button.

## Detail added beyond the v2 mockup

- **The todo drawer over the calendar** slides in from the right edge by its own width and leaves the same way (300 ms in on the drawer curve, 200 ms out; with reduced motion it only fades), and Escape closes it. Its glass is 92% opaque: at 55%, what the calendar draws in its own compositing layers (its scroller, the raised draft chips, the sticky toolbar) showed through sharp, because Chromium's backdrop blur leaves those layers out (checked 2026-09-30 by putting a blurred box over the calendar).

v2 left some screens and states undrawn. These follow the older mockups (`Life Agent.dc.html` and `Life Agent Prototype.dc.html`) where they had them:

- **The calendar's header** keeps the arrows, 今天 and 日／週／月 pinned to the right, so they don't move when the title gets longer, and puts the range and the sync status on one line above. The sync status names the calendars shown and when subscriptions were last read, or which calendar can't be read, in red ([calendar.md](calendar.md)). A week with no todos says so in a chip next to the title rather than a banner that pushes the grid down. The day view names the day in the title and says how far away it is above it, and hides the grid's own day header.
- **The calendar** shows a day, a week or a month, goes to any date, and has an all-day row. Moving a todo's block schedules it there, dragging its bottom edge changes how long it takes, and drawing on an empty stretch asks for a name and makes a todo in that time. Calendar events stay read-only. The day number in a month cell is at the top right, where Apple and Google Calendar put it; ReUI puts it at the bottom.
- **Settings** is its own page at the bottom of the icon rail, under the theme toggle, instead of a section of 更多.
- **開始** on the current todo starts a focus state with the time elapsed, and 做完了 or 停下來.
- **Undo instead of asking.** Removing a draft, unscheduling a todo, and deleting a memory happen at once, with a toast that offers undo.
- **Steps** in a todo can be checked off.
- **Reworking a bad day** (今天不太順) goes to the agent, which follows the rework-a-bad-day skill: it asks how the user is doing with `ask_user` and proposes the new day as a plan card. The mockup had a card of its own for this, removed on 2026-09-30 (backend.md).
- **Evening check-in** shows what the session will write to memory before writing it, including inferences left out for lack of evidence.
- **Adding methods** uses the existing Dialog, Input, Button and ListCard styles. The list shows provenance; the view offers updates for remote sources and removal for top-level workspace methods. Replacement and updates over local edits ask inside the dialog ([skills.md](skills.md)). Both languages have the same controls and messages.
- **A method (skill)** opens to its SKILL.md. When the agent wants to change it, the page shows why, the evidence, and the diff, and the user applies or rejects it.
- **Change history** entries open to the files each change touched, as a diff, including changes a check blocked.
- **A goal's page** draws what's scheduled this week but not done as a hatched segment after the solid progress, marks rules that work less than half the time, shows the agent's proposed rewrite of such a rule as a draft, and charts estimates against actual time.
- **Connecting** a service first shows what it will read and write, and that what it reads stays on this computer.

## Copy changed from the mockup

- Settings, 模型: the mockup said local models are "比較慢、比較笨". Local models are strong and getting stronger (AGENTS.md, principle 8), so it now says only "比較慢".
- Settings, 叫出 agent: keeps "短按打字，長按說話" where holding works, and says only pressing works where it doesn't (see "The ⌥X key").

## Not wired yet

Buttons that are in the mockup but do nothing yet: the attachment button in the chat box.

The mock data is fixed at 2026-09-29 08:40, but the calendar's now-line and its idea of today follow the real clock.
