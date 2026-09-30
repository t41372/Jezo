**I would choose (d): split the principle. Keep user ownership and agent access in `AGENTS.md`. Keep the workspace directory as an architectural requirement in `storage.md`, and directly editable formats as the default there.**

I would keep today’s files. This is a change to how future decisions are made, with no immediate storage migration. (inference)

The current wording combines four independent questions:

| Question | Appropriate status |
|---|---|
| Can users inspect, correct, back up, export, and delete their data? | Product principle |
| Can the agent discover and work with data beyond whatever context Jezo supplies? | Product principle |
| Where does Jezo keep its durable local data? | Architectural decision: the workspace |
| Which formats and access methods should a plugin use? | Defaults and obligations in the storage design |

A SQLite database inside `~/Jezo/finance` satisfies a directory-location rule. A markdown mirror of Google Calendar does not become authoritative merely because it lives there. A digest assembled from authoritative records does not become a competing database merely because it enters the prompt.

Those distinctions resolve most of the apparent conflict. (inference)

**What the repository establishes matters more than the slogan.**

- **The current design already permits different formats.** [storage.md](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/storage.md:18) explicitly permits SQLite inside a plugin directory. “Files versus databases” is therefore no longer the actual decision.
- **Automatic context is already intentional.** The host supplies the [digest](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:248), and the memory extension supplies a [memory section](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/index.ts:35). `memory.md` acknowledges the tension. A prohibition on this would reverse existing product decisions.
- **Agent access already benefits from tools.** [backend.md](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md:116) records a four-minute planning run spent largely reading individual todos before `todos_list` existed. Direct file access and efficient agent access are different properties.
- **Deletion is less complete than the prose suggests.** The [undo implementation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/undo.ts:39) keeps 100 runs, rather than expiring records after a time window, and retains complete before-and-after contents. [Forgetting](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/memory.ts:228) removes the memory file but retains a hash and evidence references; the [host blocks reads](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:294) of cited conversations rather than deleting those conversations. This implements recall suppression, not removal of every copy.
- **Crash recovery needs a narrower claim.** [backend.md](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md:111) says session recovery removes the need for transactions across files. Resuming a conversation can help finish interrupted work, but cannot guarantee that related records agree or that an external action is not repeated. (inference)

The phrase “a plugin with its own mechanism” is also too loose to guide contributors: every sufficiently complicated plugin can claim to have one. The useful distinction is what responsibilities a plugin assumes when it leaves the standard file path. (inference)

The following two tables assess Jezo’s use cases. Benefits, costs, and recommendations are architectural judgments **(inference)**; linked implementation details are evidence.

