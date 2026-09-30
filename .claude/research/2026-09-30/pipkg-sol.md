**Recommendation (inference): use pi’s package manager and built-in MCP integration; implement bash execution directly with `@anthropic-ai/sandbox-runtime`; use `@gotgenes/pi-permission-system` as the shared permission mechanism. No reviewed package provides Jezo’s complete boundary unchanged.** Jezo still needs GUI approvals, authorization for outward actions, credential storage, and undo for shell writes.

Research date: **September 30, 2026**. I read the requested Jezo files, the installed pi **0.99.1** implementation, and the candidates’ enforcement, configuration, and reviewer source. This was source review, not a runtime security audit. No repository files were changed and no packages or tests were executed.

### 1. Permission, sandbox, and auto-mode packages

**The distinction that matters is enforcement of effects versus review of requests.** An OS sandbox can prevent a subprocess from writing outside permitted roots or connecting directly to arbitrary hosts. A permission extension decides whether a tool call should proceed. A model reviewer adds a judgment about intent. These are complementary mechanisms; a reviewer’s approval is not containment.

Pi itself makes the same distinction: extensions and host-side operations retain the pi process’s authority. All installed code can remain equally trusted, as Jezo requires, while agent-generated invocations receive narrower authority. [Pi 0.99.1 security documentation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/security.md)

**The seven requested packages compare as follows.**

| Package | Actual enforcement | Reviewer evidence | Failure behavior |
|---|---|---|---|
| `pi-permission-modes` | OS sandbox for bash; policy gates for files, skills and custom tools; domain filtering | No reviewer model | Sandbox unavailable → confirmation before unsandboxed execution; no UI → approval unavailable |
| `pi-sandbox` | OS sandbox for bash; preflight gates for `read`/`write`/`edit`; domain filtering | No reviewer model | **Initialization failure disables protection and ordinary bash runs** |
| `pi-verdict` | Tool-call gate with deterministic rules, protected paths and model review; no OS sandbox | Recent user messages, previous tool calls, proposed action; excludes tool results and assistant prose | Reviewer failure → deny; unanswered/headless ask → deny |
| `@hank-warren/pi-auto-permissions` | Review of matching bash calls; no OS sandbox | User and assistant text, tool-call summaries and success/error status, selected dialog answers, exact proposed command | Gated review failure → user confirmation or headless block; unmatched commands pass |
| `pi-permission-classifier` | An authorizer link for the gotgenes permission system; no independent gate or sandbox | Permission facts/value, enclosing bash command, guidance files; **no conversation transcript** | Failure → defer to the underlying permission system |
| `pi-permission-system` | Deterministic tool/bash/MCP/skill/path gates; no OS sandbox | No reviewer model | Defaults to ask; no UI generally denies asks |
| `@gotgenes/pi-permission-system` | Deterministic gates, bash parsing, path checks, tool visibility, pluggable authorizers; no OS sandbox | Depends on the installed authorizer | Gate errors block; unresolved bash asks; unanswered asks deny |

The details below explain the important qualifications.

**`pi-permission-modes` 2.4.1 is the closest complete developer-oriented combination, but its escape semantics do not fit Jezo unchanged.**

