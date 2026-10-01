# Automations when the computer was asleep or off

How scheduled automations recover from a laptop that was closed, asleep or off when they were due. Decided on 2026-10-01, from `.claude/research/2026-10-01/automations-missed-sol.md` and its review. What automations are, and the built-in ones, are in [backend.md](backend.md), "Automations". The build order is in [handoff.md](../handoff.md).

## Question

Jezo used to start an automation only if it was due no more than its `late` minutes ago, and drop it silently otherwise. A laptop is often closed at 08:00, so the morning plan quietly didn't happen, and nothing told the user or the agent.

## How others do it

| Product | What it does |
|---|---|
| Hermes Agent, including its desktop app | One catch-up per job after downtime, with an opt-out. It records scheduled time apart from start time. An abandoned run is marked unknown rather than replayed. Verified in source. |
| Claude Code Desktop | On start or wake, runs the most recent miss within seven days once per task and drops older ones, showing the skips in history. It warns that a morning task can run at night. |
| OpenClaw | Paces startup catch-up: at most five at once, five seconds apart. |
| Codex app | No documented contract. Users report both missed runs and bursts of eight on startup. |
| launchd (macOS) | Coalesces runs missed during sleep into one on wake. A run missed while the machine was off waits for the next time. |
| systemd timers (`Persistent=true`), Windows Task Scheduler (`StartWhenAvailable`) | Run once after a miss. |

## Occurrences

- **An occurrence** is one scheduled opportunity. Its identity is the automation plus its slot: the date and clock in the schedule's zone.
  - A slot runs at most once. Crossing between Arizona and California, or flying west into the same date, doesn't run the same 08:00 twice.
- **A schedule's zone** is local by default: the device's, following travel. An optional `zone` field fixes it to a named zone ("09:00 New York, wherever I am"), with the same values as in [time.md](time.md).
- **Jezo checks** on launch, resume, unlock, window focus and the 30-second tick, all through one serialized path. A check never waits for a run: it notes what's due, and a worker starts it (below), so a time that comes due while another run is going is found on time. Each check:
  - reads the workspace first: on resume, unlock and focus it reads the files again, since file events can be missed while asleep;
  - finds the most recent due occurrence in the current zone;
  - makes it **pending** if its slot isn't claimed and its catch-up window is open;
  - records older unclaimed ones as **replaced**, listing up to 500 of them; past that the run is told "more than 500". The list only goes up to the time due now, and a claimed time is never in it.
- **Coalescing merges invitations to run, not what an automation works on.** The run is told the range that went unhandled. Its request decides whether to cover that range (an expense log would) or to start from today (a morning plan would).
- **After a zone change, the gap isn't reconstructed.** Jezo doesn't know when the zone changed while it was off. It records that earlier occurrences weren't worked out, and evaluates the latest occurrence in the new zone.
  - Los Angeles 08:50 to Phoenix 09:50 with a 09:00 plan: Phoenix's 09:00 slot hasn't run, so it runs, labelled as after a zone change.
  - Flying Tokyo to New York across the date line: New York's 08:00 on the same date isn't run again. Run now is offered.
- **Clocks going forward and back:**
  - an occurrence in a spring-forward gap shifts by the gap's length, as Croner does;
  - a repeated hour runs at its first occurrence, and both copies are one slot.
- **On time vs late.** An occurrence picked up within 2 minutes of being due is on time, whatever its window. So a 30-second tick never makes `catch_up: no` skip a run. It stays on time while it waits behind another run; only one that was already late when found is held to its window when it starts.
- **Window edges.**
  - Due is inclusive; the latest start is exclusive.
  - The window is checked again right before starting, so a run queued at 17:59 doesn't start at 18:02.
  - The window limits the start only; a run already going is never stopped.
- **Only claims are final.** An unstarted occurrence that was skipped can become pending again if the clock moves back. A claimed slot never runs twice.

## The catch-up window

`catch_up` in the automation's file:

| Value | Meaning |
|---|---|
| `no` | Only on time. |
| `for 90 minutes`, `for 2 hours` | Until that long after the due time. |
| `until 18:00` | Until that clock after the due time, in the schedule's zone: on the occurrence's date, or the next day's when the clock isn't after the due time. A 22:00 run `until 02:00` can start until 02:00 the next morning, the way Home Assistant reads a time window across midnight. |
| `until end of day` | Until the next midnight there. |
| `until next time` | Until the next occurrence. |

- **The next occurrence always closes the window.**
- **If `catch_up` is missing,** the window is `for 2 hours`.
- **Problems are shown, not guessed past:**
  - a value that doesn't parse;
  - a cron expression Croner rejects. The old manifest checked only the five-field shape, so a bad expression silently never ran.
- **The parsing is deterministic.** No model decides whether a run starts.

| Built-in | `catch_up` | Why |
|---|---|---|
| Morning plan | `until 18:00` | A plan for the afternoon is still useful; one at bedtime isn't. |
| Evening check-in | `until end of day` | After midnight it would ask about yesterday as if today were ending. |
| Weekly review | `for 24 hours` | A late review still covers the week it was for, and is told those dates. Days later, the morning plan after an absence covers what matters now. |

