# Apple Foundation Models integration

Research and design review, 2026-10-01. Baseline: Jezo `ae9354e`, pi 0.99.1.

## Findings

Apple's **on-device model** is available through FoundationModels on eligible Apple Silicon Macs running macOS 26+, with Apple Intelligence enabled and its model downloaded. The framework also runs on other Apple devices; this desktop integration is macOS-only. Framework portability does not make Apple's system model available on Windows or Linux.

Do not hard-code the commonly quoted 4,096-token limit. The installed macOS 27 SDK and a real probe on macOS 27.0 (26A428) report **8,192**. Apple documents 4,096 on macOS 26 and 8,192 on newer devices with macOS 27. Query `SystemLanguageModel.contextSize`. Token counting is public from macOS 26.4. Model availability and language support remain runtime concerns. A successful availability check does not guarantee generation will succeed.

The model is useful for bounded extraction, summarization and small tool workflows. It is not evidence of suitability for unrestricted Jezo conversations: instructions, workspace guidance, the day digest, installed skills, tool schemas, history and output all share that small window. Never discard instructions or silently trim history to make a demonstration pass.

Sources:
- [Apple framework overview](https://developer.apple.com/documentation/foundationmodels)
- [WWDC26 model updates and context counting](https://developer.apple.com/videos/play/wwdc2026/241/)
- [Apple context-size examples](https://developer.apple.com/videos/play/wwdc2026/319/)
- [Generation and context limits](https://developer.apple.com/documentation/FoundationModels/generating-content-and-performing-tasks-with-foundation-models)

## Ecosystem and alternatives

| Approach | Evidence and tradeoff | Decision |
| --- | --- | --- |
| Existing OpenAI-compatible server | Already fits Jezo's custom-server UI. `Techopolis/afm-Server` supports delegated tool calls; `kulesh/afm-server` restricts tools to its built-ins. Similar names do not imply interchangeable semantics. Another app, server lifecycle and protocol implementation become dependencies. | Keep existing custom-server support; do not bundle a community server. |
| Apple's `fm serve` | macOS 27 system CLI, supports Chat Completions and Unix sockets. Installed `man fm` requires privileged, machine-wide acceptance of CLI terms. The installed version lists only `system`; WWDC/demo PCC access is not a stable product contract. | Not a zero-setup GUI integration. Do not accept terms on the user's behalf. |
| `afm` / maclocal-api / Foundation-Models-Framework-CLI | Swift CLI/server projects, some also include MLX, browser UIs and other providers. Useful interoperability references but much larger than Jezo's required bridge. | Do not embed their server stack. |
| JavaScript bindings / Vercel AI SDK | Meridius-Labs/apple-on-device-ai and johnhenry/apple-foundation-models demonstrate native/subprocess bridges. Native binaries introduce Electron/Node packaging concerns; adapting another agent/provider API adds another compatibility surface. | No new npm/native-addon dependency. |
| Apple Python SDK | Official API with tool calling, but needs Python and native build/runtime packaging. | Valuable for evaluations; unnecessary runtime for an Electron app with existing Swift helpers. |
| Modify/fork pi | Would require maintaining upstream changes across upgrades and putting an Apple dependency in the shared agent. | Reject. |
| Jezo provider + bundled Swift executable | Public pi registration and stream protocol, public Apple framework, versioned JSON over process pipes. Same packaging pattern as EventKit. | Preferred boundary. |

Primary sources:
- [Pi custom-provider documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md)
- [Upstream AFM proposal, closed issue (not shipped support)](https://github.com/earendil-works/pi/issues/1290)
- [Apple CLI and Python SDK](https://developer.apple.com/videos/play/wwdc2026/334/)
- [Pi/fm community experiment](https://gist.github.com/Anemll/be5021f5376cf93eb0bd64aad2a8e619) — rewrites prompts and schemas; not an acceptable drop-in design for Jezo.
- [Techopolis afm-Server](https://github.com/Techopolis/afm-Server)
- [kulesh afm-server](https://github.com/kulesh/afm-server)
- [Foundation-Models-Framework-CLI](https://github.com/rudrankriyam/Foundation-Models-Framework-CLI)
- [maclocal-api](https://github.com/scouzi1966/maclocal-api)
- [apple-on-device-ai](https://github.com/Meridius-Labs/apple-on-device-ai)

## Proposed boundary

`Providers → ModelRuntime.registerProvider → streamSimple → child process → FoundationModels`

Only Jezo owns the adapter. It uses pi's root exports and the existing runtime's public registration contract. No dependency patches, global API registration, private deep imports, Node ABI module, HTTP listener, cloud routing, or changes to tools. The helper cannot execute tools or access the workspace through tool callbacks.

A generation gets one process and one native session. Text snapshots become pi text deltas. A native `Tool` captures its name and generated arguments and throws a typed handoff error, ending Apple's internal tool loop. Only that error is a successful handoff. Pi then runs the normal tool validation, extension hooks, execution, undo and tool-result recording. The next provider invocation reconstructs native instructions, user prompts, assistant responses, tool calls and tool outputs from pi's transcript. Apple documents throwing from a tool as a way to leave the tool loop; no fabricated tool result is returned.

- [Apple tool orchestration and error handling](https://developer.apple.com/videos/play/wwdc2026/242/)
- [ToolCallError underlying error](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/toolcallerror)
- [Native transcript tool-call entries](https://developer.apple.com/documentation/foundationmodels/transcript/entry/toolcalls(_:))

## Second review, before implementation

1. **Agent ownership:** calling JavaScript tools inside Apple's loop would bypass pi's event/undo lifecycle. Reject that approach. Handoff only, no side effects in Swift.
2. **History correctness:** a native session cache keyed by a chat ID would become stale after branching, compaction, tool changes or model switching. Reconstruct every request from pi; preserve tool IDs. For continuation after tool output, use an empty native prompt; verify against the real framework.
3. **Schema fidelity:** Codable is not a promise to accept arbitrary JSON Schema. Use Apple's public dynamic schema constructors for the supported subset. Explicitly reject unsupported shapes rather than silently changing tool meanings. Pi still validates generated arguments.
4. **Limits:** read native context size. Use public, per-model compaction overrides; pi's default reserve is 16,384 and cannot fit AFM. Preserve normal provider settings. Fail context overflow explicitly; no secret prompt reduction. Small-context support does not guarantee a complete Jezo task fits.
5. **Platform isolation:** don't probe/spawn/register on Windows or Linux. On macOS check OS, architecture, binary and framework availability. Build/package helper only for Mac. Existing providers must start if the helper is unavailable.
6. **Lifecycle:** abort before start must not spawn; abort during generation terminates only that process. Errors, malformed protocol, missing executable, timeout and early EOF must settle the stream. No shared mutable generation state across requests.
7. **Privacy:** selecting the on-device model must not silently fall back to a cloud model when it becomes unavailable. No API key/address controls for the native provider. No PCC implied by the Apple label.
8. **Upgrades:** no new runtime dependency. Compile against installed public pi types, test the actual ModelRuntime boundary, and run the native round-trip smoke suite when upgrading pi or the macOS SDK. State macOS 26 compatibility separately from what is tested on macOS 27.

## Validation plan (written before implementation)

Test failures as contracts: non-Mac must never launch a helper; missing helper and unavailable Intelligence must preserve other providers; malformed/early EOF must fail, not hang; pre-aborted and mid-generation abort must settle without tool execution; parallel calls must not cross-contaminate; instructions/tool deltas must replay; image input must fail explicitly while text-only is advertised; native tool call followed by matching tool output must produce a grounded answer; overlong input must preserve context and report overflow; native output limits must not report success for an incomplete response. Test in real Electron with isolated data, and attach screenshots/traces and native results. Native tests are conditional on a capable Mac and report skips honestly.

## Implementation and observed results

The native tool handoff and transcript reconstruction worked against the real macOS 27 model: the model requested `lookup_code`, pi received the call, and a reconstructed session answered with a synthetic code that appeared only in the tool result. Text streamed, input usage was counted, overflow failed explicitly, and cancellation stopped the helper. The helper also compiled with the installed macOS 26.5 SDK targeting macOS 26; actual macOS 26 execution is not verified.

Actual Jezo input, without prompt reduction, used **7,289 / 8,192 tokens** on the seeded workspace. A natural-language request to rename a todo failed: AFM chose `edit`, omitted `.md`, repeated that invalid path after receiving `ENOENT`, then gave up. This is a model-quality failure, not a successful task, and is why AFM remains opt-in. We do not rewrite pi's `edit` schema or suppress Jezo's instructions to improve this result. The end-to-end contract test separately requests the existing `todos_update` tool explicitly and checks the real file and undo.

The first app test also found a missing numeric schema conversion (`minimum`), now mapped to Apple's `GenerationGuide.minimum`. The schema subset supports named objects, optional fields, arrays with item-count bounds, string enums/constants, alternatives, primitive values, and numeric minimum/maximum. Other constraints fail with the tool/schema name. A future tool schema change therefore fails visibly rather than changing meaning silently.

An initial exploratory check used the other checkout's installed pi 1.0.0 packages and exposed unrelated installer type errors. All final checks use this branch's **frozen lockfile, pi 0.99.1**. No manifest or lockfile changed. This is not a claim that arbitrary pi major upgrades are compatible. Re-run typechecking and the provider/native/Electron contract tests when upgrading.

Repeatable checks:

```sh
bun run typecheck
bun test src/main src/shared --timeout 20000
bun run build
JEZO_TEST_AFM=1 bun test src/main/agent/foundation-models/native.test.ts
JEZO_TEST_AFM=1 bunx playwright test foundation-models.spec.ts
```

The last two require real macOS model services and enabled Apple Intelligence. Native artifacts are written to `e2e/results/afm-native.json`; Playwright attaches provider state, session JSONL, workspace paths, screenshots and failure traces. The existing Playwright global setup loads its LM Studio test model; for AFM-only testing, that unrelated setup can be omitted in a temporary config.

The explicit `todos_update` application test did modify the requested file and undo restored it. However, the subsequent response exceeded the context window (**8,384 > 8,192 tokens**). Its passing assertion proves pi tool ownership, visible failure and undo, **not successful completion of the whole conversation**. The native bounded tool round trip completed successfully; the full Jezo agent remains capacity-constrained.

Final verification: typechecking and locale parity passed; the full Bun suite passed 127 tests (the opt-in native test skips in that run and passed separately with 25 assertions); two Electron contracts passed, including missing-helper failure without fallback and undo after a real AFM tool call. The unsigned arm64 macOS directory package built successfully and contains the executable in `Contents/Resources/bin`. Distribution signing/notarization and real Windows/Linux/macOS 26 execution were not performed; non-Mac no-spawn behavior is covered by platform boundary tests. Unix subprocess fixtures skip on Windows, while the platform/transcript checks remain portable.


## Pre-commit review

Reviewed every AFM branch change against the `ae9354e` feature baseline, including the provider's consumers, the public pi 0.99.1 contracts, native schema translation, process lifecycle, platform/build gating, UI, tests and documentation. Fixed:

- Failed/aborted partial assistant turns are omitted from model requests, matching pi's provider behavior. Their incomplete tool calls must not be replayed as if they ran. The saved session remains unchanged.
- Per-model compaction settings merge by field, so a user overriding only `keepRecentTokens` retains AFM's 1,024-token reserve. Other model overrides are preserved.
- Schema alternatives cannot silently discard sibling constraints. Invalid numeric bounds, array item counts and undeclared required fields fail before generation; fractional integer bounds round inward to preserve the integer constraint.
- Error responses retain observed token usage. Native build changes invalidate the helper, and an unsupported SDK removes stale generated binaries instead of packaging them.

Regression tests cover failed-turn replay, partial settings overrides and native schema failures. Small context, experimental task quality, lack of macOS 26 runtime verification and unsigned distribution remain documented limitations.
