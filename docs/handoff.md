# Handoff: where the work stands (2026-09-30, evening)

This is a working note, not a design doc. It holds what the agent building
Jezo was in the middle of, and the decisions waiting on Tim. Delete it once
it's empty.

## Decisions waiting on Tim

### Offline sync (designing ahead)

Tim, 2026-09-30: no phone app soon, but likely later, working offline and merging with the desktop, peer to peer with something like iroh. Design the architecture for it now. Codex's report is in `.claude/research/2026-09-30/sync-astra.md`; its last section has eight questions for Tim (can devices sync without being online together, may user-owned storage hold encrypted data, what exactly "forget" promises, does the phone run its own agent, and more). Hazards already known:
- Times are written as local time with no zone (backend.md). That's fine on one Mac, but ambiguous once a phone in another zone writes.
- Some config is per device (EventKit sources, hidden calendars), some per user (ICS subscriptions). calendar.md marks which is which. A subscription's address is in each device's keychain, so a phone would ask for it again.

### Connectors

`docs/design/connectors.md`. Tim, 2026-09-30:
- ICS and EventKit first.
- Google still has to be built, because many people won't add Google to the Mac's calendar, and Gmail needs it anyway.
- For Google, do b (bring your own client) before a (Jezo's verified client): review is a hassle, and b falls under the personal-use exception, which covers Gmail too.
- Use pi's MCP for connectors the agent uses.

To verify Google through EventKit, Tim needs to add his Google account in System Settings. On 2026-09-30 the Mac had only iCloud, US Holidays and Birthdays.

## Work in progress, in order

1. **Google Calendar, bring-your-own client first.** A wizard in 連接 that walks the user through creating a Google Cloud project, a Desktop client and the consent screen, with the traps:
   - publish to "In production", or refresh tokens expire every 7 days;
   - the "unverified app" warning is expected.
   Then PKCE with a loopback redirect, tokens in `secrets.ts`, incremental sync with sync tokens, and the calendars merged like the others. Gmail later reuses the same client. Jezo's own verified client comes after.
   Still to verify: Google through EventKit, once Tim adds his Google account to the Mac.
2. **Sync design doc.** Write `docs/design/sync.md` from `.claude/research/2026-09-30/sync-astra.md`:
   - the recommendation: one replication document per item, Automerge 3 as the first candidate, iroh as transport;
   - the cheap changes to make now: stronger ids, a committed-change feed, undo through the write service, a workspace id and format version, and one device that runs automations;
   - eight questions only Tim can answer (see the report's last section). Ask him.
3. **Observability for memory.** `.claude/research/2026-09-30/observability.md` recommends, in order:
   - read one failed run from pi's JSONL, which already keeps the prompt sections;
   - add memory decision events (held back, refused, committed, unresolved);
   - six hard eval stories run through the real app;
   - a developer view;
   - optional OpenTelemetry export to otel-desktop-viewer, or Phoenix / Langfuse locally.
   Nothing to install for users. Needs Tim's go-ahead.
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