| Data or use case | What the directory and editable files buy | What they cost or fail to guarantee | Direction for Jezo |
|---|---|---|---|
| **Todos, goals, notes** | Inspection outside Jezo, straightforward edits, small diffs, easy recovery of individual records, shared access for GUI and agent. | Schema evolution, broken references, concurrent edits, and consistency across related records remain application work. | Keep one markdown file per entity with structured fields. This is a strong default for the current workload. |
| **Long-term memory** | Users can inspect and correct what was remembered; provenance can travel with the record. | Files do not supply relevance, consolidation, correction semantics, or reliable forgetting. A correction can require several coordinated writes. | Keep current files while they remain useful. Permit another store, subject to the same correction, deletion, GUI, and agent-access requirements. |
| **Google Calendar and EventKit** | A local mirror supports offline display, search, evidence, and a record of what Jezo saw. | The mirror can be stale. Editing it does not change the calendar. Remote deletions, recurrence exceptions, versions, and rejected writes require reconciliation. | The connected calendar remains authoritative. Keep local annotations and pending changes separately. EventKit is an access API to another store, including calendars already local to the machine. [Apple’s access model](https://developer.apple.com/documentation/eventkit/accessing-the-event-store), [Google synchronization](https://developers.google.com/workspace/calendar/api/guides/sync). |
| **ICS subscriptions and imports** | ICS preserves calendar-specific structure and can be inspected or moved between programs. | A subscribed feed, an imported snapshot, and a locally managed calendar have different ownership. Treating all three as ordinary editable events creates ambiguity. | A subscription is an external source; an import can become a local record through an explicit import operation. A Jezo-owned calendar may use files, but must preserve time zones and recurrence semantics. |
| **Email** | A local archive can remain searchable without the provider; original messages preserve evidence and attachments. | Volume, attachments, MIME, changing labels, retention, and sensitive duplicated content. Saving outside text locally does not turn it into trusted instructions. | Start with live tools and a bounded cache. Make full archival storage a separate feature. Keep drafts, local annotations, and unsent work durable; retain source identity on imported material. |
| **Habit, time, and health logs** | JSONL is inspectable, streamable, and convenient for modest append workloads. | Corrections, deduplication, aggregation, concurrent appends, and deletion become harder as logs grow. One sample per second is 86,400 records per day. | JSONL fits daily completions and modest event logs. Permit SQLite or another suitable local format for dense series. Preserve units, timestamps, source, and correction semantics in exports. |
| **Agent session transcripts** | JSONL suits append-oriented history and pi’s existing resume mechanism. The conversation travels with the workspace. | Transcripts accumulate private copies of facts, tool outputs, and sometimes deleted records. Arbitrary editing can break session structure. | Keep pi’s native format. Treat transcripts as retained user data with their own deletion policy, not as an indefinitely harmless log. |
| **Search indexes and embeddings** | Keeping canonical records separately allows repair and changing search implementations. | Rebuilding can be expensive, require a particular model, or send data to a service. Derived storage still contains private information. | Disposable means safe to lose, not necessarily cheap to regenerate. Never keep unique annotations or corrections only in an index. Deletion must invalidate derived copies. |
| **UI layouts** | Small YAML documents support inspection, agent customization, backup, and reuse. | GUI edits can damage comments or unknown plugin fields; widget upgrades require migrations. | Keep declared layouts in the workspace. Keep temporary window positions and selection state outside. Preserve unknown layout nodes. |
| **Secrets** | Putting everything together would simplify copying. | It would also put credentials into ordinary backups, searches, git repositories, and model-readable files. | Keep credentials in OS-backed secure storage. Put connection descriptions and credential references in appropriate configuration. A workspace backup may require signing in again. |
| **Third-party SQLite plugin, such as finance** | Its authoritative database can still live in the plugin directory. Transactions and indexed queries may simplify its implementation. | Standard markdown indexing, GUI rendering, file diffs, and file-level undo no longer come for free. Live database backup requires coordination. | Allow it without a markdown shadow database. Require usable GUI and agent operations, documented data, consistent backup/export, deletion, and undo support. Finance does not automatically require SQLite: Beancount is a useful counterexample. |

A live API and a local mirror need not be mutually exclusive. A practical connector can use the mirror for ordinary display and search, and consult the provider before a consequential change. For Google Calendar, conditional writes can detect that the provider’s version changed. A queued offline edit is durable user work, even when the surrounding mirror is disposable. (inference) [Google resource versions](https://developers.google.com/calendar/api/guides/version-resources).

| Operational use case | What the directory buys | What it costs or fails to guarantee | Direction for Jezo |
|---|---|---|---|
| **Future phone client and sync** | A desktop workspace remains a clear local home for data. | One user can still have several concurrent writers. Offline phone edits require identity, conflict handling, deletion propagation, and durable pending operations. | A remote phone UI can initially use the desktop as authority. An independently working offline phone requires a separate replication design. Neither text nor SQLite supplies that automatically. |
| **Workspace in iCloud or Dropbox** | Familiar synchronization and copying with little setup. | Files may be offloaded, conflicts become duplicate files, and related changes arrive separately. A live database and its journal are not an ordinary document to synchronize independently. | Preserve the user’s choice, but state support accurately. Keep unavailable files distinct from deletions and resolve conflicts in the GUI. Do not advertise live database-folder synchronization as supported. [Obsidian’s platform guidance](https://obsidian.md/help/sync-notes), [Dropbox conflicts](https://help.dropbox.com/organize/conflicted-copy). |
| **Opening the workspace in Obsidian** | Immediate practical portability for notes and prose; another editor can remain part of the workflow. | Jezo fields are not automatically Obsidian features. Outside edits can violate schemas; renames can break path links. | Support ordinary edits to core records deliberately. The current [body links use paths](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md:82), so unrestricted external renaming is a separate promise. |
| **Putting the workspace in git** | Useful diffs, history, branching, and user-controlled backup for text. | Git retains deleted content; database changes are opaque; histories and conflict files can grow. | Let the owner opt in. Jezo should not use the owner’s git history as its undo mechanism or rewrite that history silently. |
| **Backup and export** | One location is discoverable and makes completeness easier to reason about. | Copying a changing directory is not necessarily a consistent backup. A database dump without attachments or schema information may be incomplete. | Provide a coordinated backup and a portable export. Include all authoritative records and pending work. SQLite provides supported snapshot mechanisms. [SQLite backup API](https://sqlite.org/backup.html). |
| **Deletion and privacy** | Individual text records are easy to locate and remove. | Undo, transcripts, indexes, embeddings, exports, backups, tombstones, and cloud copies can retain information. Filesystem deletion is not a guarantee of physical erasure. | Define ordinary deletion, forgetting, and permanent removal separately. Permanent removal must cover copies Jezo controls, with external retention explained. SQLite additionally requires deliberate handling of deleted pages and search tables. [SQLite deletion caveats](https://sqlite.org/pragma.html#pragma_secure_delete). |
| **Undo** | Small independent files make before/after comparison understandable and can preserve later user changes. | A whole database or monthly log is too coarse: an unrelated later edit can make the entire operation ineligible. Restoring one file may also break a relationship with another. | Keep current file undo for current records. Database plugins need record- or operation-level undo with conflict checks. Restoring a local mirror does not undo a sent email or provider-side calendar action. |
| **Crash recovery** | Files expose partial progress; JSONL supports reopening a session. | A crash between “create replacement” and “supersede old record” can leave contradictory state. A completed external action may lack its recorded result. | Use atomic writes for individual records and explicit recovery for related operations. Persist enough information to reconcile uncertain external outcomes. Do not delegate integrity entirely to a resumed model. |
| **Weak local models versus strong models** | Strong models can inspect unfamiliar structures, write scripts, and handle cases absent from narrow tools. | Weaker models may waste calls, write invalid structure, or misunderstand domain rules. Syntax validation does not catch every semantic mistake. | Offer compact queries and simple write tools backed by the same operations as the GUI. Retain broader file or programmatic access where meaningful. Verify results rather than choosing one access style for every model. |
| **10,000–100,000 items** | File storage can remain workable; individual edits stay small. | Startup scans, filesystem latency, watchers, memory use, link traversal, GUI transfer, and agent retrieval all matter. The repository’s 10,000-file parsing measurement does not establish 100,000-item application performance. | Measure complete workloads before migration. An incremental persistent index may solve the problem while leaving files authoritative. |
| **Injected digest versus generated file** | A generated file is inspectable and can be read on demand. | It adds another representation, freshness management, and a tool call the model may omit. Injection spends context but guarantees the snapshot is present—not that the model understands it. | Keep a small, inspectable, timestamped digest with references to live records. A generated file may expose the same projection, but should not become another editable authority. |

The SQLite concern here is not simply that a database is “binary.” SQLite’s write-ahead log can contain committed changes absent from the main database file. Its transaction and backup mechanisms must remain intact when copying, restoring, or synchronizing it. [SQLite WAL documentation](https://sqlite.org/wal.html).

**The comparable systems support different choices for different promises.** The evidence below reflects documentation available on September 30, 2026. “What happened” means documented implementation and maintenance consequences, not independently measured superiority.

| System | Decision and documented consequence | Implication for Jezo **(inference)** |
|---|---|---|
| **Obsidian** | Notes remain local markdown files; outside edits are detected. Metadata is cached and rebuildable, while some application and sync state lives elsewhere. It supports multiple sync approaches with platform-specific restrictions. [Storage](https://help.obsidian.md/Files+and+folders/How+Obsidian+stores+data), [sync](https://obsidian.md/help/sync-notes). | Files are an effective product commitment when using other editors is central. Even this model distinguishes note ownership from runtime state and sync machinery. |
| **Logseq** | The team cited whole-file rewrites, referencing changes, large-graph performance, sync data loss, and unreliable undo when pursuing the database version. In April 2026 it announced separate products: file-based **Logseq OG**, maintained without new features, and database-based **Logseq**. Maintaining both architectures inside one app had slowed development and caused confusion. [Original rationale](https://discuss.logseq.com/t/why-the-database-version-and-how-its-going/26744), [2026 split](https://logseq.io/page/b2ad9ce1-9cb7-4436-8083-54cb4516d324/df4dc09d-0a12-4c87-904e-22a9bf4c350a). Its documented markdown export omits some graph information. [Export formats](https://github.com/logseq/docs/blob/master/db-version.md#graph-export). | Avoid promising universal editable markdown and unrestricted structured behavior simultaneously. Export fidelity needs an explicit definition. Jezo’s stable IDs and one-file-per-entity design already avoid some original Logseq problems. |
| **SilverBullet** | Explicitly keeps markdown authoritative and its object index rebuildable. Its current collaboration documentation, marked experimental, describes merging outside and concurrent edits, conflict widgets, and sibling copies for binary conflicts. [Objects](https://silverbullet.md/Object), [collaboration](https://silverbullet.md/Collaboration). | Files do not make sync or collaboration impossible. They make the reconciliation policy visible and necessary. `storage.md` should replace its categorical claim that files cannot provide these features. |
| **Taskwarrior 3** | Moved task storage to `taskchampion.sqlite3`, while retaining a largely unchanged CLI. The stated aims included reliability, encrypted synchronization, and embeddability. It requires migration from old storage and explicitly does not support ordinary external file-sync tools for the live database. [Rationale](https://github.com/GothenburgBitFactory/taskwarrior/discussions/3208), [upgrade](https://taskwarrior.org/docs/upgrade-3/), [sync](https://taskwarrior.org/docs/sync/). | A command-line interface can remain excellent while the underlying data becomes transactional. Bash access does not imply hand-editable storage. |
| **Beancount / Fava** | Financial records remain text with domain-specific validation. Fava edits source slices and checks hashes before saving, rejecting external-change conflicts. [Beancount validation](https://beancount.github.io/docs/getting_started_with_beancount/), [Fava file operations](https://beancount.github.io/fava/api/fava.core.html#module-fava.core.file). | Text can support demanding structured domains when the language, validation, and editing contract are designed together. The lesson is stronger than “finance fits files.” |
| **Home Assistant** | Uses mixed storage: declarative configuration, GUI-managed dashboard storage, and a recorder database for history and statistics. SQLite is the recommended recorder default, stored in the configuration directory. Recorder retention, disk space, and database changes need explicit management. [Recorder](https://www.home-assistant.io/integrations/recorder), [dashboard modes](https://www.home-assistant.io/dashboards/dashboards/). | A local directory can contain several appropriate storage mechanisms. Plugin freedom still needs shared operational responsibilities. |
| **OpenClaw** | Its memory documentation describes markdown memories, automatic loading of selected files, and memory-search tools. Its workspace documentation separately places durable runtime state—including sessions and transcripts—in databases outside the workspace. [Memory](https://docs.openclaw.ai/concepts/memory), [workspace boundaries](https://docs.openclaw.ai/concepts/agent-workspace). | “Memory is files” is not equivalent to “the workspace contains all durable state.” Automatic context and file access coexist. |
| **Hermes Agent** | Keeps compact `MEMORY.md` and `USER.md` files, edited through a memory tool and injected as a frozen session-start snapshot. Capacity errors make the agent consolidate. Session storage moved from per-session JSONL to SQLite holding metadata and full messages. [Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory), [session storage](https://hermes-agent.nousresearch.com/docs/developer-guide/session-storage). | Different lifecycle and query requirements justify different formats within one agent. A file-based memory mechanism can still use tools and automatic loading. |
| **Claude Code** | Loads project instructions and a bounded auto-memory index automatically; more detailed memory remains in topic files. The documented auto-memory startup limit is 200 lines or 25 KB, whichever comes first. [Memory and instructions](https://code.claude.com/docs/en/memory). | The coding-agent pattern itself uses both automatic orientation and on-demand reading. “Work like a coding agent” does not justify banning injection. |
| **Codex** | Reads `AGENTS.md` as initial guidance and loads full skills when selected. Its optional local memory system generates files from eligible chats and can inject memories into later sessions; the documentation treats those files as generated state rather than the primary manual control surface. [Instructions](https://developers.openai.com/codex/guides/agents-md), [skills](https://developers.openai.com/codex/skills), [memories](https://learn.chatgpt.com/docs/customization/memories). | Files can serve as instructions, editable records, or generated memory. Their extension does not determine their authority or editing contract. |
| **Letta Code MemFS** | In February 2026, Letta introduced git-backed context repositories, expanding memory manipulation from specialized tools to ordinary file and terminal operations. Current MemFS projects the repository onto the working computer; `system/` files enter the prompt automatically, while other files are read as needed. Commits provide history and synchronization. [Introduction](https://www.letta.com/blog/context-repositories/), [MemFS](https://docs.letta.com/concepts/memfs). | This is strong evidence for Tim’s composable-access rationale. It also separates the filesystem interface from persistence and context delivery. Git-backed memory would require additional work to meet Jezo’s deletion promise. |
| **basic-memory** | Markdown is authoritative; a secondary database supplies graph queries and search. MCP tools, a CLI, and file watching provide multiple ways to work with the same knowledge. [Architecture](https://docs.basicmemory.com/reference/technical-information). | Specialized tools can complement authoritative files. There is no need to choose between them. |
| **ReMe** | Explicitly describes user-owned source and memory files as authoritative, with rebuildable indexes and snapshots. It provides automatic memory processing as well as file-based retrieval. [Memory as File](https://github.com/agentscope-ai/ReMe/blob/main/docs/en/memory_as_file.md), [project](https://github.com/agentscope-ai/ReMe). | Memory can legitimately remain file-based. “It is memory” is not sufficient reason either to require files or to exempt it. |
| **nanobot** | Its current architecture distinguishes session JSONL, durable memory files, and consolidation history. Its memory skill directs the active agent to search history while leaving certain memory files to the Dream consolidation mechanism. [Architecture](https://github.com/HKUDS/nanobot/blob/main/docs/architecture.md), [memory skill](https://github.com/HKUDS/nanobot/blob/main/nanobot/skills/memory/SKILL.md). | Even a lightweight personal agent can distinguish readable files from files intended for arbitrary direct editing. |

Two conclusions follow from this comparison.

First, **the durable distinction is between authoritative data and derived representations**, not text and SQLite. A database can be authoritative; a markdown file can be generated or stale. (inference)

Second, **the agent’s interface and the storage engine should be evaluated separately**. A documented CLI, a skill calling an existing API, or a plugin tool can provide broad access without exposing internal storage details. An EventKit binding is necessarily integration code; calling it an “adapter” does not establish whether it is needless complexity. The relevant question is whether Jezo duplicates domain behavior or creates a narrow route that only its prompt-building code can use. (inference)

The options have materially different effects on future contributors:

| Option | What it protects | What it lets drift or makes difficult | Guidance to a new plugin author |
|---|---|---|---|
| **(a) Keep a strict principle** | Maximum consistency and direct inspectability, if explicitly defined as text authority plus direct editing. | Difficult fits for external authorities, transactional updates, dense logs, secrets, and automatic context. If “strict” means only “inside the directory,” it permits SQLite and says little about these concerns. | “Use the standard editable files and derived indexes; redesign anything that does not fit.” Clear, but potentially expensive. |
| **(b) Keep the current principle with its rationale and exception** | Preserves today’s direction and makes room for memory and other plugin stores. | “Own mechanism” is an unrestricted exception in practice. The context-injection language still conflicts with deliberate behavior. Backup, undo, deletion, and GUI responsibilities remain unspecified. | “Prefer editable files; otherwise claim a plugin-specific mechanism.” Contributors can reach opposite decisions while both following the text. |
| **(c) Reduce the principle to ownership/access; make storage a recommendation** | Protects user outcomes and allows implementation changes. | A weak recommendation can yield scattered state, partial exports, GUI-only capabilities, and inconsistent plugin behavior. | “Choose what fits; satisfy broad ownership goals.” Better than the current ambiguity, but incomplete without concrete obligations. |
| **(d) Split principles, architectural requirements, and defaults** | Protects ownership and agent capability permanently; preserves a clear local home and shared plugin responsibilities today. | Formats and context strategies may evolve. The project must maintain and enforce a small operational contract. | “Name the authority. Keep local durable data in the workspace. Start with standard files. Choose another store for a stated reason and meet the same access, backup, deletion, recovery, and undo obligations.” |

These assessments are **(inference)**.

I choose **(d)** because the user returning after two weeks needs their records to remain understandable, current, recoverable, and available to the agent. They do not benefit from the agent hand-editing a format when a tool would perform the operation more reliably. They do benefit from being able to leave Jezo, inspect what it keeps, and avoid having their life trapped behind a service. (inference)

This also keeps the original architectural advantage: plugins expose useful data and operations to the agent, so the central application does not need a new prompt-injection routine for every feature. But it allows a small startup digest and memory recall where those improve the experience. (inference)

**For `AGENTS.md`, I would replace principle 1 with these two principles and renumber the rest:**

```markdown
1. **The user owns their data.** Jezo keeps their data on their machine unless they choose otherwise. They can see what it keeps, correct it, back it up, take it elsewhere, and delete it. Using Jezo must not depend on a company account.

2. **The agent can work with the data.** Give it files and tools it can discover and use. It must be able to find what it needs, check its work, and make changes beyond the cases we anticipated. What we put in its context must not be its only way to reach the data.
```

This wording deliberately leaves directory layout, formats, indexing, and context construction to design documents. It retains the reason behind “bash unification” without making a particular harness strategy permanent.

**For `storage.md`, I would use the following as the decision text.** It describes the proposed contract; several obligations, especially permanent removal and database-plugin undo, are not implemented today. Keep the research and measurements after it, correcting the Logseq, sync, deletion, and crash-recovery claims identified above.

```markdown
# Storage

Status: proposed on 2026-09-30. This keeps the current storage formats
and separates the workspace contract from format and agent-access
choices.

## Decision

The workspace is the home of Jezo's durable local data. Each plugin
keeps the data it owns in its directory. Shared records, such as
conversations, have a documented location in the workspace.

A plugin may use text files, SQLite, or another suitable local format.
Its choice must preserve the user's ability to inspect, correct,
back up, export, and delete its data, and the agent's ability to work
with it.

The workspace is authoritative for records Jezo owns. Connected
services remain authoritative for their records unless the user
explicitly imports them as independent local records.

Every stored representation must have a clear role: authoritative
data, a copy of an external source, derived data, or temporary state.
Two representations must not silently compete to be authoritative.

## Default formats

Keep the current markdown files with frontmatter for todos, goals,
notes, and memory. Keep pi's JSONL format for conversations.

Prefer directly editable text for records that people or the agent
benefit from reading and changing: markdown for prose, structured
fields for queryable values, JSONL for modest event logs, and YAML
for layouts and configuration.

Use a different format when it makes the plugin simpler or more
reliable for its actual workload. Transactions, frequent updates,
large numeric series, and reuse of an existing storage engine are
valid reasons. Being a plugin is not itself a reason.

Record the reason and the authority in the plugin's design document.
Do not maintain an editable text mirror solely to make a database
look file-based.

## Access through the GUI and agent

Every plugin exposes its user-facing data and operations in the GUI.
It also gives the agent discoverable ways to search, inspect, change,
and verify that data.

Files, command-line tools, skills, and registered tools are all valid
access methods. Reuse the plugin's operations across these entry
points rather than implementing their behavior separately.

For the standard item files, direct editing remains supported.
Provide compact queries and simple structured tools for common work.
Tools should return the resulting state or a useful error.

A plugin with another store supplies the access it needs, including
queries and bulk operations where appropriate. It must not leave
the agent dependent on a fixed summary assembled by the host.

## Checks and recovery

Validate normal writes before accepting them. Detect outside edits,
report invalid records, and preserve the user's content so it can
be repaired.

Use atomic replacement for individual text files. When several
changes must agree, define how the operation completes or recovers
after interruption.

A saved conversation helps resume work. It does not replace a
transaction or prove whether an external action happened.

## Context

Jezo may supply a small digest and plugins may supply selected
context automatically. These are views of stored records, not
another place to keep facts.

Keep supplied context bounded and identify its sources and freshness.
The agent must be able to inspect the underlying records and fetch
more when needed. Preserve the origin of outside content.

A generated file may expose the same view when useful. Generating
one is not required before adding the view to context.

## Indexes and other copies

Search indexes, embeddings, and ordinary connector caches are
derived data. Their loss must not lose unique user work.

Document how they are rebuilt and whether rebuilding requires
network access, a model, or substantial time. Remove or invalidate
their copies when source data is deleted.

Pending connector changes and local annotations are durable data,
even when stored beside a disposable mirror.

Credentials stay in OS-backed secure storage. Temporary window
state and machine settings may live in app data. These locations
must not hold the only copy of a durable user record.

## Backup and export

A backup must restore the authoritative local records, attachments,
relationships, and pending work. Plugins must support a consistent
backup while Jezo coordinates writes.

Use database-supported snapshots for live databases. Copying a
changing directory is not the backup contract.

Exports must preserve the meaning of the data, including identifiers,
relationships, units, and time information. State any limitations.
A readable summary is not a complete export.

Credentials are excluded from ordinary workspace exports. Restoring
on another machine may require reconnecting services.

## Undo and deletion

Plugins must support undo for local changes made by the agent without
overwriting later user changes. The current file comparison works
for standard item files. Other stores need an appropriate equivalent;
restoring an entire live database is not that equivalent.

Ordinary deletion removes a record from active use and may retain
a clearly disclosed, time-limited undo copy. The user can permanently
remove it without waiting for that period.

Permanent removal covers retained content in stores Jezo controls,
including undo, derived indexes, and managed history. Explain any
remaining copies in connected services, user-managed git history,
exports, or backups.

Forgetting a fact and deleting every record containing it are
different operations. Any retained information used to prevent
relearning must be minimal and disclosed. A hash is still retained
information.

Losing undo history is acceptable. Forgetting to delete its private
content is not.

## Sync and outside tools

External editing is supported for the standard editable files.
Detect changes, preserve content, and show conflicts in the GUI.

Do not treat a synchronized folder as a general database replication
mechanism. Support for iCloud, Dropbox, or another sync service must
be established for the stores involved. Preserve conflict copies
until they are resolved.

A phone that edits independently while offline requires a separate
sync design covering concurrent changes and deletion. The workspace
layout does not decide that design.

## Choosing storage for a new plugin

Before adding a store, document:

- Which records the plugin owns and which come from another source.
- Where durable data lives and what can be rebuilt.
- How the GUI and agent inspect and change it.
- How backup, export, deletion, undo, and interrupted writes work.

Use the existing file path when it meets the need. Introduce another
store when a concrete requirement justifies its additional work.

These are responsibilities, not a requirement to build a general
storage framework before a second implementation needs one.

Measure complete application behavior before changing storage for
scale. Include startup, search, outside edits, GUI responsiveness,
backup, and recovery at representative sizes.
```

I would also revise the related passages in `memory.md`, `backend.md`, and `undo.md` when this decision is adopted. Otherwise a contributor will still encounter contradictory promises. In particular, permitting SQLite does not make the current file-oriented GUI and undo support transfer automatically to a new memory store. (inference)

**Two answers from Tim could change the recommendation:**

1. **Is editing Jezo’s core records in Obsidian or another ordinary editor a supported product promise, or mainly an escape hatch?** If it is a defining promise, I would explicitly protect authoritative, directly editable files for those core records in `AGENTS.md`. If it is an escape hatch, complete export and broad tool access leave more room for database storage.

2. **Must the future phone work independently offline and merge changes made while the desktop also works?** If yes, I would make replication semantics an architectural decision now, before more plugins establish incompatible assumptions. That could favor transactional storage or operation logs for structured records sooner. If a remote client is sufficient, the present file architecture has much more room to grow.
