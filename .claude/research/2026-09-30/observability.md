**Recommendation (inference): build a small developer view over pi’s session JSONL, add structured memory-decision events, and run a local regression suite through the real Jezo agent. Add optional OpenTelemetry export afterward.** For external inspection, start with **otel-desktop-viewer**; use **Langfuse** if you want a full experiment platform, or **Phoenix/MLflow** if avoiding Docker matters.

The important finding is that **pi 0.99.1 already records more of the prompt than the brief assumes**. Jezo does not need a second transcript system just to answer what memory the model received.

**1. What Jezo already records—and what is missing**

The checked-out application requests pi `^0.99.1`, and the installed SDK is `0.99.1`. Its session format persists the initial system-prompt sections and tool declarations, then subsequent changes as system-message patches. Compaction can include a complete prompt/tool checkpoint. Jezo assigns its memory text to `systemPromptOptions.sections.memory`, using precisely this mechanism. Consequently, a branch-aware reader should be able to reconstruct the memory section for recorded requests; older sessions without these entries remain incomplete. [Package configuration](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/package.json:43), [installed session-format documentation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md), [memory injection](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/index.ts:51).

Several details materially affect the proposed investigation:

| Finding in the checked-out code | Implication for observability |
|---|---|
| The default `2400` budget counts memory-line characters. Policy, headings, separators, and request-relevant additions are outside it. The extension appends up to five relevant memories after excluding already-selected IDs. | **Measure the assembled memory section and actual request tokens**, not just the configured budget. [Context selection](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/memory.ts:330), [additional recall](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/index.ts:55). |
| Selection stops at the first candidate that exceeds the budget. Related-save detection uses character-bigram Dice similarity, threshold `0.25`, returning at most three candidates. | Record selection exclusions and similarity scores. Otherwise a trace cannot distinguish policy failure from candidate-selection failure. [Implementation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/memory.ts:288). |
| Recall results, save arguments, successful IDs, and refusals pass through ordinary tool calls/results. | Much of the raw evidence already belongs in pi’s transcript. Structured metadata would make it searchable without parsing English error text. [Memory tools](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/index.ts:67). |
| The extension also holds back deletion and can inject a hidden `jezo-memory-check` message before settlement. Each pending key receives that continuation once. | Show hidden corrective messages and unresolved pending decisions. A final assistant response is not proof that the memory operation completed. [Settlement check](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/index.ts:35), [forget check](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/index.ts:122). |
| The host already has conversation IDs, per-run IDs, undo boundaries, and a session-event subscription. Its chat projection omits system/custom entries, thinking, and most result details. | A developer view can reuse existing identifiers and raw entries instead of changing ordinary chat. [Run lifecycle](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:184), [chat projection](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:370). |

The main gaps are therefore **decision metadata, precise execution timing, durable run boundaries, experiment identity, and state-based scoring**—not basic conversation logging. That prioritization is an **inference** from the implementation above.

**2. The observability landscape on 2026-09-30**

In the tables, **local** means the trace store can run on the maintainer’s machine. It does not mean that a configured cloud model, judge, prompt optimizer, or trace-analysis assistant stays local. For Jezo, every hosted tracing destination and every cloud evaluation path should require explicit opt-in.

Prices below are published USD starting points, excluding inference, evaluation-model usage, and operating the infrastructure. Vendors charge different units—spans, events, requests, or storage—so the starting prices are not directly comparable.

