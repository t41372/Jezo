# Sync

Status: designing ahead, not built. Tim, 2026-09-30: no phone app soon, but likely later, working offline and merging with the desktop, peer to peer with something like iroh; design the architecture for it now so nothing built today has to be undone. iCloud sync of the workspace folder: not now. The research is `.claude/research/2026-09-30/sync-astra.md` (Codex, gpt-6-astra), kept outside the repo; what decides things is summarized here.

## Proposal

- **The unit of sync is an item, not a file or a folder.** A todo, goal, note or memory has its own id, and its fields and body merge by different rules. Attachments and conversations are different objects again, with their own policies.
- **One replication document per item**, with Automerge 3 as the first candidate (Loro worth a comparison, mainly for removing history and for mobile). Fields are registers, grouped where they must change together (`scheduled` with `proposed`; a memory's sentence with its evidence), and the body is collaborative text.
- **Files stay the editing surface.** The GUI and the agent's tools write through the workspace, which keeps the intent. A file changed by hand, or by a shell command, is compared with the last version the workspace saw and turned into the same kind of change. A stale file never silently replaces a newer version.
- **Replication state lives in the workspace**, in a reserved folder with a documented format, and is backed up with it. This bends principle 1's "anything outside can be rebuilt": losing it leaves every item readable, but a device would have to rejoin rather than resume.
- **Deletion is a record, not an absence.** A missing file can mean deleted, renamed, not downloaded yet, or a failed scan; only an explicit record means deleted, and an old copy arriving later must not bring the item back.
- **Forgetting is stronger than deleting.** It wins over concurrent edits, travels on its own ahead of content, and is applied before anything reaches recall or the agent. A restore names the forget it reverses. Forget records are kept for good; they're small.
- **Undo syncs as a new change**, never as rewinding another device. Undoing an agent run on the desktop and syncing the result works from the start; starting an undo on the phone for a desktop run needs more history on the phone, and is a separate decision.
- **One device runs automations** at first, so two disconnected devices don't both make the morning plan. A synced result never re-runs an outside action.
- **Which device's zone is the user's** is decided here, not before. "Today" and the hours times are shown in follow the user's zone ([time.md](time.md)). With several devices, which one counts, how a manual override works, and what a disconnected phone means are open. "The last device used" was looked at and isn't the answer: remote input into a home Mac would move the user home. The time module and the scheduler take the zone as an input, so the answer plugs in there.
- **Transport: iroh**, paired by QR code, with membership checked before serving anything; point-to-point catch-up first. If iroh isn't ready on a platform, the same data protocol runs over LAN or encrypted export files instead.

## Done now, because it's cheap and later would be expensive

- A forgotten memory whose file comes back (a backup, a copy, one day a sync) stays forgotten: recall and the prompt skip whatever `forgotten.yaml` lists (memory.md).
- A shell command's changes are recorded as the agent's only when nothing else wrote the file meanwhile (backend.md, "Tools").
- Undo writes through the workspace, as a change by the user, so it's indexed and seen like any other change (`UndoLog.undo()`).
- New ids carry 48 random bits after the time (`newId()`, memory ids, and run ids, which were only the time). Older ids stay valid.

## To do before sync, not yet done

From the research, in the order they'd hurt if left:

- **Ids can't change.** Done: `Workspace.update()` refuses a new `id`, and so do the agent's `write` and `edit`. A file whose id is changed by hand while Jezo runs keeps its old id, with a problem saying to put it back. Left: a change made while Jezo was closed is read as a new item, since nothing remembers the old id. Problems show in 更多 → 有問題的檔案, and the agent sees them in the digest.
- **Joining isn't seeding.** A phone joining an existing workspace must not recreate the defaults the user deleted elsewhere.
- **Automations have an owner** (see above).

Looked at on 2026-09-30 and left until sync is built, because adding them then costs no more than now, and nothing would use them before:

- **A workspace id and format version.** A workspace without the file is simply the first format, and pairing can give the workspace its id. A mark on each part of the workspace (synced, derived, per device, a plugin's own store) belongs with choosing what syncs.
- **A committed-change feed** (after the write, with identity, origin, before and after hashes and a batch id). `onWrite` fires before the write, which is right for undo; replication is the first thing that needs the feed after it, and it's one more event in `writeNow()`.
- **Stable ids for a todo's steps.** Only needed if file edits are turned into list changes by position. The CRDT keeps its own ids for list elements, so a diff that matches steps by text may be enough, and ids in every step would make the files noisier for the user and the agent. Decide with the CRDT.
- **The GUI sending the hash it saw.** A GUI write already changes only the keys it was asked to, so it doesn't overwrite a field the agent changed meanwhile. Failing the whole write on any change to the file would make single-device use worse. What sync needs is a check per field, if anything, decided with the merge rules.

Not now: choosing and wiring the CRDT, clocks, the transport, acknowledgements, attachments, selective sync for the phone, and garbage-collecting tombstones. Per-field timestamps in the files are rejected: noise nobody maintains, and they can't recover lost history.

## Rejected

- **Syncing the folder with iCloud, Dropbox or Syncthing.** They merge whole files, so two harmless edits to different fields of a todo conflict; Syncthing v2 even lets a deletion win over an edit. Tim, 2026-09-30: iCloud not now.
- **A server of our own.** Tim wants no paid infrastructure, and the user's data would pass through it.
- **An operation log as the only truth, with files as a projection.** Clean, but it ends "the agent works in the files" (AGENTS.md, principle 2).

## Questions only Tim can answer

1. Must two devices sync without ever being online at the same time? Then something must hold the data in between; a relay can't.
2. Does "no paid infrastructure" also rule out storage the user already owns (their iCloud Drive, say), holding encrypted data?
3. May the workspace hold replication state that can't be rebuilt from the markdown? If not, sync falls back to whole files with visible conflicts.
4. What does forgetting promise: stop recall on every device that has heard, purge all of Jezo's history of it, or also erase the conversations it came from?
5. Does the phone run its own agent and automations offline, or mostly capture and edit?
6. Must undo work from any device, or only on the one where the agent ran?
7. When two devices change the same important field, pick one quietly, or show the user both?
8. How long may a device be away and still merge its old edits automatically?