- It pins **`@anthropic-ai/sandbox-runtime` 0.0.77**, using macOS `sandbox-exec` and Linux Bubblewrap. Bash is contained; in-process file tools receive policy/path checks. Custom tools—including native MCP tools—receive tool-name gates, not containment of their implementation. Bash policy analysis uses tree-sitter. There is no reviewer model. [Package manifest](https://github.com/wynainfo/pi-permission-modes/blob/main/package.json), [dispatcher](https://github.com/wynainfo/pi-permission-modes/blob/main/src/index.ts)
- Configuration is `<agentDir>/permission-mode/permission-mode.json`, with state alongside it, plus `<cwd>/.pi/permission-mode.json`. It uses `getAgentDir()`, so it respects `PI_CODING_AGENT_DIR`. Project configuration can tighten the global policy but cannot widen it. [Configuration loader](https://github.com/wynainfo/pi-permission-modes/blob/main/src/config-load.ts)
- When the sandbox is unavailable, it asks before running commands **unsandboxed**. Approved out-of-project or privilege-escalating commands also run unsandboxed. A readiness loss between approval and execution instead fails the call. Thus it avoids *silent* degradation, but does not promise continued containment after approval. [Bash enforcement](https://github.com/wynainfo/pi-permission-modes/blob/main/src/bash-enforce.ts), [execution wrapper](https://github.com/wynainfo/pi-permission-modes/blob/main/src/index.ts#L661)
- Its prompts use `select`/`confirm` and check `hasUI`. Slash commands, shortcuts, status and plan presentation need GUI equivalents. Without a UI it can choose a safe headless fallback mode rather than the configured interactive default.
- **SDK hazards:** its tool root is captured from `process.cwd()`, while initialization also uses `ctx.cwd`. It imports SRT’s singleton manager; separate Jezo sessions do not thereby obtain independently configurable sandbox instances. **Inference:** both need adaptation for an Electron host with multiple conversations. [Extension initialization](https://github.com/wynainfo/pi-permission-modes/blob/main/src/index.ts), [sandbox controller](https://github.com/wynainfo/pi-permission-modes/blob/main/src/sandbox.ts)
- Disclosed fixes include newline policy bypasses, path spellings accepted by pi but missed by the guard, overly broad session approvals, dangling symlinks and configuration failures. Its security document still identifies variable-built commands, external scripts and shell expansion as limits of command analysis. [Security model](https://github.com/wynainfo/pi-permission-modes/blob/main/SECURITY.md), [2.3.1 security fixes](https://github.com/wynainfo/pi-permission-modes/releases/tag/v2.3.1)

**Assessment (inference):** a useful reference and possible fork, but Jezo would have to remove the unsandboxed fallback, replace developer defaults, fix session/cwd ownership and translate substantial TUI behavior. Direct `BashOperations` integration is smaller.

**`pi-sandbox` 0.6.8 has useful machinery, but two source findings rule it out as Jezo’s default.**

- It depends on **`@carderne/sandbox-runtime` `^0.0.72`**, an Anthropic runtime fork with an instance-based manager. It supports macOS and Linux, requires `rg`, filters bash filesystem/network access and checks `read`/`write`/`edit` separately. It does not provide MCP action authorization or a model reviewer. [Manifest](https://github.com/carderne/pi-sandbox/blob/main/package.json), [runtime adapter](https://github.com/carderne/pi-sandbox/blob/main/src/sandbox-runtime.ts)
- On initialization failure, `sandboxEnabled` becomes false. Its replacement bash tool then calls ordinary local bash. The file gate also depends on enabled protection. **This is fail-open**, including in an SDK session where the error notification may be invisible. [Extension source](https://github.com/carderne/pi-sandbox/blob/main/src/extension.ts#L108)
- Its runtime adapter unconditionally sets **`enableWeakerNetworkIsolation: true`**. The example additionally enables browser compatibility, local binding and broad Unix-socket access; the README explicitly warns about the resulting loopholes. [Runtime configuration](https://github.com/carderne/pi-sandbox/blob/main/src/sandbox-runtime.ts#L65), [README](https://github.com/carderne/pi-sandbox/blob/main/README.md)
- Configuration is `<agentDir>/sandbox.json` and `<cwd>/.pi/sandbox.json`; the environment override is respected. Project scalars override global values and permission arrays combine. The source does not apply pi project-trust checks. **Inference:** an agent-writable project config can weaken subsequent policy. [Configuration source](https://github.com/carderne/pi-sandbox/blob/main/src/config.ts)
- Permission dialogs use **`ctx.ui.custom()`**, not merely `select`. No UI returns abort, and prompt timeout never grants access. A React `confirm`/`select` bridge alone is insufficient. [UI implementation](https://github.com/carderne/pi-sandbox/blob/main/src/ui.ts)
- Current issues report `process.cwd()` versus session-cwd errors, missing project-trust handling, Linux glob limitations and sandbox helper failures. These are reports, not reproductions from this research. [Issue tracker](https://github.com/carderne/pi-sandbox/issues)

**Assessment (inference):** reuse ideas such as isolated managers and grant handling, but do not load it unchanged.

**`pi-verdict` 0.12.1 is the best self-contained contextual reviewer candidate. It remains a gate, not a sandbox.**

- It reviews all tool calls after self-protection and deterministic rules. MCP/custom tools reach the classifier unless explicitly exempted. Its regex rules primarily cover command and file-tool families; they are not a universal policy language for MCP arguments. [Core source](https://github.com/jesset/pi-verdict/blob/main/extensions/pi-verdict.ts), [Configuration](https://github.com/jesset/pi-verdict/blob/main/docs/configuration.md)
- The reviewer receives up to **five recent user messages**, **ten previous tool-call lines**, and the current action. It excludes assistant prose/thinking and tool results. A command-bearing action is rendered as its command; a path-bearing action as its path; otherwise arguments are JSON. **Inference:** that compact representation can omit other relevant fields of a custom tool containing `path` or `command`. [Transcript construction](https://github.com/jesset/pi-verdict/blob/main/extensions/pi-verdict.ts#L1025)
- Reviewer exceptions, timeouts and invalid output deny. `ask` becomes deny without UI. An explicitly configured fallback reviewer may rescue a failed first reviewer; that is a second decision, not an unreviewed execution. [Classifier and fallback implementation](https://github.com/jesset/pi-verdict/blob/main/extensions/pi-verdict.ts#L1188)
- Configuration is `<agentDir>/config/pi-verdict.json`; optional audits go under `<agentDir>/verdicts/`. It respects `PI_CODING_AGENT_DIR`. GUI integration mainly needs `confirm`, notifications and status; `/automode` needs a visible control.
- It resolves reviewer models through the session registry and uses its completion API. **LM Studio/Ollama are supported in principle** when registered by Jezo; no cloud reviewer is required. This was not runtime-tested here. [Model resolution](https://github.com/jesset/pi-verdict/blob/main/extensions/pi-verdict.ts#L1930)
- Known limits include obfuscated bash paths, external script contents, unguarded manual shell escapes, and cross-session tampering outside its current baseline. One open issue concerns quadratic path-token scanning. [README limitations](https://github.com/jesset/pi-verdict/blob/main/README.md), [Issue #32](https://github.com/jesset/pi-verdict/issues/32)

**Jezo-specific concern (inference):** its transcript collector accepts ordinary user messages but ignores Jezo’s `jezo.request` custom messages. An automation can therefore lack the request explaining its authority. Its protected-path floor and self-restoration also impose product policy Jezo would need to reconcile with owner-editable methods.

**Assessment (inference):** suitable as an optional local reviewer or starting point for one. I would not make its current defaults Jezo’s authorization authority.

**`@hank-warren/pi-auto-permissions` has stronger authorization evidence, but covers bash only.**

The current source and release are **0.18.0**. The retrieved gallery snapshot still describes **0.16.2**, so its displayed size/download figures below are older metadata. [Current manifest](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/package.json), [Releases](https://github.com/hank-warren/pi-extensions/releases)

- It gates `bash` and names ending in `.bash`. File tools, native MCP tools and other custom tools are not independently reviewed. Commands unmatched by rules pass; `reviewAllShell` adds blanket shell review. There is no OS sandbox or network allowlist. [Dispatcher](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/index.ts)
- Its guardian sees user and assistant text, tool-call summaries, success/error status, selected user-dialog answers, environment facts and the exact current command. General tool-result bodies are excluded. Configured custom-message types can supply user-source evidence. Only user-source evidence is allowed to authorize an action. [Evidence construction](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/review.ts)
- Configuration is `<agentDir>/pi-auto-permissions/config.json`, with `PI_AUTO_PERMISSIONS_CONFIG` as an override. Reviewer failure asks the user or blocks headlessly; hard-deny rules block outright. These guarantees apply to **gated commands**, not every shell effect. [Configuration](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/config.ts), [Review handling](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/index.ts#L388)
- Models resolve through `ctx.modelRegistry`; current source prefers the host `ModelRuntime` transport. A local reviewer is possible. Its prompt selector uses **`ui.custom()`**, requiring adaptation for Jezo. [Guardian transport](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/guardian-transport.ts), [Selector](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/prompt-select.ts)
- Regex coverage is not containment; arbitrary scripts and unmatched commands remain capable of outward effects. An open queue issue concerns approval/evidence ordering, but current source holds a decision slot across the user prompt, so the report alone does not establish a current bypass. [Issue #41](https://github.com/hank-warren/pi-extensions/issues/41), [Current queue handling](https://github.com/hank-warren/pi-extensions/blob/main/packages/pi-auto-permissions/index.ts#L548)

**Assessment (inference):** useful evidence design—especially dialog answers and explicitly configured automation requests—but insufficient for Jezo’s MCP/plugin exit boundary.

**`pi-permission-classifier` 0.5.2 is an auto-approval link, not a conversational authorization reviewer.**

- It requires `@gotgenes/pi-permission-system` **27.0.0+** and explicit activation through `authorizerChain: ["classifier"]`. It reviews asks outside the path/external-directory families; deterministic denies remain in force. There is no sandbox. [README](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/README.md)
- The model sees structured ask facts, the decision value, executed bash unit, enclosing full bash command and selected guidance files. It sees **neither user conversation messages nor tool results**. For non-bash tools it does not generally receive the complete argument payload. **Inference:** it cannot establish that a particular recipient/upload was requested. [Prompt renderer](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/src/prompt.ts), [Command-context extraction](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/src/context.ts)
- Missing configuration, unresolved models, authentication failure, timeout, invalid replies and internal errors defer. The underlying system then prompts, or denies when nobody can answer. The default timeout is five seconds. [Reviewer](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/src/reviewer.ts)
- Configuration is `<agentDir>/extensions/pi-permission-classifier/config.json`, optionally overridden by a trusted project file. It respects `PI_CODING_AGENT_DIR`. Guidance loading separately reads context files from disk; Jezo’s `noContextFiles` loader setting is not itself the classifier’s policy. [Extension](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/src/extension.ts), [Guidance loader](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/src/guidance.ts)
- Local models are explicitly supported through the registry, but must produce a forced **`report_verdict` tool call**. A server/model that cannot do so defers. Its TUI model picker needs a GUI equivalent; the authorizer itself needs no TUI. Load it before the permission system so startup registration is ready immediately. [Model review](https://github.com/TacoTakumi/pi-permission-classifier/blob/main/src/model-review.ts)

**Assessment (inference):** reasonable for auto-approving routine development asks. Do not use it to approve Jezo’s private-data exits.

**MasuRii’s `pi-permission-system` 0.8.0 is the older deterministic implementation.**

- It filters tool visibility and gates bash patterns, paths, skills and MCP operations. Its MCP-specific support targets the older umbrella `mcp` tool; direct tools use ordinary tool permissions. No OS sandbox, domain filtering or reviewer is supplied. [Dispatcher](https://github.com/MasuRii/pi-permission-system/blob/main/src/index.ts), [Permission manager](https://github.com/MasuRii/pi-permission-system/blob/main/src/permission-manager.ts)
- Policy defaults to `ask`. A non-subagent session without UI denies asks; subagent asks can be forwarded. Its approval dialog uses `select`, so a normal GUI bridge is possible. [Confirmation path](https://github.com/MasuRii/pi-permission-system/blob/main/src/index.ts#L1257), [Dialog](https://github.com/MasuRii/pi-permission-system/blob/main/src/permission-dialog.ts)
- Policy uses `<agentDir>/pi-permissions.jsonc`, agent frontmatter and legacy locations; `getAgentDir()` honors the environment. **Runtime config and logs default to the installed extension’s directory**, with separate environment overrides. They do not automatically live at a stable agent-directory path after npm installation. [Policy paths](https://github.com/MasuRii/pi-permission-system/blob/main/src/permission-manager.ts#L29), [Runtime config paths](https://github.com/MasuRii/pi-permission-system/blob/main/src/extension-config.ts)
- Its declared pi peer ranges stop at 0.80.x. Open issues include stale extension contexts, active-tool filtering, wrong config locations and ineffective tilde patterns. [Manifest](https://github.com/MasuRii/pi-permission-system/blob/main/package.json), [Issues](https://github.com/MasuRii/pi-permission-system/issues)

**Assessment (inference):** prefer the maintained gotgenes fork.

**`@gotgenes/pi-permission-system` 36.2.0 is the strongest reusable policy mechanism.**

- It supplies allow/ask/deny rules, tool visibility, bash AST analysis, directional path/external-directory gates, custom access extractors, authorizer registration, prompt queues and decision events. It supplies **no OS sandbox or network enforcement**. [Core composition](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/index.ts), [Public integration API](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/cross-extension-api.md)
- Gate errors block. Unresolved bash constructs ask rather than silently passing. Invalid higher-scope configuration clamps inherited allows to asks. Without an available UI/parent, asks deny; registered authorizer links can still decide before that terminal denial. [Policy manager](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/policy/permission-manager.ts), [Authorizer selection](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/authorizer-selection.ts)
- Configuration/logs have stable locations under `<agentDir>/extensions/pi-permission-system/`; project config requires pi project trust. It respects `PI_CODING_AGENT_DIR`. Non-TUI modes use `select`/`input`; TUI mode uses a custom component. Jezo’s `mode: "json"` is therefore useful. [Paths](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/config/config-paths.ts), [Prompt dispatch](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/authority/permission-prompt-component.ts)
- **Native MCP qualification:** `mcp__server__tool` is classified as an ordinary extension tool, not the older umbrella `mcp` surface. Configure native names such as **`"mcp__*": "ask"`** or specific tool names; do not assume an `mcp` proxy rule covers them. Surface wildcard matching supports this. [Tool classification](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/access-intent/tool-kind.ts), [Input normalization](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/access-intent/input-normalizer.ts), [Rule matching](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/src/policy/rule.ts)
- It has no built-in general reviewer. A local model is possible through an authorizer plugin or Jezo’s own link. The first-party `pi-permission-model-judge` detects suspicious typo paths and returns deny/defer; it is not an outbound authorization reviewer. [Model-judge README](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-model-judge/README.md)
- Current reports identify native-read target normalization disagreement on **pi 0.99.1**, overly broad session directory grants and incorrect projection after shell variables are reassigned. These are concrete reported defects, not proofs that OS containment fails. [Issue #997](https://github.com/gotgenes/pi-packages/issues/997), [Issue #989](https://github.com/gotgenes/pi-packages/issues/989), [Issue #995](https://github.com/gotgenes/pi-packages/issues/995)

**Assessment (inference):** use it for policy composition and GUI integration, with SRT enforcing shell effects. Do not rely on its parsed path decisions as the sole filesystem boundary.

**Maintenance and compatibility evidence is encouraging but uneven.** Download counts below are gallery snapshots, **not unique users**. Sizes are displayed package sizes, not complete dependency footprints. All seven extensions are MIT; both sandbox runtimes are Apache-2.0.

| Package | Release / metadata | Size; monthly downloads | Tests inspected in repository | Maintenance and pi 0.99 assessment |
|---|---|---|---|---|
| [permission-modes](https://pi.dev/packages/pi-permission-modes) | 2.4.1, Sep 24 | 327 KB; 1,104 | 18 test files, including parser/guard/lifecycle regressions | 12 stars; commits/releases Sep 24; peers `*`; SDK adaptations needed |
| [sandbox](https://pi.dev/packages/pi-sandbox) | 0.6.8, Sep 8 | 1.8 MB; 4,953 | 6 test files; policy, runtime, network and session isolation | 254 stars; commits Sep 17; peer `^0.80.0` excludes 0.99 |
| [verdict](https://pi.dev/packages/pi-verdict) | 0.12.1, Sep 28 | 166 KB; 3,728 | Stubbed gate/classifier regression tests | 10 stars; active Sep 28; peer `>=0.84.0` includes 0.99 |
| [Hank auto-permissions](https://pi.dev/packages/%40hank-warren/pi-auto-permissions) | Source/release 0.18.0 Sep 30; gallery 0.16.2 | Older snapshot: 304 KB; 3,409 | 20 test files; includes real SDK contract tests with synthetic inference | Active Sep 30; peer `*`; custom UI needs adaptation |
| [classifier](https://pi.dev/packages/pi-permission-classifier?name=pi&sort=recent) | 0.5.2, Sep 25 | 121 KB; 284 | 13 test files; reviewer, guidance, breaker and registration | 2 stars; no open issues observed; declared ranges include 0.99 |
| [MasuRii system](https://pi.dev/packages/pi-permission-system) | 0.8.0, Jul 3 | 645 KB; 1,674 | 14 test files | 168 stars; last commits Jul 3; peer ranges exclude 0.99 |
| [gotgenes system](https://pi.dev/packages/%40gotgenes/pi-permission-system) | 36.2.0, Sep 30 | 1.7 MB; 50.2K | 193 test files in package test tree | Active daily; monorepo 237 stars; peer `>=0.79.0`; reported 0.99 defect above |

The gotgenes package is substantial: its source tree contains **166 files, approximately 1 MB**. That is a real maintenance/dependency tradeoff, despite extensive tests. [Source tree](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system/src)

Peer compatibility is not runtime verification. Pi 0.99.1’s extension loader also aliases old `@mariozechner/*` imports and the pi-ai root to compatibility modules. Consequently, an old namespace alone does not prove incompatibility; directly importing a factory outside that loader can behave differently. [Pi extension loader](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/loader.ts)

**Other serious candidates found during the search do not change the recommendation.**

- **`@czottmann/pi-automode` 1.17.0:** mature contextual gate, no OS sandbox; bash parsing with `unbash`, deterministic floors and a two-stage model classifier. It includes budgeted user/tool-call evidence, excludes result bodies, and blocks reviewer failures. Local registry models work; asks use `confirm`. However, its configuration constants **hard-code `~/.pi/agent`**, violating Jezo isolation. MIT; 292 KB; about 4,929 downloads/month; 180 stars; active September commits and ten test files. [Classifier](https://github.com/czottmann/pi-automode/blob/main/extensions/auto-mode/classifier.ts), [Transcript](https://github.com/czottmann/pi-automode/blob/main/extensions/auto-mode/transcript.ts), [Hard-coded paths](https://github.com/czottmann/pi-automode/blob/main/extensions/auto-mode/constants.ts), [Package metadata](https://pi.dev/packages/%40czottmann/pi-automode)
- **`pi-better-sandbox` 0.8.0:** own macOS Seatbelt/Linux Bubblewrap backend, including kernel-contained file workers; unavailable confined launches fail closed. Network is on/off rather than domain-scoped. Main confinement starts off; enabled confinement rejects tools lacking its verified adapters, including ordinary MCP integrations. It replaces file tools, conflicting with Jezo’s write service. Configuration follows `getAgentDir()`. No reviewer. Its README acknowledges remaining git-hook/config persistence and IPC/keychain limits. MIT; twelve package test files plus shared tests, including real kernel tests; release Sep 30. The gallery’s older 0.7.2 snapshot reports 278 KB and 1,382 downloads/month. [Current README](https://github.com/1aboveio/pi-better-harness/blob/main/packages/pi-better-sandbox/README.md), [Tool admission](https://github.com/1aboveio/pi-better-harness/blob/main/packages/pi-better-sandbox/shared-task-sandbox.ts), [Kernel tests](https://github.com/1aboveio/pi-better-harness/blob/main/packages/pi-better-sandbox/test/foreground-shell.kernel.test.ts)
- **`@fadouse/pi-permission` 0.1.2:** own Seatbelt/Bubblewrap profiles, write/edit preflight, explicit escalation and an optional model reviewer. Sandbox absence defaults closed; approved escalation can execute unsandboxed. Network is boolean; reads are broadly allowed. The reviewer sees action/request JSON and local risk hints, not conversational authorization. Local registry models are possible through pi’s compatibility loader. GUI prompts use `select`. Global config **hard-codes `~/.pi/agent/permissions.json`**. MIT; 65 KB; eight test files; zero stars/issues observed and last activity May 19. [Sandbox](https://github.com/Fadouse/pi-permission/blob/main/src/sandbox.js), [Reviewer](https://github.com/Fadouse/pi-permission/blob/main/src/auto-review.js), [Configuration](https://github.com/Fadouse/pi-permission/blob/main/src/config.js), [Metadata](https://pi.dev/packages/%40fadouse/pi-permission?name=permissions)
- **`pi-claude-sandbox` + `pi-claude-permissions`:** an older fork combination: SRT fork `^0.0.43` for bash, plus deterministic tool rules. No reviewer; human asks use `select`; global permission paths use `getAgentDir()`. The sandbox explicitly continues **unsandboxed when wrapping fails**, and initialization failure disables it. The permissions extension defaults unspecified actions to allow. MIT; old pi peers/compatibility imports; sandbox last activity April 25. **Inference:** inferior to current alternatives for Jezo. [Sandbox source](https://github.com/tuansondinh/pi-claude-sandbox/blob/main/index.ts), [Sandbox manifest](https://github.com/tuansondinh/pi-claude-sandbox/blob/main/package.json), [Permission source](https://github.com/tuansondinh/pi-claude-permissions/blob/main/extensions/index.ts)

**The direct SRT option from `bash-sol.md` remains preferable for execution (inference).** Upstream is now **0.0.78**. Pi’s `BashOperations` already provides streaming output, cancellation, timeout, environment and exit status. Jezo can supply the executor while preserving its existing file tools and write checks. [SRT manifest](https://github.com/anthropics/sandbox-runtime/blob/v0.0.78/package.json), [Pi bash interface](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/tools/bash.ts)

Compared with the wrappers, Jezo can explicitly require:

- failure of sandbox initialization or wrapping to fail the tool call;
- absolute workspace paths and deliberate session concurrency;
- compatibility escapes disabled unless specifically needed;
- connection-specific network authority rather than a union of development domains;
- preservation of Jezo’s write service and shell-change undo.

SRT’s domain filtering does not authorize recipients or operations. Its request filter and experimental TLS termination can inspect compatible traffic; otherwise a plugin broker must perform that check. Allowed-host encrypted tunnels remain opaque. [Network configuration](https://github.com/anthropics/sandbox-runtime/blob/v0.0.78/src/sandbox/sandbox-config.ts)

### 2. Pi packages and MCP inside Jezo

**Yes: `DefaultPackageManager` works with Jezo’s own agent directory.** It accepts `{ cwd, agentDir, settingsManager }`; managed npm installations go under `<agentDir>/npm`, git checkouts under `<agentDir>/git`. `install()` installs without persisting a declaration; **`installAndPersist()`** also adds the source to settings. Removal, updates, configured-package listing and progress callbacks are available. [Package manager](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/package-manager.ts)

Jezo’s current configuration prevents those installations from becoming session resources: settings are in memory, `noExtensions`/`noSkills` are true, and the loader receives only selected factories and workspace skill paths. [Jezo host](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:246)

**The SDK integration sequence should be:**

1. Create persistent Jezo-only settings with `SettingsManager.create(workspace, agentDir, { projectTrusted: false })`, or a Jezo-backed `SettingsStorage`.
2. Use those settings and the same directory in `DefaultPackageManager`.
3. Install/persist the chosen `npm:` or `git:` source.
4. Construct `DefaultResourceLoader` with the same settings. Enable installed extensions/skills, or explicitly pass the resolved selected paths while retaining disabled ambient discovery.
5. Call `loader.reload()`, then pass it to `createAgentSession`.
6. Call `session.bindExtensions(...)` to emit session startup. Apply changes to existing idle sessions with `session.reload()` or start a new session.

Keep Jezo’s custom tools, system prompt and context isolation. Pi package resource filters already select extensions, skills, prompts and themes independently; a skill-only installation can use `extensions: []`. TUI themes do not become React themes automatically. [Resource loader](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/resource-loader.ts), [Package formats and filters](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/packages.md)

`PI_OFFLINE=1` prevents resource resolution from automatically fetching missing packages; explicit installation is a separate operation. This fits Jezo’s existing “no background downloads” choice. [Resolution implementation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/package-manager.ts)

**No TUI does not mean prompts magically reach React.** Without `uiContext`, pi supplies no-op UI methods: `confirm()` resolves false; `select()`/`input()`/`custom()` resolve undefined; notifications disappear; `hasUI` is false. Jezo currently binds `mode: "json"` but supplies no UI context. [Extension runner](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/runner.ts), [Current binding](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/agent/host.ts:282)

Jezo should provide an `ExtensionUIContext` through:

```ts
await session.bindExtensions({
  mode: 'json',
  uiContext: jezoExtensionUI,
  onError: reportExtensionError,
})
```

The bridge needs queued IPC requests, session/request IDs, cancellation, timeout handling, notifications and visible status. It must return the original selected option string. Set up the bridge **before session startup**. Keep `mode: "json"` so packages offering a non-TUI path use it. Arbitrary `ui.custom()` TUI components require package-specific adaptation; React cannot render them directly. [UI contract](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/extensions/types.ts)

**Pi invokes external package-manager binaries.** By default it spawns `npm`; `npmCommand` is an executable-and-arguments array. Current code recognizes npm, pnpm and Bun and adjusts managed-install options, including avoiding installation of host-provided pi peers. Git is separately invoked as literal **`git`** from `PATH`; there is no corresponding git-command setting. Git installs clone/check out the source and install dependencies when a `package.json` exists. [Command construction](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/package-manager.ts)

**Packaged Electron options are therefore:**

| Option | Practical consequence |
|---|---|
| Bundled npm CLI run by Electron | Viable: launch Electron with `ELECTRON_RUN_AS_NODE=1` and npm’s JS entry point. Requires the RunAsNode fuse, unpacked launchers, and `node`/`npm`/`npx` availability for child scripts. |
| Bundled Node and npm | Most predictable compatibility. Extra binaries and updates; installing native dependencies still needs compatible prebuilds or build tools. |
| Bundled Bun | Pi supports it directly. Bun suppresses many dependency lifecycle scripts unless trusted, so package behavior can differ from npm. |
| Fetch npm tarballs directly | Easy for self-contained packages; not an npm dependency solver. Dependencies, lifecycle scripts, executable links and native modules remain work. |
| GitHub archives | Good for Jezo’s existing skill downloads. They are not a drop-in implementation of pi’s git clone/update/ref behavior. |

A packaged launcher named `npm`, configured through `npmCommand`, is cleaner than relying on shell setup. It can set child-only environment and invoke either bundled Node or Electron. **Inference:** avoid setting `ELECTRON_RUN_AS_NODE` globally in Jezo’s main-process environment. Git support still needs a bundled binary, a deliberately chosen external installation, or a separate archive-backed source path.

Electron documents Node mode and its fuse restriction. **Hyper provides an actual precedent:** it invokes bundled Yarn with `process.execPath` and `ELECTRON_RUN_AS_NODE`, inside its plugin installation directory. Atom’s older `apm` bundled Node/npm and supplied native-module build settings. [Electron environment variables](https://www.electronjs.org/docs/latest/api/environment-variables#electron_run_as_node), [Hyper installer source](https://github.com/vercel/hyper/blob/canary/app/plugins/install.ts), [Atom package manager](https://github.com/atom/apm), [Bun lifecycle behavior](https://bun.com/docs/pm/lifecycle)

Bundling a runtime does not make arbitrary native addons installable on a Mac without developer tools. Addons loaded inside Electron also need Electron-compatible builds. [Electron native-module documentation](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules)

**MCP works in SDK sessions, but must be explicitly installed into the resource loader.** Add factories for:

- `createMcpExtension()`;
- `createCodemodeExtension(...)` for codemode exposure;
- `createToolSearchExtension()` for deferred exposure.

Then bind extensions to start connections. Pi’s SDK example warns that an explicit `tools` allowlist can hide MCP tools; Jezo should reconcile its current `tools: TOOL_NAMES` with dynamic registration, using `defaultTools` where appropriate. [SDK MCP example](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/examples/sdk/14-codemode-mcp.ts)

Pi already provides stdio and streamable HTTP, connection lifecycle, tool discovery, OAuth and exposure modes. **Legacy SSE is unsupported.** Native tools are named `mcp__<server>__<tool>`. Calls from codemode still pass through `tool_call`/`tool_result`, carrying a parent call ID. MCP annotations are available to permission extensions, but they describe tools rather than proving authorization. [MCP documentation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md)

**OAuth credentials can be redirected.** The default is `<agentDir>/mcp-auth.json`, keyed by server URL. `createMcpExtension({ credentials })` accepts a credential store; `McpOAuthCredentialStore` accepts a custom `AuthStorageBackend` and optional refresh-lock directory. [MCP options](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/index.ts), [OAuth storage](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/extensions/mcp/oauth.ts)

Two implementation details matter:

- The credential-store class is not re-exported from pi’s root entry point in 0.99.1. Prefer a small upstream export; otherwise isolate and pin an internal-file import.
- Its backend contract includes synchronous storage operations. Jezo’s current `getSecret()` is synchronous but `storeSecret()` is asynchronous, so it needs an adapter rather than direct reuse. Preserve refresh locking across concurrent sessions. [Auth backend contract](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/src/core/auth-storage.ts), [Jezo secrets](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/src/main/secrets.ts:1)

Jezo can also supply `openUrl`, `loadConfig` and `createTransport`. Those let it use Electron’s browser opener, resolve secrets per connection instead of exporting all credentials into the host environment, and launch command servers through its managed runtime. The GUI still needs connection status, login/logout, enable/disable and errors.

**For a gallery, use npm’s documented search API first (inference).** Pi discovers npm packages tagged `pi-package`. Search:

```text
GET https://registry.npmjs.org/-/v1/search
    ?text=keywords:pi-package <query>
    &size=50
    &from=0
```

Read package metadata separately for the manifest, README, version and tarball integrity. [Pi package discovery format](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/packages.md), [npm registry API](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)

I did not find a documented stable **pi.dev package-search JSON API**. The gallery exposes filtered HTML pages. PiDeck’s implementation parses those pages and records `/api/packages` as returning 501; that is another client’s observation, not an official API promise. Zeno and Screenpipe instead query npm directly. Keep address-based installation available even when search misses a package. [PiDeck catalog implementation](https://github.com/ayuayue/PiDeck/blob/main/src/main/extensions/piPackageCatalog.ts), [Zeno catalog](https://github.com/aletheics/zeno/blob/main/apps/desktop/src/main/package-catalog.ts), [Screenpipe catalog](https://github.com/screenpipe/screenpipe/blob/main/apps/screenpipe-app-tauri/lib/pi-extension-catalog.ts)

**Standalone skills should remain supported alongside pi packages (inference).** Pi packages are appropriate for distributing bundled skills, extensions and dependencies. They do not replace Jezo’s address/archive/folder installer, editable workspace destination, provenance and undo.

For a package skill the user wants to edit, offer an explicit copy into workspace `skills/`, record its origin, and disable the package copy to avoid duplicate loading. Managed-package updates otherwise overwrite edits. The current skills doc’s rejection of packages merely because extensions contain code should be reconsidered under the maintainer’s stated equal-trust decision. [Jezo skills design](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/skills.md)

### 3. One GUI install entry

**One entry should share discovery and preview, while using the correct backend for each format (inference).**

| Input | Preview | Installation |
|---|---|---|
| Skill GitHub address, archive, local folder/file | Discovered skill names, descriptions, companions and existing-name conflicts | Existing Jezo installer → workspace `skills/` |
| `npm:package@version` | Package metadata and declared pi resources | `DefaultPackageManager.installAndPersist()` |
| `git:…@ref` | Repository/ref and declared resources | Pi git package installation |
| MCP URL | Server name, HTTP transport and sign-in requirements | Entry in `<agentDir>/mcp.json` |
| MCP command + arguments | Executable, arguments, runtime requirements and secret fields | Stdio entry in `mcp.json`; provision runtime/dependencies |
| Pasted Claude Desktop/Cursor JSON | Every `mcpServers` entry, individually selectable | Preserve pi-compatible command/URL/config fields |

The flow can be **paste or choose → inspect → install → show installed resources and connection state**. A bare repository or URL can be ambiguous; show the discovered contents and let the owner choose its meaning.

Pi’s MCP format already accepts:

```json
{
  "mcpServers": {
    "local": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": { "API_KEY": "${SERVER_KEY}" }
    },
    "remote": {
      "url": "https://example.com/mcp",
      "exposure": "direct"
    }
  }
}
```

The parser understands `command`, `args`, `env`, `cwd`, URL/headers/OAuth, enabled state and exposure. `command` is one executable—not a shell command string. Claude Desktop/Cursor configs generally share this shape. Secrets pasted as literals should be moved into Jezo’s secret store before saving the non-secret configuration. [Pi MCP configuration](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md)

**Pi already gives Jezo** package source parsing, installation/update/removal, resource manifests and filtering, skill loading, MCP parsing/transports/OAuth, and permission hooks.

**Jezo must build** the unified dialog, archive discovery/provenance/undo, packaged runtimes, secret handling, React prompt bridge, resource lifecycle, connection management and action authorization. A package installation’s progress callback is not a complete GUI log stream; the installer process/launcher needs usable diagnostics.

The installer also needs to distinguish an owner’s concrete installation request from a user-started conversation that later reads hostile content. **Inference:** `currentActing().source === "user"` alone is not evidence that the owner authorized installing new lasting instructions or widening a connection grant.

**My short recommendation (inference):**

1. Adopt **`DefaultPackageManager` + `DefaultResourceLoader` + built-in MCP factories**.
2. Implement bash through current upstream **SRT 0.0.78 and `BashOperations`**, with failure closed and Jezo’s undo retained.
3. Use **`@gotgenes/pi-permission-system`** for shared rules, approvals and decision events; configure native MCP names explicitly.
4. Add a Jezo authorizer that receives the complete action, owner request/standing grant and automation provenance. Keep generic classifiers optional, local by default, and never let their failure remove containment.
5. Prove installation, native/codemode MCP gating, malicious-content exits and shell undo together in an Electron E2E run. Retain transcript, policy, request logs and filesystem changes as repeatable artifacts.

**Open questions for the maintainer:**

- Does installing a connection authorize all account actions, or should read, send/upload and destructive operations have separate grants?
- Must arbitrary native macOS CLIs work initially, and which two integrations will prove the design?
- Prefer bundled Node/npm, or Electron Node mode? Will full git installation/update ship at launch?
- Where should package and connection declarations live so a workspace backup restores the user’s setup?
- Is the substantial gotgenes policy engine worth adopting, or would Jezo prefer a smaller exit-focused gate built on pi’s existing hooks?