OpenTelemetry also needs a qualification. Its GenAI conventions moved into a dedicated repository, and the current inference and agent specifications remain **Development**, rather than a stable schema. The current draft includes memory operations such as `search_memory`, `create_memory`, `update_memory`, and `delete_memory`, with memory IDs/counts and opt-in query/record content. This is a significant improvement over treating every memory operation as an anonymous tool call. [OTel relocation notice](https://opentelemetry.io/docs/specs/semconv/gen-ai/), [GenAI client and memory spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md), [agent spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-agent-spans.md).

**OTLP compatibility does not imply identical LLM rendering.** Phoenix uses OpenInference conventions; LangSmith documents mappings for several attribute families, including older GenAI forms. A backend may accept a span while failing to recognize its prompt, session, or token fields. Pin a semantic-convention revision and verify the rendered result in whichever backend Jezo supports. The last sentence is an **inference** from these differing mappings. [Phoenix instrumentation](https://arize.com/docs/phoenix/learn/tracing/how-tracing-works), [LangSmith mappings](https://docs.langchain.com/langsmith/trace-with-opentelemetry).

The following platforms offer a practical self-hosting path for a maintainer:

| Tool and license | Deployment and privacy | TypeScript / OTel | Agent inspection and experiments | Cost |
|---|---|---|---|---|
| **Langfuse** — MIT core; commercial enterprise additions | Docker Compose locally; larger deployments use Kubernetes. Local trace storage is supported. | First-party TS SDK built on OTel; direct OTel ingestion. | Nested agent/tool observations, sessions, token/cost tracking; datasets, prompt versions, experiments, code/LLM/human evaluation. | OSS free. Cloud: free 50k units/month; Core $29/month plus usage. [Features/license](https://langfuse.com/pricing-self-host), [deployment](https://langfuse.com/self-hosting/deployment/docker-compose), [SDK](https://langfuse.com/docs/observability/sdk/typescript/overview), [pricing](https://langfuse.com/pricing). |
| **Arize Phoenix** — **Elastic License 2.0**, source-available, not an unrestricted permissive OSS license | Python package/server with SQLite for local use; Docker also available. | TS tracing/client packages; TS evaluation library is marked alpha. OTel/OpenInference. | Trace trees, retrieval inspection, sessions, annotations, versioned datasets, experiments and prompt iteration. | Free self-hosting; managed Arize offerings are separate. [License](https://github.com/Arize-ai/phoenix/blob/main/LICENSE), [packages/features](https://github.com/Arize-ai/phoenix), [storage](https://arize.com/docs/phoenix/phoenix-deployment-options). |
| **Laminar** — Apache-2.0 core; enterprise additions | Docker Compose/Helm or hosted service. | Python and TS; OTel-native tracing. | Nested traces, agent debugger, browser recordings, datasets and experiment comparison. Custom JSX evaluation renderers could display Jezo memory diffs **(inference)**. | Self-hosted core free. Cloud free tier; Starter $30/month, Pro $150/month plus usage. [Repository](https://github.com/lmnr-ai/lmnr), [evals/rendering](https://laminar.sh/docs/evaluations/introduction), [pricing](https://laminar.sh/pricing). |
| **Opik / Comet** — Apache-2.0 | Docker-based local installation; Kubernetes for larger deployments. | First-party TS SDK and OTLP/HTTP ingestion; conversational thread IDs supported. | Traces, spans, agent analysis, datasets/test suites, prompt experiments, evaluation and optimization. | OSS free. Cloud free 25k spans/month; Pro starts at $19/month. [License](https://github.com/comet-ml/opik/blob/main/LICENSE), [self-hosting](https://www.comet.com/docs/opik/self-host/overview), [OTel](https://www.comet.com/docs/opik/integrations/opentelemetry), [pricing](https://www.comet.com/site/pricing/). |
| **OpenLIT** — Apache-2.0 | Docker/Helm stack: platform, ClickHouse and OTel Collector. | TS and Python instrumentation; OTel-based. | LLM/tool/retrieval traces, session filtering, token/cost dashboards, prompt management, evaluations and model comparison. | Free self-hosting; current pricing page says Cloud is coming soon. [Repository](https://github.com/openlit/openlit), [deployment](https://github.com/openlit/openlit/blob/main/docs/latest/openlit/installation.mdx), [features/cost](https://openlit.io/pricing). |
| **Agenta** — MIT core | Docker Compose/self-hosted platform; hosted option. | Native Python SDK; standard OTel/REST provides a Node path. I would not assume TS SDK parity. | Tracing, execution logs, prompt/agent versioning, test sets, side-by-side comparisons and evaluations. | OSS free. Current Cloud Pro $29/month plus runs. [Repository](https://github.com/Agenta-AI/agenta), [OTel](https://agenta.ai/docs/observability/opentelemetry), [API](https://agenta.ai/api), [pricing](https://agenta.ai/pricing). |
| **Lunary** — Apache-2.0 community code; commercial enterprise offering | Local Node services plus PostgreSQL; documented Docker/Kubernetes options. | JS/TS SDK. OpenLLMetry integration is listed; verify the precise OTLP/schema path before choosing it for generic OTel ingestion. | Agent tracing, chat replays, prompt templates, human reviews and scoring. | Community self-hosting free. New Cloud workspaces start at $20/user/month; enterprise self-hosting quoted. [Code/license](https://github.com/appl-team/lunary), [self-hosting FAQ](https://lunary.ai/faq), [integrations](https://lunary.ai/integrations), [pricing](https://lunary.ai/pricing). |
| **Helicone** — Apache-2.0 | Self-hosted services or hosted gateway/logging. The hosted gateway receives the model traffic itself. | TS integration and asynchronous logging; OTel-related integration exists, but it is not the clearest general-purpose OTLP backend choice **(inference)**. | Request/cost analytics, session paths, agent tracing, datasets and experiments. Local memory internals still require explicit events **(inference)**. | OSS code free. Cloud free 10k requests; Pro $79/month plus usage. [Repository](https://github.com/Helicone/helicone), [gateway](https://docs.helicone.ai/getting-started/quick-start), [sessions](https://docs.helicone.ai/features/sessions), [async instrumentation](https://www.helicone.ai/changelog/20250226-disabled-logging-async), [pricing](https://www.helicone.ai/pricing). |
| **MLflow** — Apache-2.0 | Python server; SQLite local deployment, without Docker. | Python and TS tracing; OTLP ingestion supported from MLflow 3.6. | Agent traces, evaluation datasets, scorers, experiments, regression comparisons and prompt management. | Free OSS self-hosting; commercial managed deployments separate. [Repository/license](https://github.com/mlflow/mlflow), [local OTLP ingestion](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/ingest/), [evaluation](https://mlflow.org/docs/latest/genai/eval-monitor/). |

For Jezo’s desktop distribution, these remain **maintainer tools**, unless Jezo itself bundles and manages their services. Shipping a database/server stack solely to inspect memory would add substantial product and maintenance work **(inference)**.

The commercial platforms are capable, but their ordinary hosted paths send traces off-machine:

| Tool and license | Deployment / TS / OTel | Agent and evaluation capabilities | Cost and Jezo fit |
|---|---|---|---|
| **LangSmith** — proprietary platform; separately open SDKs | Hosted; enterprise self-hosting/hybrid. TS supported; generic OTel ingestion and attribute mappings. | Nested runs, threads, tools, datasets, custom evaluators, prompt/model comparisons. | Developer free allowance; Plus $39/seat/month plus usage. Enterprise license required for self-hosting. [OTel](https://docs.langchain.com/langsmith/trace-with-opentelemetry), [evals](https://www.langchain.com/langsmith/evaluation), [pricing](https://www.langchain.com/pricing), [self-host license](https://support.langchain.com/articles/7011309930-how-do-i-obtain-a-self-hosted-langsmith-license-key). |
| **W&B Weave** — Apache-2.0 Weave code; supported W&B service/deployment has commercial terms | TS SDK and OTel ingestion; hosted and enterprise deployment options. | Nested calls, conversation views, versioned artifacts, datasets, scorers, evaluation comparisons and playgrounds. | Free quota, paid ingestion/storage and enterprise pricing. Do not equate the open SDK with a turnkey free local W&B deployment **(inference)**. [License](https://github.com/wandb/weave/blob/master/LICENSE), [integrations](https://docs.wandb.ai/weave/guides/integrations), [features](https://site.wandb.ai/weave/), [pricing](https://site.wandb.ai/pricing/). |
| **Braintrust** — proprietary platform; public SDKs | First-class TS; OTel supported. Hosted, hybrid or full enterprise self-hosting. Hybrid retains a vendor control plane. | Trace trees, datasets, experiments, scorers, prompt playgrounds and trace-to-evaluation workflows. | Free allowance; Pro $249/month plus usage. Self-hosting quoted. [SDK](https://github.com/braintrustdata/braintrust-sdk-javascript), [OTel](https://www.braintrust.dev/articles/llm-tracing-guide), [deployment/data locations](https://www.braintrust.dev/docs/admin/self-hosting), [pricing](https://www.braintrust.dev/pricing). |
| **Pydantic Logfire** — MIT SDK/chart; proprietary backend | Native TS/Node and OTel. Cloud or commercial enterprise Kubernetes deployment. | Agent spans plus application logs/SQL analysis; datasets, experiment comparisons and evaluation APIs. The Evals Workbench arrived in August 2026. | Personal free 10M telemetry records; Team $49/month plus usage. [TS SDK](https://pydantic.dev/docs/logfire/instrument/typescript/), [Workbench](https://pydantic.dev/changelog/evals-workbench), [self-host terms](https://github.com/pydantic/logfire-helm-chart), [pricing](https://pydantic.dev/pricing). |
| **AgentOps** — MIT SDKs; commercial dashboard | Python and TS. TS SDK exports GenAI-style OTel to compatible collectors, permitting a local-backend route. | Agent/session replay analytics, tool interactions, cost tracking and benchmarking. Verify dataset/prompt-comparison requirements separately. | Hosted free 5k events; Pro starts at $40/month. I did not verify a turnkey OSS dashboard deployment. [TS SDK/license](https://github.com/AgentOps-AI/agentops-ts), [features/pricing](https://www.agentops.ai/). |
| **HoneyHive** — proprietary platform; public client SDKs | OTel-native; TS support. SaaS, hybrid, or full Kubernetes self-hosting. V2 is changing the TS SDK surface. | Sessions/trajectories, tools and handoffs, datasets, automated/human evals, prompt versions and release comparison. | Free 10k events/month; enterprise/custom pricing for private deployments. [OTel SDK](https://www.honeyhive.ai/blog/product-update-opentelemetry-native-sdks), [V2 changes](https://www.honeyhive.ai/blog/introducing-honeyhive-v2), [deployment](https://www.honeyhive.ai/enterprise), [pricing](https://www.honeyhive.ai/pricing). |
| **Galileo** — proprietary platform | TS SDK; OTel/OpenInference integrations. Hosted or enterprise Kubernetes deployment. | Agent traces, custom/prebuilt evaluations, datasets, prompt experimentation and quality analytics. | Free 5k traces/month; listed Pro $100/month under annual billing; enterprise quoted. [Integrations](https://docs.galileo.ai/sdk-api/typescript/wrappers/wrappers-overview), [deployment](https://helm.galileo.ai/docs/getting-started/installation/), [pricing](https://galileo.ai/pricing). |

Three related tools occupy different layers:

| Tool | What it provides | Locality, license and cost |
|---|---|---|
| **OpenLLMetry / Traceloop** | OpenLLMetry supplies Python/TS OTel instrumentation, not a trace database/UI. Traceloop adds monitoring, prompt management and evaluation workflows. | OpenLLMetry is Apache-2.0 and free; point it at a local backend. Traceloop is commercial: free 50k-span tier, enterprise/on-prem quoted. [Introduction](https://www.traceloop.com/docs/introduction), [SDK license](https://github.com/traceloop/openllmetry-js/blob/main/LICENSE), [pricing](https://www.traceloop.com/pricing). |
| **Promptfoo** | Node/TS evaluation runner and local comparison UI. Custom JS providers can call Jezo; current tracing support consumes OTLP and supports trajectory/span assertions. | MIT core, free locally; paid cloud features separate. Telemetry is enabled by default, and cloud-backed generation/grading/sharing can transmit data. [License](https://github.com/promptfoo/promptfoo/blob/main/LICENSE), [custom providers](https://www.promptfoo.dev/docs/providers/custom-api/), [tracing](https://www.promptfoo.dev/docs/tracing/), [data handling](https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/). |
| **Inspect, UK AISI** | Python evaluation framework with detailed task/sample transcripts, scoring, local log viewer and exportable viewer bundles. Local/OpenAI-compatible model support. | MIT, free; no Docker required for ordinary evaluations. Python-first: integrating the real TS Jezo runtime needs a bridge **(inference)**. Its native artifact is the evaluation log; I did not verify native OTLP ingestion as a substitute for that log. [License](https://github.com/UKGovernmentBEIS/inspect_ai/blob/main/LICENSE), [viewer](https://inspect.aisi.org.uk/log-viewer.html), [models](https://inspect.aisi.org.uk/models.html). |

For plain local OpenTelemetry, the trade-off is simpler. All accept instrumentation from Node through OTel; their generic trace trees can show agent/tool spans, but **none supplies Jezo’s memory semantics or a complete memory-evaluation workflow automatically** **(inference)**.

| Backend | License and operation | What it gives Jezo |
|---|---|---|
| **otel-desktop-viewer** | Apache-2.0; downloadable Go binary/Homebrew, embedded collector, browser UI and optional DuckDB file. Free; no Docker needed. | Local traces, logs and metrics with little setup. Current versions support persistence; older descriptions calling it strictly ephemeral are incomplete. [Repository/setup](https://github.com/CtrlSpice/otel-desktop-viewer), [license](https://github.com/CtrlSpice/otel-desktop-viewer/blob/main/LICENSE). |
| **otel-tui** | Apache-2.0; local terminal application/receiver. Free. | Fast span-tree inspection during development; not an end-user GUI. [Repository](https://github.com/ymtdzzz/otel-tui). |
| **Jaeger v2** | Apache-2.0; single binary or container, configurable storage. Free. | Mature trace timelines/search; persistence requires choosing appropriate storage. [Downloads](https://www.jaegertracing.io/download/), [storage](https://www.jaegertracing.io/docs/2.21/storage/), [repository/license](https://github.com/jaegertracing/jaeger). |
| **Grafana Tempo** | AGPL-3.0; local service/container, usually paired with Grafana. Free OSS. | Trace storage and TraceQL/Grafana exploration. More infrastructure than needed for one maintainer **(inference)**. [Repository](https://github.com/grafana/tempo), [license](https://github.com/grafana/tempo/blob/main/LICENSE). |
| **SigNoz** | MIT core with commercial enterprise directories; its collector has separate licensing. Local Docker stack or Linux services, including ClickHouse. | Integrated traces/logs/metrics, dashboards and OTel analysis. Community self-hosting free. [Core license](https://github.com/SigNoz/signoz/blob/main/LICENSE), [collector releases](https://github.com/SigNoz/signoz-otel-collector/releases), [current installation](https://signoz.io/docs/install/docker/). |

The most relevant 2026 changes are therefore not another vendor name: **memory spans in the evolving OTel specification; pi’s own telemetry contracts; local viewers gaining persistent storage; broader TS evaluation support; and coding agents exposing actual trace export.** The sources above and below document those changes.

**3. What pi and other agents expose**

**Pi has native telemetry building blocks, but not a bundled observability backend.** Its MIT `@earendil-works/pi-telemetry` package defines explicit `TelemetryContext`/`TelemetrySpan` contracts and an in-memory reference implementation. It intentionally has no exporter. The reference implementation records no timestamps and is unbounded/process-local, so it is not itself a durable latency recorder. Pi’s AI/harness schemas use pi-owned names that an adapter can translate. [Telemetry package](https://github.com/earendil-works/pi/tree/main/packages/telemetry), [installed contract](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-telemetry/README.md).

For the installed `createAgentSession` API, I did not find a simple top-level telemetry option. Jezo can instead use its existing session subscription and extension hooks, including `context_with_system`, `before_provider_request`, provider-response events, and tool execution events. Custom session entries created through `pi.appendEntry()` are durable but excluded from model context. [SDK declarations](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts), [extension declarations](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:645), [extension documentation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md).

Pi also provides local session export to HTML/JSONL. **`/share` is different:** it uploads the session to Radius or a GitHub gist, depending on authentication. It should not be the default debugging path for private Jezo conversations. [Installed export/share documentation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/docs/usage.md:78).

Community options worth examining:

- **`@desek/pi-opentelemetry` — Apache-2.0:** exports traces, metrics and logs over OTLP. Content capture is separately opt-in. Its enablement includes a dynamic default based on configured endpoints or a reachable collector, so embedding it unchanged would need a privacy review of configuration behavior **(inference)**. [pi.dev package and operational contract](https://pi.dev/packages/@desek/pi-opentelemetry).
- **`@lifanh/pi-langfuse-extension`:** maps runs, generations and tools into Langfuse and groups by session. Metadata is the default; prompts, system prompt and tool I/O are opt-in. I did not verify its license sufficiently to recommend copying its code. [Repository](https://github.com/lifanh/pi-langfuse-extension).
- **`pi-trace-extension` — MIT, explicitly experimental:** writes local `events.jsonl` plus a single-file HTML execution viewer, including timing, costs and provider payloads. Its README lists OTLP export as a **roadmap item**, not an implemented capability. It also truncates long payload strings, which matters for exact prompt reconstruction. [Repository and limitations](https://github.com/npxcnency-ux/pi-trace-extension).

These are useful reference implementations. Compatibility with Jezo’s pinned SDK and inline-extension loading still needs a small real integration test **(inference)**.

Other agents demonstrate several distinct approaches:

| Agent | Available observability |
|---|---|
| **Hermes Agent** | Backend-neutral observer hooks expose lifecycle events, IDs, timing and outcomes. First-party gateway OTLP monitoring is explicitly content-free and excludes detailed execution traces. The community Apache-2.0 `hermes-otel` plugin adds turn/model/API/tool/subagent traces to local or hosted OTLP backends. [Observer hooks](https://hermes-agent.nousresearch.com/docs/developer-guide/observer-hooks), [gateway monitoring](https://hermes-agent.nousresearch.com/docs/developer-guide/gateway-monitoring), [plugin](https://github.com/briancaffey/hermes-otel). |
| **OpenClaw** | JSONL operational logs carry trace correlation fields; request, agent-run and model-call scopes can be connected to its diagnostics/OTel export. This is configurable operational observability, not automatic knowledge of whether memory influenced an answer **(inference)**. [Logging and diagnostics](https://docs.openclaw.ai/logging). |
| **Letta** | Its ADE exposes agent messages, tools and memory blocks; current Letta memory documentation also describes git-backed MemFS and reviewable memory updates. These views are tied to Letta’s runtime/state model, rather than being a drop-in viewer for pi **(inference)**. [ADE](https://docs.letta.com/v1-sdk/ade), [current memory documentation](https://github.com/letta-ai/letta-docs-md/blob/main/configuration/memory/index.md). |
| **Claude Code** | Current documentation includes **distributed traces in beta**, connecting prompts to API requests and tool executions. Enablement requires `CLAUDE_CODE_ENABLE_TELEMETRY=1`, `CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1`, and a trace exporter. Prompt/response/tool content has separate controls. Older “metrics and events only” comparisons are outdated. [Monitoring documentation](https://code.claude.com/docs/en/monitoring-usage). |
| **Codex** | Configuration exposes separate OTel log, trace and metric exporters, including OTLP HTTP/gRPC destinations. Raw prompt export is separately controlled. Hooks expose transcript paths. These mechanisms are distinct from uploading traces through a hosted agent platform. [Configuration](https://developers.openai.com/codex/config-reference/), [hooks](https://developers.openai.com/docs/hooks). |

**4. Memory-specific debugging and evaluation**

The benchmark literature increasingly tests **updates, conflict resolution and evolving preferences**, rather than only retrieval. These benchmarks are useful ingredients, but none should replace Jezo’s own behavioral contract **(inference)**.

| Benchmark | What it measures | How to use it for Jezo |
|---|---|---|
| **LongMemEval** | 500 questions covering extraction, multi-session reasoning, knowledge updates, temporal reasoning and abstention. Timestamped histories; the repository records a history-cleaning update. [Official repository](https://github.com/xiaowu0162/LongMemEval). | Use update, temporal and abstention cases first. Pin the dataset revision. It evaluates answers; add checks of Jezo’s stored state **(inference)**. |
| **LoCoMo** | Long conversations across ten conversation histories, with QA and event-summarization annotations. [Official repository](https://github.com/snap-research/locomo). | Useful for personal facts and multi-session dependencies. It is not, by itself, a test of explicit deletion or `replaces` behavior **(inference)**. |
| **MemoryAgentBench** | Incremental ingestion; retrieval, test-time learning, long-range understanding and conflict resolution. Its FactConsolidation task tells agents to prioritize later conflicting information. [Paper](https://arxiv.org/html/2507.05257v1), [repository](https://github.com/HUST-AI-HYZ/MemoryAgentBench). | Good for state evolution. Be careful with descriptions calling it “selective forgetting”: answering with the newer fact does not prove deletion or prevention of later resurrection **(inference)**. |
| **BEAM** | Long coherent conversations up to 10M tokens; 100 conversations and 2,000 validated questions in the paper. [Paper](https://arxiv.org/abs/2510.27246). | A later endurance test for growing histories. Too expensive and broad to be Jezo’s first regression gate **(inference)**. |
| **HorizonBench, April 2026** | Evolving preferences over six-month simulated histories, with structured provenance for preference changes; 4,245 items from 360 users. [Paper](https://arxiv.org/abs/2604.17283). | Particularly relevant to changed schedules, circumstances and conditional preferences. Its ground-truth provenance suggests how to label Jezo scenarios **(inference)**. |
| **Memora, April 2026** | Remembering, reasoning and recommendations over evolving histories. Introduces Forgetting-Aware Memory Accuracy, penalizing obsolete/invalidated information. [Paper](https://arxiv.org/abs/2604.20006). | Borrow the explicit stale-memory penalty. Correct answers should not cancel out harmful reliance on invalidated facts **(inference)**. |
| **LongMemEval-V2, 2026** | Agentic experience over multimodal web/enterprise trajectories; 451 questions, accuracy and query latency, with very large histories. [Official repository](https://github.com/xiaowu0162/LongMemEval-V2). | Relevant if Jezo later remembers tool workflows and experience; less directly matched to today’s personal-fact store **(inference)**. |
| **Supersede, June 2026** | A study/environment isolating failures to maintain current facts in bounded agent memory. Its experiments distinguish memory maintenance from comprehension and show that more memory did not resolve one tested failure setting. [Paper](https://arxiv.org/abs/2606.27472). | Directly relevant to omitted `replaces`. Treat it as supporting evidence for controlled maintenance experiments, not proof of the cause of Jezo’s failures **(inference)**. |

For memory-specific interfaces, **Hindsight is a useful reference**: its Recall UI exposes relevance scores, memory types and retrieval traces; its June 2026 release added tracing for internal retain/recall/reflect LLM calls. Letta exposes its own mutable memory state. AgentOps has Mem0 instrumentation. These are runtime-specific views, not generic understanding of Jezo’s supersede/tombstone rules. [Hindsight Recall UI](https://docs.hindsight.vectorize.io/recall/), [Hindsight 0.8](https://hindsight.vectorize.io/blog/2026/06/08/version-0-8-0), [Letta memory tools](https://www.letta.com/blog/introducing-sonnet-4-5-and-the-memory-omni-tool-in-letta/), [AgentOps Mem0 instrumentation release](https://github.com/AgentOps-AI/agentops/releases).

For Jezo, I would distinguish five stages **(proposed design; inference)**:

1. **Eligible:** active, unexpired memories that could be selected.
2. **Retrieved:** records returned by automatic or explicit recall.
3. **Presented:** records actually included in the model’s request.
4. **Applied:** facts visibly reflected in an answer or action.
5. **Changed:** saves, replacements, deletions and refusals, verified against storage.

“Retrieved” is observable. “Presented” is observable if the request is captured. **“Used” should be treated as an assessed outcome, not a telemetry fact.** A model saying it used a memory is evidence of its claim; it is not a causal measurement. For stronger evidence, rerun a fixture with the target memory removed or changed and compare the resulting action **(inference)**.

Likewise, a trace cannot directly reveal *why* the model omitted `replaces`. It can narrow the possibilities **(inference)**:

| Trace evidence | Next experiment |
|---|---|
| Old memory absent from the effective request | Give it the old record explicitly; test selection/recall separately. |
| Old text present but ID absent or obscured | Preserve IDs and change formatting only. |
| Correct ID and tool schema present; argument omitted | Compare policy wording/schema descriptions at a fixed request prefix. |
| Held-back response contains candidates; model stops | Inspect the settlement continuation and test recovery behavior. |
| Model deletes the old memory to update it | Score that as an incorrect operation even if the final answer sounds right. |
| Model chooses `separate: true` for a contradiction | The check produced a decision, but the decision was wrong; inspect final active state. |

**5. A small realistic Jezo evaluation set**

Start with **24 stories: twelve scenario families, each in English and Traditional Chinese**. Each story should contain several sessions, distractor messages, a later probe, and expected state transitions. This is a proposed application-specific dataset **(inference)**:

| Scenario | Required result |
|---|---|
| Stable preference after two weeks away | Recall the preference and apply it to a concrete plan. |
| Explicit correction | New fact supersedes the correct old ID; only the new fact is active. |
| Paraphrased correction | Recognize replacement despite low lexical overlap. |
| Similar but separate facts | Preserve both; avoid false supersession and recover from a false-positive hold. |
| Conditional preference | Keep “weekdays” and “weekends” distinct rather than flattening them. |
| Three successive changes | Apply the latest value and preserve the supersession chain. |
| Temporary circumstance | Respect `valid_until`; avoid presenting expired information as current. |
| Explicit forget | Remove the record, retain the tombstone, and avoid resurrection in later sessions. |
| Explicit remember-again | Restore only when the current user request warrants it; contrast an automation-origin attempt. |
| Evidence and inference | Preserve stated/inferred distinction; refuse unsupported inference and handle the refusal honestly. |
| Outside-content contamination | An email or invite must not become a user-stated preference merely because it was encountered. |
| Budget pressure and recovery | Bury the relevant fact among distractors; test recall, held-back writes, resumed sessions and truthful completion. |

Cross-cutting variants should include one/two-character Chinese queries, long records near the selection cutoff, different people with similar names, cancellation, and restarting Jezo between sessions. These target actual selection/search and lifecycle behavior in the implementation **(inference)**. [Search/context implementation](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/packages/pi-memory/src/memory.ts:308), [host lifecycle](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:184).

Score separate dimensions rather than one blended “memory accuracy” number **(proposed scoring; inference)**:

- **First-attempt update correctness:** correct `replaces` without intervention.
- **Recovery correctness:** correct eventual operation after a hold, with extra calls/tokens/time.
- **State correctness:** active records, supersession links, tombstones, evidence and provenance.
- **Stale-fact application rate:** old facts used in answers or workspace changes.
- **Forgetting violations:** deleted information reappearing through saves, retrieval or older evidence.
- **Completion honesty:** “saved” or “forgotten” agrees with committed state.
- **Retrieval/presentation coverage:** whether required records were found and actually delivered.
- **Efficiency:** complete-story input/output/cache tokens, request count, wall time and latency distribution.

Use deterministic state assertions for most of these. Reserve human review or a separately calibrated local judge for answer meaning and preference application. A fluent response must not compensate for a broken memory state **(inference)**.

Run the suite through the **real Electron/Jezo runtime, extension, file store, provenance and undo path** in a separate fixture workspace. Promptfoo’s custom provider can invoke that runner and return the outcome plus trace/state artifacts; using Promptfoo to call the model directly would bypass the behavior under investigation **(inference)**. [Promptfoo provider interface](https://www.promptfoo.dev/docs/providers/custom-api/), [Jezo backend testing principles](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/AGENTS.md).

A manageable first comparison is **24 stories × three repetitions × two policy versions = 144 story executions**. Start with the local model that produced the observed failures. After that, test a second model and budget variants on the failing families. Record exact model revision/quantization, server version, context limit, sampling settings, policy hash, pi version and fixture revision **(proposed protocol; inference)**.

For budgets, compare the current default against smaller/larger values, then add recall-only and no-memory baselines. Because the current budget excludes several prompt components, report both the configured character budget and measured request usage. Keep model warm-up and cache state explicit when comparing latency **(inference)**.

Every run should leave a repeatable artifact: fixture/configuration, pi JSONL, memory-decision events, initial/final memory state, workspace changes, scores, and links from each failure to its exact request/tool sequence. This matches Jezo’s requirement that E2E runs end with verifiable artifacts. [Project testing requirements](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/AGENTS.md).

**6. Replay needs two distinct modes**

A session transcript is a history of messages; replaying it does not automatically recreate the previous filesystem, memory state, clock, or external tool results **(inference)**. Pi supports session branching and context reconstruction, while Jezo’s backend explicitly notes that session recovery is not a transaction across workspace files. [Pi session format](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md), [Jezo recovery contract](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md:105).

Provide two developer operations **(proposed design; inference)**:

- **Replay one decision:** restore the exact prefix, memory section and tool definitions immediately before a failed save. Ask another model what to do next. This isolates `replaces` behavior.
- **Rerun the story:** restore the initial fixture, feed user messages chronologically, and allow the new model to make its own calls and memory changes. This measures the resulting system.

Reusing the old model’s tool results is useful for controlled diagnosis, but it is not a full behavioral replay. Re-executing tools against the maintainer’s live workspace would contaminate both data and measurements. Use isolated copies and controlled external-tool fixtures **(inference)**.

**7. Options for Jezo**

Effort below is a rough estimate for one maintainer familiar with the repository, in working days. It assumes an initial useful implementation, not production-grade replay infrastructure. These estimates are **inferences**.

| Option | Effort | What it answers | Privacy and limitations |
|---|---:|---|---|
| **A. OTel GenAI spans → local backend** | 2–4 days for useful instrumentation and setup | Request/tool timing, nesting, failures, token usage; memory operations when explicitly instrumented. | Local with a loopback receiver. Generic backends need custom fields/views for holds, supersession and final state. Evals remain separate. |
| **B. One vendor SDK directly** | 1–3 days for basic tracing; additional memory/eval work | Rich UI, sessions, prompts, datasets and experiment comparison with less UI development. | Self-hosted platform or explicit cloud opt-in. Vendor mapping/deployment becomes a dependency. Auto-instrumentation alone misses Jezo’s decisions. |
| **C. Pi JSONL + small developer view + extra events** | 3–6 days for a useful viewer and instrumentation | Effective memory section, tool arguments/results, hidden checks, write decisions and state changes. Best fit for Jezo-specific questions. | Entirely local; no extra end-user process. Timing and experiment aggregation need deliberate additions. |
| **D. C + local eval runner + optional OTel adapter** | Roughly 1–2 weeks, staged | All concrete questions, including regression comparisons and targeted replay. | Local artifacts remain authoritative; external backends are optional indexes/views. More initial work, but avoids maintaining two competing records. |

For option B, my shortlist would be **Langfuse for the full TypeScript workflow**, **Phoenix for a convenient local research server**, and **Laminar when its agent debugger/custom evaluation rendering is valuable**. MLflow is also credible if permissive licensing and a Python/SQLite server are attractive. Those preferences are **inferences** from the capabilities above.

For option C/D, keep the implementation small **(proposed architecture; inference)**:

- Reconstruct prompt sections using pi’s branch/compaction semantics. Do not concatenate every JSONL line as if the file were a flat conversation.
- Add versioned custom entries for `run.started`, `run.finished`, `memory.context`, and `memory.decision`.
- Correlate them with session ID, run ID, request/turn ID, tool-call ID and relevant pi entry IDs.
- Record memory selection IDs/order, exclusions, budget, policy version and automatic-recall provenance. Reuse the already-persisted memory text where possible.
- Record attempted operation, related candidates/scores, supplied `replaces`/`separate`/`again`, decision reason, committed IDs and linked undo changes.
- Distinguish `held`, `refused`, `committed`, `cancelled` and `unresolved`. Keep the underlying tool error as well.
- Capture request/tool start/end and first-token timing through runtime events. Mark unknown timing as unknown rather than deriving precise durations from transcript timestamps.
- Keep the recorder independent of Langfuse/Phoenix/OTel. An adapter can translate these events into each backend.

The OTel adapter can map requests and tools to GenAI spans and memory operations to the new memory conventions. Supersession relationships, pending-decision IDs and policy-specific reasons should remain explicit `jezo.*` fields. Pin the schema revision because these conventions are still developing. [Current attribute registry](https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/registry/attributes/gen-ai.md).

The developer view needs only four useful surfaces initially **(proposed UI; inference)**:

1. A run timeline with model requests, memory tools and corrective messages.
2. “Memory presented” with exact contents and selection reasons.
3. A before/after memory-state diff, including supersession and forgetting.
4. An experiment comparison linking failed scores back to the relevant run.

**8. Privacy decisions that belong in this work**

Tracing creates another copy of personal information. Jezo already blocks reading session files cited by forgotten memories; a new trace sidecar containing the same text could otherwise become another route for relearning it **(inference)**. [Forgotten-evidence check](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:294).

I would therefore make these explicit design choices **(recommendation; inference)**:

- Keep canonical diagnostics in the workspace and out of automatic memory retrieval/evidence ingestion.
- Make detailed payload recording a visible developer setting; keep metadata-only recording possible.
- Give the GUI a way to delete diagnostics and explain that forgetting an active memory and erasing historical traces are different operations.
- Treat backend export, cloud judging and vendor trace-analysis assistants as separate opt-ins, even when the primary model is local.
- Avoid recording authorization headers or credentials. Export a chosen run or fixture, not the entire workspace.
- Ensure recorder/export failures do not interrupt the agent; report missing/dropped diagnostics visibly.

Promptfoo deserves a specific setup note: its documentation says basic telemetry is enabled by default, and its FAQ documents additional account/opt-out behavior. For strict local evaluation, configure local providers for **all** grading/generation paths, disable telemetry/update checks, avoid cloud sync/sharing, and verify the actual network behavior of the pinned version. [Telemetry controls](https://www.promptfoo.dev/docs/configuration/telemetry/), [FAQ](https://www.promptfoo.dev/docs/faq/), [data-handling guidance](https://www.promptfoo.dev/docs/red-team/troubleshooting/data-handling/).

**9. First concrete steps and required installations**

I would implement this in the following order **(recommendation; inference)**:

1. **Inspect one existing failed run from raw JSONL.** Reconstruct its effective `sections.memory`, tool schema, attempted save, refusal, corrective message and final state. This establishes how much can already be recovered.
2. **Add the missing decision/timing events.** Start with the `replaces` case and make one failure fully explainable before building dashboards.
3. **Create six difficult stories first**, covering correction, paraphrase, separate facts, forget/resurrection, provenance and budget pressure. Expand to the 24-story suite once the runner/artifact format works.
4. **Add the developer view over those artifacts.**
5. **Add optional OTLP export** only when external timelines or cross-run querying would save work.

End users should install **nothing beyond Jezo** for the proposed built-in view.

The maintainer would need:

| Purpose | Install/run |
|---|---|
| Local model evaluation | Existing LM Studio/Ollama setup, Jezo’s development environment, and a pinned Promptfoo development dependency after the custom runner exists. |
| Minimal external tracing | Install **otel-desktop-viewer** through its Homebrew tap or release binary. Run with a persistent database, for example `otel-desktop-viewer --db ./telemetry.duckdb`. Its UI defaults to localhost port 8000; OTLP HTTP uses 4318. [Setup](https://github.com/CtrlSpice/otel-desktop-viewer). |
| Rich local evaluation UI without Docker | In a Python environment, install `arize-phoenix` and run `phoenix serve`; or install MLflow and run `mlflow server`. Both support local database-backed operation. [Phoenix quickstart](https://github.com/Arize-ai/phoenix#run-locally), [MLflow local ingestion](https://mlflow.org/docs/latest/genai/tracing/opentelemetry/ingest/). |
| Full self-hosted TypeScript-oriented platform | Docker plus Docker Compose, then Langfuse’s documented local deployment. Configure the SDK/exporter to the local instance. [Langfuse deployment](https://langfuse.com/self-hosting/deployment/docker-compose). |

The first success criterion should be concrete: **open a failed correction, see exactly what the model received, follow the held-back save to its eventual outcome, then rerun that story under two policies and compare both final memory state and recovery cost** **(recommendation; inference)**.

No files were changed, packages installed, or evaluations executed.
