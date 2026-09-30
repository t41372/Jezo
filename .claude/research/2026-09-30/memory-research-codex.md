**Recommendation: build a small, file-backed TypeScript pi extension for Jezo’s default memory.** Keep extraction and consolidation in editable skills, and make retrieval replaceable. **ReMe is the strongest reusable alternative to investigate; Basic Memory is the most established file-based comparator.** Neither has a verified guarantee covering Jezo’s complete deletion requirement.

Research cutoff: **29 September 2026**. This was read-only; I modified no repository files and did not install systems or rerun benchmarks. Documented behavior is identified below; recommendations are my inference. **“Unverified” means I could not establish the property from the inspected sources.**

## 1. The 2026 landscape

### Corrections to the earlier findings

- **pi-hermes-memory:** SQLite authority in default `policy-only` mode is confirmed. However, the current configuration defaults to **in-process `direct` review transport**, with subprocess fallback; “consolidation always requires a pi subprocess” is outdated. Its flat records and authority model still make it unsuitable as-is. [README](https://github.com/chandra447/pi-hermes-memory), [configuration source](https://github.com/chandra447/pi-hermes-memory/blob/main/src/config.ts).
- **Hindsight:** Docker is optional; packaged embedded operation exists. Nevertheless, its default embedded database is **PostgreSQL via pg0**, which still violates Jezo’s stated database restriction. Individual facts support editing/invalidation, while observations regenerate from underlying facts; the documented individual-memory interface lacks hard deletion of a fact. [Embedded operation](https://github.com/vectorize-io/hindsight#python-embedded-no-server-required), [storage](https://hindsight.vectorize.io/developer/storage), [curation](https://hindsight.vectorize.io/developer/api/memories).
- **OpenClaw:** “deletion weak” needs qualification. It now tracks session lineage, purges attributable artifacts, and prevents forgotten sessions from later ingestion. Its documentation explicitly excludes original transcripts and some direct/freeform edits. The earlier **38,000-line estimate and current 0.7/0.3 retrieval weights are unverified**; current documentation specifies MMR λ=0.7 separately. [Deletion boundaries](https://docs.openclaw.ai/concepts/memory-provenance), [search](https://docs.openclaw.ai/concepts/memory-search).

### Libraries and services

In the tables, **W/R** means additional generative-model calls during writing/retrieval, excluding the final answer and embedding inference. “Variable” means pipeline-dependent; exact counts are **unverified** unless stated. CRUD deletion alone does **not** establish protection against re-extraction.

| System | Architecture, storage, runtime | W/R | Lifecycle, provenance, maturity and license |
|---|---|---|---|
| **Mem0** | Embedded Python and TS libraries; Python defaults to local Qdrant plus SQLite history, TS to in-memory vectors plus SQLite history. Current algorithm extracts additive facts and combines semantic, lexical and entity signals. | Current extraction: **1**; ordinary retrieval: **0**, optional reranking extra. | ID deletion/update exists. Current ADD-only extraction retains competing facts rather than automatically replacing them. Metadata and temporal retrieval exist; enforced stated/inferred separation and replay suppression are unverified. Active, Apache-2.0. [Repository](https://github.com/mem0ai/mem0), [Python defaults](https://docs.mem0.ai/open-source/python-quickstart), [TS defaults](https://docs.mem0.ai/open-source/node-quickstart), [delete implementation](https://github.com/mem0ai/mem0/blob/main/mem0/memory/main.py). |
| **OpenMemory / LongMemory** | Names are ambiguous: current `mem0ai/openmemory` is a session-porting CLI. Cavira’s OpenMemory redirects to **LongMemory**, an embedded TS temporal graph with SQLite/in-memory storage. | Core avoids generative extraction; optional grounded answering uses ≤1 call. | Immutable content/provenance, valid versus recorded time, confidence and supersession concepts. Hard deletion is absent from the inspected public interface; broader purge support is unverified. Apache-2.0; substantial rewrite with inconsistent architecture documentation. [Mem0 CLI](https://github.com/mem0ai/openmemory), [LongMemory](https://github.com/CaviraOSS/LongMemory), [public interface](https://github.com/CaviraOSS/LongMemory/blob/main/src/core/create_memory.ts), [stale architecture page](https://github.com/CaviraOSS/LongMemory/blob/main/docs/architecture.md). |
| **Letta / MemGPT** | Historically hierarchical core/archival memory. Current development moved to **Letta Code**, a TS agent harness with local backend and git-backed **MemFS**. | Variable agent writes/dreaming; retrieval can involve multiple agent calls. | Editable memory blocks/files and learning workflows. Git preserves deleted content unless purged. Evidence/confidence/validity schemas are application-defined. Active, Apache-2.0; replacing pi would be a harness change. [Repository transition](https://github.com/letta-ai/letta), [current harness](https://github.com/letta-ai/letta-code), [memory](https://docs.letta.com/configuration/memory), [license](https://github.com/letta-ai/letta-code/blob/main/LICENSE). |
| **Zep / Graphiti** | Zep is managed infrastructure; Graphiti is its Apache-2.0 Python temporal-graph framework. Neo4j/FalkorDB are usual backends; **FalkorDB Lite supports embedded operation**. Kuzu is deprecated. | Multiple extraction/resolution passes; search can be **0**, optional model reranking extra. | Strong episode provenance and validity intervals; supersession invalidates historical edges. Episode deletion exists; permanent claim suppression and stated/inferred distinction are unverified. Active packaged framework. [Architecture/runtime](https://github.com/getzep/graphiti), [license](https://github.com/getzep/graphiti/blob/main/LICENSE). |
| **Cognee** | Python library: searchable chunks plus extracted graph. Local defaults include SQLite, LanceDB and embedded Ladybug/Kuzu. Recent keyless mode uses local GLiNER extraction. | Keyless ingestion/search: **0 generative calls**; LLM enrichment variable. | Document ownership tracks derived nodes/edges; `forget` clears affected graph/vector/cache state but preserves raw files. Stated/inferred separation and permanent replay suppression are unverified. Active Apache-2.0, with some commercial features. [Current pipeline](https://github.com/topoteretes/cognee), [storage](https://docs.cognee.ai/setup-configuration/graph-stores), [forget](https://docs.cognee.ai/core-concepts/main-operations/forget), [license](https://github.com/topoteretes/cognee/blob/main/LICENSE). |
| **LangMem** | Python extraction, memory-management and prompt-learning library; storage-independent core, usually integrated with LangGraph stores. | Variable structured extraction/refinement; plain store search **0**. | Custom schemas can express evidence, confidence and validity; insert/update/delete operations supported. These policies are supplied by the application, including durable forgetting. MIT; usable library rather than complete product. [Repository](https://github.com/langchain-ai/langmem), [storage-free extraction](https://langchain-ai.github.io/langmem/guides/extract_semantic_memories/). |
| **A-MEM** | Python research implementation: Zettelkasten-style notes, ChromaDB embeddings, model-generated tags/context and evolving links. | Multiple write/evolution calls; vector retrieval itself **0**. | Timestamps and flexible metadata; durable deletion, evidence lineage and temporal supersession guarantees unverified. MIT; research artifact. [Code](https://github.com/agiresearch/A-mem), [paper](https://arxiv.org/abs/2502.12110). |
| **MemoryOS** | Python hierarchical short-, mid- and long-term persona memory; local storage path, with a Chroma variant. FIFO/“heat” thresholds trigger summarization and profile updates. | Deferred variable write calls; retrieval separate from answer generation. | Updates profiles and knowledge, but strict provenance, stated/inferred classification and replay-safe deletion are unverified. Apache-2.0; EMNLP 2025 research implementation with packaged APIs. [Repository](https://github.com/BAI-LAB/MemoryOS), [paper](https://arxiv.org/abs/2506.06326). |
| **MemOS** | Main self-hosted system uses Neo4j/Qdrant; separate **local TS plugin** uses SQLite, FTS5/vector retrieval and skill evolution. | Local dedup may invoke a model; summaries/evolution variable; ordinary retrieval **0**. | Local viewer supports CRUD and merge history. File authority, permanent deletion suppression and inference typing are unverified. Apache-2.0; actively expanding. Local plugin documents opt-out telemetry. [Main/runtime split](https://github.com/MemTensor/MemOS), [local implementation](https://github.com/MemTensor/MemOS/tree/main/apps/memos-local-plugin), [earlier local documentation](https://github.com/MemTensor/MemOS/tree/main/apps/memos-local-openclaw). |
| **Memobase** | User profiles plus dated events; buffered extraction/merging. FastAPI, PostgreSQL and Redis service. | Version 0.0.40 documents **3 calls per processing run**; retrieval mainly lookup/embedding. | Time-aware events and configurable profile topics; exact deletion cascades, statement/inference distinction and replay suppression unverified. Apache-2.0; maintainers also promote successor Acontext. [Repository](https://github.com/memodb-io/memobase). |
| **Supermemory** | Extracted facts, profiles, graph relationships and hybrid retrieval. Now offers a local server binary with embedded engine and local embeddings, plus hosted service. | Extraction variable; exact read/write call counts unverified. | Updates/contradictions/expiration and document APIs; Jezo-grade per-claim forgetting and file reconstruction unverified. Repository MIT; production uses proprietary tuned models. No documented drop-in embedded memory-library boundary verified. [Repository](https://github.com/supermemoryai/supermemory), [local deployment](https://supermemory.ai/docs/self-hosting/quickstart), [license](https://github.com/supermemoryai/supermemory/blob/main/LICENSE). |
| **Basic Memory** | Python library/MCP process: Markdown observations/wikilinks, SQLite indexes, optional local semantic search/reranking. | Direct file writes/search: **0**; host agent synthesizes content. | Files are durable memory; note deletion exists. Source links/categories possible, but validity and inference policies are not enforced, and replay suppression is unverified. Established releases; current license **AGPL-3.0**. Automatic updates/telemetry need disabling. [Repository](https://github.com/basicmachines-co/basic-memory), [architecture](https://github.com/basicmachines-co/basic-memory/blob/main/docs/ARCHITECTURE.md), [license](https://github.com/basicmachines-co/basic-memory/blob/main/LICENSE). |
| **Hindsight** | Retain/recall/reflect; facts, experiences and derived observations, with semantic, lexical, temporal and graph retrieval. Python packaged runtime; PostgreSQL/pg0. | Extraction per chunk plus consolidation; recall primarily non-generative; reflect variable. | Strong source/document links and distinction between facts and derived observations, though not identical to Jezo’s stated/inferred contract. Invalidation preserves audit data; observations regenerate. MIT, active product. [Repository](https://github.com/vectorize-io/hindsight), [memory curation](https://hindsight.vectorize.io/developer/api/memories). |
| **Honcho** | Peer-centric messages, representations and reasoning chains; FastAPI plus background workers, PostgreSQL/pgvector. | Background derivation/dreaming variable; direct search **0**, dialectic chat variable. | Explicit reasoning from statements to conclusions is philosophically relevant. Exact claim deletion cascades and replay suppression unverified; default models include cloud providers. Active AGPL-3.0 service. [Repository](https://github.com/plastic-labs/honcho), [reasoning design](https://github.com/plastic-labs/honcho/blob/main/docs/v3/documentation/core-concepts/reasoning.mdx). |
| **ReMe** | Current Python implementation is **file-native**: session/resource → daily → digest; rebuildable indexes, BM25, optional vectors and wikilink expansion. Embeddable Python API. | File operations/search **0**; capture/dreaming variable. | Sources sections and preserved frontmatter support adaptation. File deletion returns remaining inbound links; permanent suppression and enforced inference/validity semantics unverified. Apache-2.0; active 2026 releases. [Repository](https://github.com/agentscope-ai/ReMe), [file contract](https://reme.agentscope.io/en/memory_as_file), [delete operation](https://github.com/agentscope-ai/ReMe/blob/main/reme/config/default.yaml). |
| **memU** | Current design lets the host agent produce wiki/skill Markdown, then commits it through Python `MemoryService`; local default storage is SQLite. | Library chat calls **0**; host synthesis variable. | Supports pi adapter and local embedding configuration. Markdown content is not necessarily authoritative workspace files; full deletion, provenance and temporal guarantees unverified. Apache-2.0; substantially evolved project. [Current design](https://github.com/NevaMind-AI/memU). |
| **Memori** | TS/Python interception/capture SDK, structured SQL memory, including SQLite; advanced augmentation is a cloud feature available by default. | Augmentation variable; exact counts unverified. | Attribution by entity/process/session; file authority and durable forgetting unverified. Apache-2.0, active. Default cloud augmentation conflicts with Jezo’s network principle. [Repository](https://github.com/MemoriLabs/Memori), [reported local/cloud boundary issue](https://github.com/MemoriLabs/Memori/issues/590). |
| **memweave** | Small Python library: authoritative Markdown, SQLite FTS5/vector cache, hybrid ranking and temporal decay. | **0/0**, plus embeddings. | Good retrieval building block; epistemic schemas, supersession and permanent forgetting must be supplied. MIT; young project. [Repository](https://github.com/sachinsharma9780/memweave), [license](https://github.com/sachinsharma9780/memweave/blob/main/LICENSE). |

Further serious research options include **SimpleMem**—Python/LanceDB semantic compression and adaptive retrieval; **LightMem**—Python with local Qdrant/FAISS/BM25 and deferred updating; and **GAM**—a file-system memorizer plus iterative researcher. All are MIT research implementations; their full deletion/provenance contracts are **unverified**. **LeanMem**’s August 2026 profile/event/source-record separation is particularly relevant, but a maintained distributable package and code license are **unverified**. [SimpleMem](https://github.com/aiming-lab/SimpleMem), [LightMem](https://github.com/zjunlp/LightMem), [GAM](https://github.com/VectorSpaceLab/general-agentic-memory), [LeanMem](https://arxiv.org/abs/2608.03463).

### Agent and product memory designs

| System | Observed design and relevant limitation |
|---|---|
| **OpenClaw** | Markdown core/daily memory, SQLite hybrid search, recency/importance ranking, MMR, dreaming and structured wiki claims. Host-recorded lineage survives consolidation, but some lineage resides in SQLite. MIT; active host-coupled implementation, not a standalone pi library. No comparable independent personal-agent benchmark verified. [Overview](https://docs.openclaw.ai/concepts/memory), [claims](https://docs.openclaw.ai/plugins/memory-wiki), [lineage](https://docs.openclaw.ai/concepts/memory-provenance), [license](https://github.com/openclaw/openclaw/blob/main/LICENSE). |
| **Hermes** | Bounded `MEMORY.md`/`USER.md`, frozen session snapshot, add/replace/remove, provider boundary and FTS5 session search. Direct memory operations add no extraction call; reviews/search summarization can. MIT; durable suppression and structured inference provenance unverified. [Memory](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory), [repository](https://github.com/NousResearch/hermes-agent). |
| **Claude / Claude Code** | Claude’s current product has editable/deletable memory topics and cited past-chat search; deleting a chat does not automatically delete its memories. Claude Code stores agent-written files and loads the first 200 lines or 25KB of its memory index. Permanent re-extraction suppression unverified. [Claude controls](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context), [Code memory](https://code.claude.com/docs/en/memory). |
| **ChatGPT** | Memory can draw from saved information, chats, files and connected apps. Controls vary; turning memory off leaves chats, which can later produce memories again. Backend architecture/call counts are unverified. [Current documentation](https://help.openai.com/en/articles/8590148-memory-in-chatgpt). |
| **Gemini** | Past-chat personalization, correction in conversation, and deletion through original chats. Connected-app facts require removing chats and disconnecting the source; propagation may be delayed. Internal architecture/call counts unverified. [Official controls](https://support.google.com/gemini/answer/16598469?hl=en). |
| **Codex / Cursor** | Codex’s public implementation has rollout summaries/raw memories followed by consolidation into `MEMORY.md`, summary and skills; its memory directory is git-backed. Cursor’s earlier Chat memories used background extraction/approval; current desktop availability is unverified. Automation memories are named entries outside the working filesystem. [Codex consolidation](https://github.com/openai/codex/blob/main/codex-rs/memories/write/templates/memories/consolidation.md), [Cursor earlier design](https://docs.cursor.com/en/context/memories), [automation memory](https://cursor.com/docs/cloud-agent/automations). |

### Benchmark claims

These are **author/vendor reports, not a common leaderboard**:

| System | Representative report and qualification |
|---|---|
| Mem0 | **94.4 LongMemEval; 92.5 LoCoMo**, explicitly for the managed platform with proprietary optimizations—not identical OSS behavior. [Current results](https://github.com/mem0ai/mem0#new-memory-algorithm-april-2026). |
| Hindsight | Paper reports **83.6% with an open 20B model**, versus 39% full-context baseline. Repository claims reproduction by research collaborators; independently published reproduction evidence is **unverified** here. [Paper](https://arxiv.org/abs/2512.12818), [reproduction claim](https://github.com/vectorize-io/hindsight#memory-performance--accuracy). |
| Honcho / MemOS / ReMe | Respectively report **90.4%**, **89.2%**, **89.4%** LongMemEval settings. Models, prompting and harnesses differ. [Honcho](https://honcho.dev/evals/), [MemOS](https://github.com/MemTensor/MemOS#-performance), [ReMe](https://reme.agentscope.io/en/benchmarks/longmemeval). |
| Zep / MemoryOS | Zep reports DMR **94.8%** and up to **18.5% improvement** on LongMemEval; MemoryOS reports **49.11% relative F1 improvement**, not 49.11% accuracy. [Zep paper](https://arxiv.org/abs/2501.13956), [MemoryOS paper](https://arxiv.org/abs/2506.06326). |
| Others | Supermemory’s **95% Recall@15** and memweave’s **98% Recall@5** measure retrieval, not answer correctness. Cognee’s exploratory 10M BEAM score used routing selected on the scored questions. [Supermemory](https://github.com/supermemoryai/supermemory), [memweave](https://github.com/sachinsharma9780/memweave), [Cognee limitations](https://github.com/topoteretes/cognee#benchmarks-and-research). |

## 2. What surveys, benchmarks and community evidence support

The January 2026 **Memory in the Age of AI Agents** survey distinguishes factual, experiential and working memory, and formation, evolution and retrieval. The May **From Storage to Experience** survey distinguishes preserved trajectories, reflection and reusable experience. These taxonomies are useful; neither establishes one universally best implementation. [First survey](https://arxiv.org/abs/2512.13564), [second survey](https://arxiv.org/abs/2605.06716).

**Extraction versus raw retrieval remains a tradeoff.** Extraction reduces repeated context and makes stable preferences accessible, but discards details and can invent abstractions. A March 2026 comparison found full-context GPT-5-mini outperforming its Mem0-based extraction pipeline, while memory became cheaper over repeated queries. That evaluates a particular extraction/model stack, not current Mem0 generally. LeanMem instead preserves detailed source records alongside compact profiles and temporal events. **My inference:** Jezo should combine curated claims with source retrieval. [Comparison](https://arxiv.org/html/2603.04814v1), [LeanMem](https://arxiv.org/html/2608.03463v1).

**Graphs help relationships and temporal history; graph databases are optional.** Graphiti demonstrates explicit validity and episode lineage. Jezo already has people, tasks, goals and calendars as entities: IDs plus evidence/supersession edges can provide the needed graph in files and SQLite. A graph-first extractor adds entity-resolution errors and model work before its benefit is established. [Graphiti](https://github.com/getzep/graphiti).

**Reflection has value, but repeated rewriting is risky.** Sleep-time research explores moving useful computation outside the response path; LightMem and LeanMem defer or selectively update memories. For Jezo, review changed evidence rather than repeatedly summarizing everything. Consolidation must preserve lineage and uncertainty. [Sleep-time compute](https://arxiv.org/abs/2504.13171), [LightMem](https://github.com/zjunlp/LightMem), [LeanMem](https://arxiv.org/abs/2608.03463).

**Hybrid retrieval is the strongest practical starting point.** Contemporary implementations combine lexical and semantic retrieval. Recency should affect transient episodes, not silently invalidate stable preferences; expiration/supersession should determine validity. OpenClaw’s evergreen curated files and decaying daily notes illustrate this distinction. [Search implementation](https://docs.openclaw.ai/concepts/memory-search).

**Long context and files are real baselines.** Letta reported 74% LoCoMo using files—but those files were embedded and searched through iterative agent tools, not simply dumped into context. BEAM shows difficulty even at million-token contexts. [Letta experiment](https://www.letta.com/blog/benchmarking-ai-agent-memory/), [BEAM](https://github.com/mohammadtavakoli78/BEAM).

Benchmark discipline matters: LongMemEval tests extraction, updates, temporal reasoning, multi-session synthesis and abstention; use its cleaned data. LoCoMo has only ten released conversation histories. MemoryAgentBench adds incremental learning/forgetting; HaluMem evaluates memory-operation hallucinations. [LongMemEval](https://github.com/xiaowu0162/LongMemEval), [LoCoMo](https://github.com/snap-research/locomo), [MemoryAgentBench](https://github.com/HUST-AI-HYZ/MemoryAgentBench), [HaluMem](https://github.com/MemTensor/HaluMem).

Community discussion favors debuggability, hybrid search and inspectable files, but there is **no established community consensus** on a winner. LocalLLaMA posts report semantic-only failures and noisy raw logs; other participants remain unconvinced by available systems. HN debates schema versus freeform memory, while Letta’s X posts promote MemFS. These are anecdotes or advocacy. Claims about defective LoCoMo answers/judges remain **unverified independently here**. [Engineering discussion](https://www.reddit.com/r/LocalLLaMA/comments/1r21ojm/weve_built_memory_into_4_different_agent_systems/), [current-memory discussion](https://www.reddit.com/r/LocalLLaMA/comments/1uqfh7r/what_is_the_current_memory_meta/), [HN](https://news.ycombinator.com/item?id=41447317), [X](https://x.com/Letta_AI/status/2022082574374555736), [benchmark criticism](https://www.reddit.com/r/LocalLLaMA/comments/1s1jb94/we_audited_locomo_64_of_the_answer_key_is_wrong/).

## 3. Which options fit Jezo?

**No surveyed option is verified to satisfy all eight principles as-is.** Several satisfy runtime requirements; durable forgetting, trusted provenance and epistemic classification remain application work.

My ranking of reusable candidates:

1. **ReMe:** closest overall architecture, permissive license, editable metadata, embedded Python. A thin adapter closes pi integration and schema mapping; deletion admission, source authenticity and active-context invalidation require substantive host logic.
2. **Basic Memory:** strong file/index precedent and mature note tooling. Similar adapter gaps, plus AGPL compatibility and disabling updates/telemetry. Its conventions need mapping to Jezo’s immutable IDs.
3. **memweave:** smallest retrieval component to reuse or port. Most lifecycle policy belongs in Jezo—which is useful if that policy must remain swappable.
4. **LangMem:** suitable optional extraction engine behind Jezo-owned files; avoid inheriting LangGraph as the application architecture.
5. **Cognee / Graphiti Lite:** runtime-compatible experiments, but heavier packaging, extraction and graph lifecycle. A file-authoritative adapter would be substantial.
6. **LongMemory / MemOS local / memU:** embedded paths exist, but database authority or insufficiently verified deletion semantics make adoption premature.

These rankings are engineering judgments based on the linked architectures above, not measured Jezo performance.

Hindsight, Honcho and Memobase fail the database/default-deployment constraint. Letta changes the agent harness. Supermemory’s local server is an improvement over hosted-only deployment, but its documented integration does not meet the desired in-process pi-extension boundary.

## 4. Recommended pi-extension design

Everything in this section is a proposed design.

### Files and authority

Keep **one atomic claim per file**, with original tasks/events remaining in their existing directories:

```yaml
---
id: mem_01…
kind: preference
epistemic: stated
status: active
key: planning.preferred_time
recorded_at: 2026-09-29T18:00:00Z
valid_from: 2026-09-29
valid_until: null
source_refs: [session:s123:message:m45]
derived_from: []
supersedes: [mem_00…]
---
I prefer planning after breakfast.
```

Inference records additionally require evidence IDs, confidence and its basis. Display model confidence as **an uncalibrated assessment**, not a probability. Preserve qualifications: “missed two gym sessions” supports an observation; it does not establish a personality trait.

Use host-minted source records containing speaker, origin, timestamp and content hash. The model proposes references; the host resolves and stamps provenance. Direct edits remain allowed, but unsupported provenance becomes **unverified**, not trusted.

SQLite contains only disposable entity maps, FTS5, embeddings and dependency indexes. Rebuilding must require no generative calls. This aligns with Jezo’s existing [storage decision](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/storage.md).

### Retrieval and tools

Start with **FTS5**, then add optional local embeddings and reciprocal-rank fusion. Prefer brute-force cosine at personal scale before introducing another vector engine. Store embedding model identity and dimensions; rebuild when either changes. Benchmark Chinese/English tokenization explicitly.

Expose:

- `remember`: propose a claim with evidence and epistemic type.
- `recall`: search, filter by validity/type/source, return IDs and bounded source excerpts.
- `forget`: invoke deterministic deletion and suppression.
- `supersede`: atomically close the previous validity interval and establish its replacement.
- GUI-backed `list/get`: inspect, correct, delete and open sources.

Return concrete write receipts so “I remembered that” cannot substitute for an actual save.

### Context and review timing

Inject approximately **600–1,000 tokens** of selected active user-stated preferences, current commitments and memory-use guidance. Keep methodological instructions in skills; inject memory claims as labeled data. Allow roughly **1,500–2,500 additional tokens** of query-selected evidence.

At `session_start`, load files/indexes. At `before_agent_start`, prepare relevant context; use `context` for request-local filtering. Capture durable evidence at `turn_end`; schedule review after settlement without extending the visible response. In installed pi 0.99.1, `agent_settled` is notification-only; continuation belongs at `turn_end` or `agent_before_settle`. [Extension contract](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

Persist explicit “remember” requests immediately. Run at most one batched extraction review for eligible new session material. Review changed claims during idle time or a weekly check-in; do not reconsolidate the entire archive nightly. Put these selection rules in editable `capture-memory` and `review-memory` skills.

### Durable deletion

Deletion must be a **persisted transaction**, not unlinking one file:

1. Write a workspace tombstone containing deleted IDs, source dependencies, relevant claim keys and deletion generation.
2. Purge claims, embeddings, dependent summaries, startup digests and controlled undo copies.
3. Block old extraction inputs and reject queued work created before the deletion generation.
4. Rebuild indexes and active memory context, then verify absence after restart and replay.

Hashes alone cannot block paraphrases. For a literal non-resurrection guarantee, retained source history must be redacted or excluded from agent retrieval/extraction—not merely omitted from the memory index. Where fine-grained source attribution is unreliable, exclude the whole implicated source session. Only an explicit owner action should lift suppression.

Do not promise erasure from user-controlled backups. OpenClaw’s documented coverage boundaries are a useful model for defining and testing the guarantee. [Lineage/purge design](https://docs.openclaw.ai/concepts/memory-provenance).

### Outside content and network behavior

Carry external/mixed provenance through every derivation. External content can supply evidence about an invitation or event; it cannot become a standing instruction merely because a summary sounds imperative. Owner confirmation can establish a preference without laundering its origin.

Labels and delimiters are not a security boundary. Enforce private-data egress and irreversible-action checks in the host. Persistent poisoning is experimentally demonstrated. [AgentPoison](https://arxiv.org/abs/2407.12784), [MemoryGraft](https://arxiv.org/abs/2512.16962).

Default to configured local models, no telemetry, no automatic downloads and no cloud fallback. Background cloud extraction requires explicit user configuration.

### Reuse, evaluation and swapping

Borrow narrowly: **OpenClaw’s MIT lineage/MMR concepts**, **Hermes’s MIT provider lifecycle**, **memweave’s MIT retrieval/cache patterns**, and **ReMe’s Apache-2.0 file/source conventions**. Preserve notices; avoid importing whole host SDKs.

Evaluate through real pi sessions with the actual local model:

- A fixed **50-question cleaned LongMemEval-S subset**, stratified across updates, temporal reasoning, synthesis and abstention, retaining full haystacks.
- **30 custom life histories**: changed schedules, two weeks away, cancellations, temporary preferences, ambiguous observations, external injection and deletion during queued consolidation.
- Baselines: no memory, small curated digest, FTS5 raw retrieval, hybrid retrieval, then extraction/consolidation.

Measure answer correctness, evidence recall, citation accuracy, unsupported inference rate, stale-preference use, deletion resurrection, latency, tokens and generative calls. Require **zero resurrection** on deterministic replay tests. Save transcripts, configuration/model versions, expected evidence and GUI screenshots as repeatable E2E artifacts.

Separate `MemoryStore`, `MemoryRetriever` and `MemoryPolicy`. Jezo owns files, IDs, provenance and deletion; backends return evidence or proposed mutations. Swapping retrieval or extraction must never transfer authority over those guarantees.

## 5. Final decision and top risks

| Choice | Decision |
|---|---|
| File-backed TS pi extension | **Default recommendation:** best architectural fit and smallest runtime footprint. |
| ReMe adapter | Best alternative to prototype against the same evaluation set. |
| Basic Memory adapter | Useful comparator; check license compatibility and disable network defaults. |
| memweave/LangMem components | Reuse selectively for retrieval or extraction. |
| Graph/service-heavy systems | Research comparators or explicitly requested integrations. |

The top risks are **semantic resurrection from retained history**, **unsupported personal inferences**, **stale preferences winning retrieval**, and **background extraction latency on local hardware**. Package churn and misleading benchmark comparisons add adoption risk.

For Jezo, the decisive test is whether it remembers accurately after two weeks away, accepts correction, and forgets reliably. Build and evaluate those lifecycle guarantees before adding richer graphs or more reflection.

Codex session ID: 01a0eff8-4c9e-76c3-8355-d035bda6fff7
Resume in Codex: codex resume 01a0eff8-4c9e-76c3-8355-d035bda6fff7