The automation's page shows the window in words, "若 08:00 錯過，當天 18:00 前補跑一次", and lets the user change it.

## Attempts

An attempt is one run, scheduled or manual, in one conversation.

- **The claim is written before the run starts,** so a crash can't make it run twice. It names the run's conversation, which exists before anything is asked of the model.
- **One start at a time per automation.** A run is reserved before anything is awaited, and looked at again from the file as it is right before it's claimed: a run queued behind another can find its window closed, or the automation turned off.
- **Every attempt ends** completed, waiting for the user (the agent asked with `ask_user`), failed, stopped, or interrupted (Jezo quit or crashed). The host reports the end for every exit path. A later reply in the same conversation isn't a new attempt.
  - A reply cut off by the model's output limit is failed, not completed.
  - Quit cuts a run off as interrupted, the same as a crash: its changes stay listed as 沒跑完 with undo and 接著做.
  - A run that throws after changing files is failed, and its changes are in 修改紀錄 right away.
- **One background attempt runs at a time,** oldest due first, then earliest latest start. A Sunday review therefore runs before Monday's morning plan, which can use it. Chats aren't held up by background work, and background work waits while the user is chatting: the worker starts nothing while a conversation the user started is running.
- **Retried only when nothing could have happened.** A run whose model call fails is `unreachable`, and its time can be tried again on its own, only if it never got as far as a tool that can change something. That's decided before each tool runs, from the tool's own definition (`readOnlyHint`; pi's read, ls and tool_search only read), not from what changed afterwards: a script that ran and then a model error is `failed`, and its time isn't run again.
- **An interrupted attempt is shown at once and isn't rerun:** it may already have changed files. The user gets the partial conversation, undo for what it changed, and Continue, which asks the agent to pick up from the current files.
- **Sleeping mid-run.** If the model call survived the sleep, the attempt goes on, and its next model call gets the time-jump note: "Paused from Thu 17:56 to Fri 09:00. This run was for Thursday; Friday's morning plan will run on its own." If the call didn't survive, the attempt ends as failed or interrupted.
- **A model that can't be reached before anything happened** (none set up, or a local server still waking) makes the occurrence wait. It retries after 1, 5 and 15 minutes, then every 15, while the window is open, looking for local servers again each time. Every retry is recorded, so a relaunch doesn't reset them.
  - If the user retries that conversation, the scheduler takes the time back first (a `resumed` event), so it can't start the same time beside it; the attempt ends again with the retry.
- **Run now:**
  - with an occurrence pending, takes it, even while it waits for its next retry;
  - with one running, opens it;
  - otherwise starts a manual attempt that consumes nothing. At 07:00, a manual morning plan doesn't use up 08:00.

## History

`automations/history/<id>.jsonl` holds one line per event, and the GUI derives one row per occurrence from it:

| Event | What it records |
|---|---|
| watching | Where checking starts, and in which zone. |
| zone | The zone checks moved to, so a relaunch doesn't announce the same move again. |
| replaced, expired or zone-changed | Slots that passed without a run, and why. |
| claimed | The attempt, its slot, its origin and its conversation. |
| ended | The outcome. An attempt that couldn't reach its model can end again when the user retries it; the last end counts. |
| retry | One retry and its reason. |
| notified | A notification went out. |

- **It's in the workspace** because the scheduler acts on it (AGENTS.md, principle 1). It's the exception to one entity per markdown file; see [storage.md](storage.md).
- **It's written through the workspace with the writer `jezo`.**
  - Undo never records those writes.
  - The shell's before-and-after snapshot skips this folder, so a write during a shell command isn't blamed on the agent.
  - The workspace reader doesn't read it as items.
- **Events are appended,** so a write costs what it adds. A last line without its newline is an append a crash cut off: it never happened, and is cut before the next append.
- **Any other line that can't be read is a problem** in 有問題的檔案 and on the automation's page, with its line number. While there is one, the history doesn't say for sure what ran, so that automation doesn't start on its own ("執行紀錄有讀不懂的地方…所以先不自己跑"). Fixing the file lifts it; nothing is written to the automation. Run now still works.
- **A missing history never means "run everything".**
- **Where checking starts:**
  - **An automation with no history that was there when Jezo started** begins watching at its latest time. That time can still run late, and nothing before it is counted. So the morning plan still runs when Jezo is opened for the first time at 08:05.
  - **An automation added while Jezo runs** begins watching then: one made at 15:00 for 08:00 hasn't missed today's 08:00.
  - **Turning one off and on** isn't downtime, so nothing from the pause is caught up.
  - **A changed schedule** applies from the next check.

## What the run is told

Right before the request:

```text
Now: Thu 2026-10-01 15:00, America/Phoenix (UTC-07:00).
This run: the morning plan for Thu Oct 1, due at 08:00. It started 7 hours late; it could start until 18:00.
Not run: 13 earlier morning plans, Sep 18–30. They won't be run.
Last morning plan that finished: Wed Sep 17, 08:04.
Interrupted runs: none.
The user last did something in Jezo on Sep 17 (a message or a change in the app). That says nothing about what they did elsewhere.
History: automations/history/a-morning.jsonl.

Request:
…
```

- **Code computes every fact,** and the request comes last. A retry from the conversation drops what the note said about the first try, like how late it was, and gets a fresh time note. It keeps which day the run is for: "This run: the weekly review for Sun Oct 4, due at 20:00. This is a retry, sent now." A weekly review retried on Tuesday still reviews the week to Sunday.
- **The built-in requests are written so a late run doesn't contradict them:**
  - The morning plan plans the rest of the day. After an absence it starts from today, rather than making up for missed days.
  - The evening check-in names its date.
  - The weekly review is given its week and, separately, the range to plan ahead.

## What the GUI shows

| State | Shown |
|---|---|
| Waiting for a model | "08:00 的早上排程在等模型，18:00 前都可以開始", a link to set one up, and Skip. |
| Running | When it was due and when it started, with Stop. |
| Waiting for you | A link to the question. |
| Interrupted or failed | The reason, the partial conversation, undo, and Continue. |
| Replaced or expired | A quiet line in the history, with no badge per miss. |
| After a zone change | Which zone was used, and that earlier occurrences weren't worked out. |

- **A schedule fixed to a zone says so:** "每天 08:00（紐約時間）", in the list, the header and the catch-up sentence. A history line names the zone of a time from another one.
- **A schedule with more than one time a day** has no one time to name: "錯過排定時間時，120 分鐘內補跑一次，下一次到了就不補".
- **Each run in the history opens its conversation,** interrupted and failed ones included. A run by hand says when.
- **The page follows the history file,** so a retry or a skipped time shows without leaving the page.

**Notifications.** A batch is the set of catch-up attempts admitted in one check.
- It gets at most one system notification, sent once all its attempts have ended.
- If everything expired, there's no notification at all.
- The batch is recorded, so a relaunch doesn't announce it again. Notifications are best effort: a batch cut off by a crash isn't announced later; its runs are in the history and the conversations.
- If Jezo is in front, there's no system notification; the results are in the app.

## One scheduler

`app.requestSingleInstanceLock()`, taken after the data folder is set, so two copies of Jezo can't both claim one slot. A second launch focuses the first. Each E2E test has its own data folder.

Which device runs automations once there's a phone is for sync to decide ([sync.md](sync.md)). The scheduler takes the zone and the clock as inputs.

## Staying available

- **"Start Jezo at login" is a setting,** off by default. On macOS, a login launch opens no window, and Quit means quit.
- **Rejected:**
  - Waking the computer on a schedule: it needs root or admin on every platform, and the lid, FileVault and battery all make it unreliable.
  - Keeping the computer awake.
  - Relying on Power Nap: it doesn't run arbitrary apps.

## Built

On 2026-10-01:
- **`src/main/agent/schedule.ts`:** the checks, the window, serial runs, and the note before the request.
- **`src/main/agent/history.ts`:** the history.
- **`src/shared/catch-up.ts`:** the plain-word windows, which the workspace check and the automation's page also use.
- **The built-in automations:** their windows, and their requests rewritten for late runs.
- **`e2e/automations.spec.ts`** moves the main process's clock and fires the real resume handler:
  - waking at 15:00 runs once, told how late;
  - waking again doesn't repeat it;
  - after 18:00 it's skipped;
  - after two weeks, on a Thursday afternoon, only the morning plan runs.

Also built:
- **The automation's page in 更多** shows its window in a sentence, with a choice of others, and its recent history, one line per time.
- **Undo saves each change as it's made**, so 修改紀錄 lists a cut-off run as 沒跑完, with undo and 接著做 (undo.md).
- **"Start Jezo at login"** is a switch in 設定. The OS keeps the setting, and a login launch opens no window. It isn't covered by E2E, since turning it on in a test would add the development build to the Mac's login items; try it in the packaged app.

Not yet:
- a Stop on the page for a run that's going; the conversation has Stop. Skip is on the line of a time that's waiting.

## Rejected

- **Replaying every missed occurrence:** obsolete plans and repeated questions, right when the user returns.
- **Running a missed request at any age.** A morning plan at bedtime is noise.
- **Skipping silently.** It's how the old scheduler behaved, and nobody could tell.
- **Letting the model decide whether to start.** It's an inference per tick, it differs from model to model, and it leaves no contract.
- **Combining all missed automations into one request.** It mixes "the day starts" with "the day ends" and "the week ended", and makes outcomes hard to inspect and undo.
- **Restarting an interrupted run from the start.** It may already have acted.
- **Keeping the history in app data.** Losing it would change what runs.
- **Falling back silently to a cloud worker or another device.** That changes where data goes without the user choosing it.
