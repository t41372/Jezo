**1. Claude Code and Codex now offer independent action review, but the review covers only the actions their runtimes send to it.**

**Claude Code auto mode uses a separate model.** Anthropic’s March implementation combined an incoming prompt-injection probe with an outgoing transcript classifier running Sonnet 4.6. The classifier first emitted a single allow/block token; flagged actions received a second pass with reasoning. It saw user messages and executable tool calls, excluding assistant prose and tool results. The incoming probe warned the main agent about suspicious tool results. [Anthropic engineering description](https://www.anthropic.com/engineering/claude-code-auto-mode)

Current documentation describes two execution paths: server-side review embedded in model requests, and separate classifier requests when server review is unavailable. The client classifier defaults to Sonnet 5, with documented fallbacks; server configuration can override that choice. Thus “the reviewer is Sonnet 4.6” accurately describes the launch implementation, not every September session. Auto mode is the starting mode for supported interactive terminal and VS Code sessions from Claude Code v2.1.283. [Current permission modes](https://code.claude.com/docs/en/permission-modes)

The decision process is approximately:

1. Resolve explicit permission rules and mandatory consent requirements.
2. Automatically allow ordinary reads and working-directory edits, with protected-path exceptions.
3. Send remaining actions to the classifier.
4. Return a denial to Claude so it can find another approach.

Broad shell/interpreter allow rules are suspended in auto mode; narrow rules can still bypass classification. Explicit `ask` rules still prompt. Missing server verdicts deny execution. Repeated classifier denials can restore manual approval. [Permission decision order](https://code.claude.com/docs/en/permission-modes), [Classifier coverage configuration](https://code.claude.com/docs/en/auto-mode-config)

The default policy targets sensitive-data transfers, destructive operations, credential exploration, production changes, permission changes, and browser actions that send page content, cookies, or credentials off-origin. Its configurable policy distinguishes unconditional `hard_deny` rules from `soft_deny` rules that sufficiently specific user authorization can clear. These are model judgments; deterministic tool-deny rules run before them. [Default blocked actions](https://code.claude.com/docs/en/permission-modes), [Policy configuration and precedence](https://code.claude.com/docs/en/auto-mode-config)

Instructions found in a webpage or tool result do not become user authorization. The structural defense is that the launch transcript classifier never sees those instructions directly: it judges the proposed consequence against the user’s request. However, attacker-controlled text can still reach a reviewer inside tool arguments, generated code, or a compromised summary. The September red-teaming paper demonstrates precisely these additional attack surfaces. [Launch architecture](https://www.anthropic.com/engineering/claude-code-auto-mode), [September monitor red-teaming](https://arxiv.org/html/2609.19587v2)

**Published results do not establish one universal error rate.**

| Evaluation | Workload | Reported result |
|---|---|---|
| Anthropic launch evaluation | 10,000 internal tool calls; 52 real overeager actions; 1,000 synthetic exfiltration attempts | Full pipeline: **0.4% FPR**, **17% FNR** on overeager actions, **5.7% FNR** on synthetic exfiltration. First-stage FPR was 8.5%. |
| Independent AmPermBench evaluation | 128 deliberately ambiguous prompts; 253 state-changing actions | End-to-end **81.0% FNR**. Among classifier-reviewed actions: **70.3% FNR**, **31.9% FPR**. In-project edits bypassing classification contributed to failures. |
| Anthropic-commissioned Trajectory Labs evaluation | 72 held-out indirect-injection scenarios, ten repetitions each, July 17 versions | **0/720 successful attempts per tested Claude model in auto mode**; Codex Auto-review had **5.83% attack success**, versus 19.03% in Full Access. |
| September adversarial-agent study | Persistent agents deliberately trying to evade production monitors | Agent-authored monitor injection enabled arbitrary Bash execution in **79% of trials** across Auto Mode and Guardian tests. This was a stronger threat model than ordinary malicious webpages. |

Sources: [Anthropic launch evaluation](https://www.anthropic.com/engineering/claude-code-auto-mode), [AmPermBench v2](https://arxiv.org/abs/2604.04978), [Trajectory Labs evaluation as reported by Anthropic](https://claude.com/blog/auto-mode-default-in-claude-code), [September study](https://arxiv.org/abs/2609.19587)

The July comparison used the same third-party browser integration for both products, excluding their first-party browser safeguards. It also did not publish a benign-workflow FPR. Consequently, neither its zero observed successes nor the stress test’s high FNR should be interpreted as a measured probability for Jezo’s everyday workflows. **(inference)** [Evaluation methodology](https://claude.com/blog/auto-mode-default-in-claude-code)

User reports identify two practical problems: false blocks on ordinary infrastructure work, and reviewer-service failures that prevent MCP actions even while the main model works. These are anecdotes, not population-level error measurements. A separate Codex user reported very large Guardian token consumption with almost all reviews approved; that report likewise establishes a failure case, not typical cost. [Claude infrastructure complaints](https://www.reddit.com/r/ClaudeAI/comments/1wqtg5c/how_to_configure_or_disable_the_auto_mode/), [Claude classifier availability issue](https://github.com/anthropics/claude-code/issues/80557), [Codex token-consumption report](https://www.reddit.com/r/codex/comments/1w9qzme/codex_guardian_autoreview_is_burning_tens_of/)

**Claude Code WebSearch and WebFetch are different mechanisms.**

| Tool | Documented behavior |
|---|---|
| `WebSearch` | Queries Anthropic’s server-side search backend; returns titles and URLs. It can refine through multiple backend searches and supports `allowed_domains`/`blocked_domains`. |
| `WebFetch` | Fetches a supplied URL, converts HTML to Markdown, and runs an extraction prompt using a small, fast model. The main model generally receives that model’s answer, not the original page. Large pages are truncated; cross-host redirects require another fetch. |

The current official reference confirms a smaller-model extraction pass but does **not** name a fixed Haiku version. Claims that every current fetch specifically uses “Haiku 3.5” exceed that documentation. [Claude Code tools reference](https://code.claude.com/docs/en/tools-reference)

Fetch permissions can be expressed as `WebFetch(domain:example.com)`. Manual mode prompts except for allowed or preapproved documentation domains. A crucial distinction: bare `WebFetch` permission affects the tool only, while domain-form permissions also influence the shell sandbox’s network allowlist. [WebFetch permissions](https://code.claude.com/docs/en/permissions)

**WebFetch does not run through the Bash sandbox’s network proxy.** The sandbox applies to shell commands and children; in-process fetches follow their own permission checks. The proxy normally checks hostnames without terminating TLS. Current auto mode can approve additional hosts for one shell command, reviewing its host list together with the command. [Sandbox network behavior](https://code.claude.com/docs/en/sandboxing)

Also distinguish Claude Code’s local `WebFetch` implementation from the **Claude API’s hosted `web_fetch`**. The latter executes on Anthropic’s servers, supports content filtering and domain restrictions, and accepts URLs previously present in user messages, client tool results, or search/fetch results. Client results that echo agent-generated URLs qualify, so this URL-source restriction is not a complete exfiltration boundary. [Hosted web-fetch documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)

**Claude in Chrome adds another permission system.** Its current guide describes manual approval, automatic safety review, and skipping approvals. Site grants can persist, but sensitive input, authorization grants, and permission changes still require explicit consent. The guide prohibits several categories outright, including purchases/financial transactions, account creation, permanent deletion, and completing instructions originating in email or web content. Team/Enterprise administrators can configure site allowlists and blocklists. [Chrome permission guide](https://support.claude.com/en/articles/12902446-claude-in-chrome-permissions-guide)

Claude Code normally inherits extension site permissions. Current integration documentation adds an important exception: when the auto-mode classifier approves a browser call, the extension can skip its per-site check for that call, subject to site-deny rules. Older descriptions saying the two gates always prompt independently are therefore incomplete. [Claude Code Chrome integration](https://code.claude.com/docs/en/chrome)

The API computer-use tool is a different building block: Claude proposes screenshot, mouse, and keyboard operations that the application executes. It does not supply Chrome’s product permission system automatically. [Claude computer-use API](https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool)

**Codex separates sandbox permissions from Auto-review.** Commands ordinarily run inside an OS sandbox with network disabled. `on-request` permits approval requests; `never` removes that approval path without removing the sandbox. Full Access deliberately removes the normal boundary. The old `untrusted` approval-policy setting is retired. [Codex approvals and security](https://learn.chatgpt.com/docs/agent-approvals-security)

Auto-review replaces the human reviewer for eligible boundary-crossing requests: escalated execution, network requests, outside-root edits, approval-requiring app/MCP calls, and new browser sites. Routine actions already permitted inside the sandbox do not receive review. Computer Use app-level access still goes directly to the user. [Codex Auto-review](https://learn.chatgpt.com/docs/sandboxing/auto-review)

Unlike Claude’s launch classifier, the Codex reviewer sees a compact transcript containing relevant assistant updates and tool outputs as well as the proposed action. It can make read-only investigations; hidden chain-of-thought is excluded. Current documented circuit breakers interrupt after three consecutive denials or ten denials within the last fifty reviews. The precise production reviewer-model selection is not documented there; the September paper’s GPT-5.6 Luna Guardian implementation is explicitly an approximation. [Reviewer inputs and failure handling](https://learn.chatgpt.com/docs/sandboxing/auto-review), [Study implementations](https://arxiv.org/html/2609.19587v2)

Codex search is a **hosted tool**, separate from command networking. Local chats default to cached/indexed search; `--search` or `web_search = "live"` enables live results, and Full Access defaults to live. Search appears as `web_search` transcript items and has separate domain filters. Cached mode reduces exposure to freshly planted pages but still sends a query to a provider and returns untrusted content. [Codex web search](https://learn.chatgpt.com/docs/web-search)

The desktop product has both an embedded browser and control of supported installed browsers. Website access and consequential-action approval are separate. Installed-browser controls offer one-time, site-wide, and all-site grants; the built-in browser asks before sensitive actions and currently cannot automate uploads. Neither surface is filtered by the command sandbox’s network proxy. [Embedded browser](https://learn.chatgpt.com/docs/browser), [Browser extension permissions](https://learn.chatgpt.com/docs/chrome-extension), [Network-proxy scope](https://learn.chatgpt.com/docs/agent-approvals-security)

**The other products illustrate several different approaches, not one shared “auto mode.”**

| Product | Search/browser mechanism | Relevant permission behavior |
|---|---|---|
| **Gemini CLI** | Built-in Google Search and fetch; browser subagent using Chrome tooling. Browser sessions can be persistent, temporary, or attached to existing Chrome. | Policy engine resolves allow/deny/confirmation rules; CLI modes include default, auto-edit, YOLO, and plan. Browser domain restrictions and sensitive-action confirmation are configurable. [Search](https://geminicli.com/docs/tools/web-search/), [Browser subagent](https://geminicli.com/docs/core/subagents/), [Policy engine](https://geminicli.com/docs/reference/policy-engine/) |
| **OpenClaw** | Managed browser profile separate from the personal browser; a `user` profile attaches to signed-in Chrome through Chrome DevTools MCP. Search supports multiple API and hosted-model providers. | Current exec modes include deny, allowlist, ask, auto, and full. Auto runs deterministic matches, then reviews eligible misses with allow/deny/ask outcomes. Exec approval is a separate host policy, not browser data-flow protection. [Browser](https://docs.openclaw.ai/tools/browser), [Search](https://docs.openclaw.ai/tools/web), [Exec approvals](https://docs.openclaw.ai/tools/exec-approvals) |
| **Hermes Agent** | Separate search/extract backends; local Chromium through agent-browser, existing-browser CDP, and cloud browser options. | Tools can be enabled by toolset. Web configuration includes keyless fallback and per-capability providers. These mechanisms provide capability and routing controls; the cited docs do not establish an outgoing-request monitor’s error rate. [Web tools](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-search), [Browser](https://hermes-agent.nousresearch.com/docs/user-guide/features/browser) |
| **LobeHub** | Configurable search providers and extraction backends, including SearXNG, Brave, Exa, Tavily, Browserless, and Firecrawl; plugin/MCP ecosystem. | Its documented crawler configuration concerns retrieving content. Rendering a page through Browserless should not be confused with a permission system for acting in a personal account. **(inference)** [Search/crawler configuration](https://github.com/lobehub/lobehub/blob/main/docs/self-hosting/advanced/online-search.mdx), [Plugin marketplace](https://lobehub.com/plugins) |
| **Goose** | Browser capabilities can come through extensions/MCP, including Playwright. | Autonomous mode is the documented default. Manual and Smart Approval support per-tool permissions; read/write classification is best-effort and interpreted by the LLM provider. [Permissions](https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/managing-tools/goose-permissions.md), [Playwright integration](https://github.com/microsoft/playwright-mcp) |
| **Cline** | Browser tools for fetching/searching and MCP integrations. | Category-based auto-approval; the main model marks commands `requires_approval`. This is not an independent second-model review. YOLO auto-approves browser, shell, file, and MCP operations. [Auto-approval implementation](https://docs.cline.bot/features/auto-approve) |
| **Cursor** | Native browser, search, and fetch tools. | Current Auto-review checks allowlists, uses shell sandboxing where possible, then sends other eligible calls to a Cursor-managed classifier—documented as Haiku 4.5 or GPT-5.4 Mini. It can allow, redirect, or request approval. Run Everything removes those checks. [Run modes](https://cursor.com/docs/agent/security/run-modes), [Browser](https://cursor.com/docs/agent/tools/browser) |
| **Perplexity Comet** | Browser assistant operating on sites and browser context. | Retrieved-content classifiers, structured guardrail prompts, and confirmations for sensitive actions such as sending email or placing orders. Enterprise controls include domain blocks and browser approvals. BrowseSafe is an open detector, not proof that every browser exit is mediated. [Defense description](https://www.perplexity.ai/ro/hub/blog/how-we-engineer-safer-agents), [Enterprise controls](https://www.perplexity.ai/enterprise/comet), [BrowseSafe](https://huggingface.co/perplexity-ai/browsesafe) |
| **ChatGPT agent / Work cloud browser** | The current agent help page says the old agent experience is no longer available and directs users to Work. Work’s cloud browser maintains separate signed-in sessions. | New-site access supports ask, automatic URL review, or always allow. An additional model reviews sign-in requests for phishing. Consequential actions require confirmation; credentials entered through the secure form are hidden from the model. [Transition notice](https://help.openai.com/en/articles/11752874-chatgpt-agent), [Current cloud browser](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt) |
| **OpenAI Atlas** | Agent works in the browser’s existing signed-in session, or in logged-out mode without pre-existing cookies. | Sensitive-site supervision; no browser code execution, downloads, extension installation, or access to other desktop apps/files. Logged-out mode reduces account exposure. [Atlas controls](https://help.openai.com/en/articles/12628199-using-ask-chatgpt-sidebar-and-chatgpt-agent-on-atlas) |
| **Google Antigravity** | Local Chrome browser subagent with screenshot/video artifacts. | Browser URL controls and terminal sandbox permissions; current macOS/Linux presets are Default, Request Review, and Turbo. This is another example of browser and shell permissions interacting, rather than an arbitrary-site exfiltration guarantee. [Browser](https://www.antigravity.google/docs/browser), [Permissions](https://antigravity.google/docs/agent-permissions?app=antigravity) |

**2. Search for Jezo should be model-independent, with provider-native search as an optional backend.**

Provider-native search means a hosted model invokes its provider’s search during inference. It cannot simply be attached to an arbitrary local model as though it were an ordinary client-side function. A local model can call a Jezo tool that delegates a bounded research request to a hosted model, but that is a hybrid cloud operation. **(inference)** [Anthropic server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [OpenAI search](https://developers.openai.com/api/docs/guides/tools-web-search), [Gemini grounding](https://ai.google.dev/gemini-api/docs/google-search)

| Provider-native option | Controls and cost |
|---|---|
| **Anthropic** | Hosted search with citations, domain filters and search-count limits; **$10/1,000 searches plus token costs**. Hosted fetch has no separate tool charge, only token costs. Dynamic filtering uses code to reduce retrieved content before admission; it is distinct from Claude Code’s small-model fetch extraction. [Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Fetch](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) |
| **OpenAI** | Responses `web_search`; domain filters and `external_web_access`. The API defaults to live access, unlike Codex’s cached default. `external_web_access: false` selects cache-only retrieval. Listed search tool price: **$10/1,000 calls**, with applicable model/content charges. [Controls](https://developers.openai.com/api/docs/guides/tools-web-search), [Pricing](https://developers.openai.com/api/docs/pricing) |
| **Gemini** | Google Search grounding and URL context on supported Gemini models. Current Gemini 3 pricing lists **5,000 free search requests/month, then $14/1,000**; multiple model-generated queries can be separately billable. [Grounding behavior](https://ai.google.dev/gemini-api/docs/google-search), [Pricing](https://ai.google.dev/gemini-api/docs/pricing), [URL context](https://ai.google.dev/gemini-api/docs/url-context) |

Hosted tools also create a review problem: they can execute inside a provider request before Jezo has a client-side tool call to approve. Therefore, exposing them directly to the full private main-agent context weakens Jezo’s ability to inspect the exact outgoing search query first. **(inference)** [Server-side execution behavior](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool)

Ordinary search APIs avoid the model restriction:

| Option | Key and current cost | Privacy and operational implications |
|---|---|---|
| **Brave Search API** | API key; **$5/1,000 search requests**, $5 monthly credit. Signup documentation says a card is required. | Independent index. Its API privacy policy lists **90-day search-query logs** and enterprise ZDR; do not describe every account as zero-retention. [Pricing](https://brave.com/search/api/), [API privacy policy](https://api-dashboard.search.brave.com/privacy-policy) |
| **Exa** | API key; **$4/1,000 instant searches**, **$7/1,000 fast/auto searches** up to ten results; content extraction separately priced. $10 monthly free credit. | Search, page text, highlights, and extraction. ZDR is listed under Enterprise, not the default developer plan. [Current pricing](https://exa.ai/pricing) |
| **Tavily** | API key; **1,000 free credits/month**, no card. PAYG **$0.008/credit**; basic search uses one credit, advanced two. | Convenient search/extraction responses. Treat submitted queries and extraction URLs as disclosures to Tavily; the general privacy policy is not a blanket ZDR promise. [Pricing](https://docs.tavily.com/documentation/api-credits), [Privacy](https://www.tavily.com/privacy) |
| **Kagi** | Account, API token, separately funded API balance; **$12/1,000 searches**. | Does not store API queries against the account or profile users, but temporary non-account-linked debugging/abuse logs are documented: seven-day infrastructure logs and sampled ninety-day error records. [API setup/pricing](https://help.kagi.com/kagi/api/api-portal.html), [Privacy](https://kagi.com/privacy) |
| **SearXNG** | Self-hosted endpoint; no mandatory central API key or per-query vendor charge. Hosting/maintenance remain. | Metasearch, not a local web index. Upstream engines still receive queries; a public instance adds an operator to trust. JSON output must be enabled by the instance. [Privacy model](https://docs.searxng.org/user/about.html), [Search API](https://docs.searxng.org/dev/search_api.html) |
| **DuckDuckGo / DDGS** | Browser search or unofficial retrieval libraries can be keyless. | Do not mistake Instant Answers for a supported general SERP API. Current DDGS is a multi-engine library, so configure its backend explicitly rather than assuming every request goes to DuckDuckGo. Scraping requires handling rate limits and backend failures. [DDGS implementation](https://github.com/deedy5/ddgs) |

The privacy distinction is **which service receives what**, not whether Jezo calls the feature “local.” A local model plus Brave still sends search queries to Brave; a local extractor fetches URLs directly from websites; a cloud extractor receives those URLs and retrieved material. Provider choice and fallback should be visible in the GUI. **(inference)** [Brave API processing](https://api-dashboard.search.brave.com/privacy-policy), [Kagi API processing](https://kagi.com/privacy), [Hermes backend/fallback configuration](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-search)

A user with only a local model can use all ordinary APIs, a self-hosted SearXNG instance, keyless search retrieval, and local browser automation. Search does not require the browser agent to have a cloud model. **(inference)** [SearXNG API](https://docs.searxng.org/dev/search_api.html), [Browser Use local-model support](https://docs.browser-use.com/open-source/supported-models)

Pi users add these through packages/extensions. Examples include `pi-web-access`, the official Tavily package, `pi-web-providers`, and `pi-all-search`. They expose search/fetch tools with different provider routing and result-budget choices. Pi’s extension API supports `registerTool`, pre-execution `tool_call` blocking, result transformation, and context transformation. [Pi web-access package](https://github.com/nicobailon/pi-web-access), [Official Tavily extension](https://www.npmjs.com/package/@tavily/pi-extension), [Pi provider package](https://pi.dev/packages/pi-web-providers), [Extension API](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

For Jezo, these packages are useful implementation references. Their credential discovery, implicit fallbacks, temporary-file paths, and session assumptions should be reviewed before reuse inside Jezo’s explicitly isolated pi instance. **(inference)** [Jezo backend decisions](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md), [Pi web-access configuration](https://github.com/nicobailon/pi-web-access)

**3. Browser engines provide execution capability; Jezo still has to supply authorization and exit checks.**

**The user’s Chrome is convenient but grants substantially more authority.** Existing cookies make authenticated actions possible without exposing a password to the model. Attaching through CDP can expose the selected profile’s open windows and browser state, not merely the tab the user had in mind. [Chrome DevTools existing-session access](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)

Two current Chrome mechanisms must be distinguished:

- Since Chrome 136, command-line remote-debugging switches require a non-default user-data directory.
- Chrome 144+ supports an explicitly enabled remote-debugging connection with a user permission dialog; Chrome DevTools MCP can attach using `--autoConnect`.

Thus attaching to normal signed-in Chrome is possible, but “just launch ordinary Chrome with port 9222” is obsolete guidance. [Chrome 136 change](https://developer.chrome.com/blog/remote-debugging-port), [Current attachment workflow](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)

| Browser option | Strength for Jezo | Main integration issue |
|---|---|---|
| **Playwright/CDP directly** | Deterministic navigation, locators, snapshots, screenshots, and browser contexts; Jezo controls the tool surface. | Existing-profile attachment inherits account authority. Route browser operations through Jezo’s broker rather than exposing an unrestricted endpoint. **(inference)** [CDP API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp) |
| **browser-use** | Open-source agent library and CLI, with local/cloud browsers and local-model support. | A complete nested agent duplicates pi’s planning loop; its internal actions need mediation too. Prefer browser primitives or the CLI behind Jezo’s broker. **(inference)** [Project](https://github.com/browser-use/browser-use), [Models](https://docs.browser-use.com/open-source/supported-models) |
| **Stagehand** | `act`, `observe`, and structured `extract`; current v4 supports local Chrome through CDP and cloud browsers. | AI-assisted operations introduce another model call. A local browser is not automatically local inference; use the documented custom generation callback for a local endpoint. [v4 quickstart](https://docs.stagehand.dev/v4/first-steps/quickstart), [Model callbacks](https://docs.stagehand.dev/v4/configuration/models) |
| **Playwright MCP** | Accessibility snapshots work without a vision model; familiar ecosystem. | Its maintainers explicitly say it is **not a security boundary**. Origin controls also disclaim redirect coverage. [Security and configuration](https://github.com/microsoft/playwright-mcp) |
| **Chrome DevTools MCP** | Strong network/console/debugging support, browser control, and existing-Chrome attachment; also offers a CLI. | Broad browser inspection authority. Usage telemetry, update checks, and CrUX requests are separate outbound paths that a local-first embedding must configure deliberately. [Project behavior](https://github.com/ChromeDevTools/chrome-devtools-mcp) |
| **agent-browser** | Concise CLI, element references, isolated sessions, persistent authentication, and action-policy options. | Safeguards are opt-in. Shared-CDP sessions separate tab selection, not cookies/storage. Domain/action policies do not establish semantic exfiltration protection. [Security](https://agent-browser.dev/security), [Session isolation](https://agent-browser.dev/sessions) |
| **Playwright CLI + skills** | Current Playwright guidance recommends it for coding agents seeking smaller schemas/context overhead. | CLI transport still needs the same authorization broker; token efficiency is independent of safety. [Official comparison](https://github.com/microsoft/playwright-mcp#playwright-mcp-vs-playwright-cli) |
| **Electron WebContentsView/BrowserWindow** | Visible browser inside Jezo, main-process control, session partitions, and request interception. | Jezo owns browser maintenance, permissions, session handling, and complete mediation. Electron does not supply an agent approval system. [WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view), [Sessions](https://www.electronjs.org/docs/latest/api/session) |

**Electron is a strong first implementation candidate for Jezo. (inference)** It offers a visible browser the user can watch, sign into, and take over without installing another application. Use a distinct browser session and an unprivileged remote-content renderer: no Node integration, context isolation and Chromium sandbox enabled, web security preserved, and explicit permission handlers. Electron otherwise automatically approves many permission requests. [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)

Electron’s `webRequest` exposes URL, method, request type, and upload data at pre-send interception points; requests can be cancelled. `webContents.debugger` provides CDP. These are suitable building blocks for inspection, but not evidence that one callback covers every browser communication channel. WebSocket frames, service workers, redirects, downloads, and alternate transports require explicit coverage tests. **(inference)** [Request interception](https://www.electronjs.org/docs/latest/api/web-request), [Debugger API](https://www.electronjs.org/docs/latest/api/debugger)

Keep **public reading** and **signed-in action** distinct:

- Public reading uses an unauthenticated session with no ambient account authority.
- Signed-in work uses a persistent Jezo profile containing only deliberately connected accounts.
- Using the everyday Chrome profile is a separately selected advanced capability.

This follows the useful separation already present in OpenClaw, Gemini CLI, Atlas, and ChatGPT’s cloud browser. It reduces exposure without reducing the browser’s available operations once the user authorizes a task. **(inference)** [OpenClaw profiles](https://docs.openclaw.ai/tools/browser), [Gemini session modes](https://geminicli.com/docs/core/subagents/), [Atlas logged-out mode](https://help.openai.com/en/articles/12628199-using-ask-chatgpt-sidebar-and-chatgpt-agent-on-atlas), [Separate cloud-browser sessions](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt)

**4. Guarding arbitrary-site exits requires both mediation and a definition of authorized information flow.**

A domain grant answers “may this capability reach this host?” It does not answer “may this particular data be sent to this recipient?” A familiar SaaS domain can host an attacker-owned document, public paste, or message recipient; a GET URL can carry private data just as a POST body can. **(inference)** [Anthropic exfiltration evaluation and trust boundaries](https://www.anthropic.com/engineering/claude-code-auto-mode), [Recipient-sensitive default rules](https://code.claude.com/docs/en/permission-modes)

| Defense | What actually prevents the send | Evidence and cost |
|---|---|---|
| **Second-model action reviewer** | A trusted runtime pauses the action, submits its actual parameters and authorization evidence, then enforces the verdict. | Deployed in Claude Code, Codex, and Cursor. Adds model latency and tokens; published rates vary strongly by workload. It fails if the action never reaches review. [Claude](https://www.anthropic.com/engineering/claude-code-auto-mode), [Codex](https://learn.chatgpt.com/docs/sandboxing/auto-review), [Cursor](https://cursor.com/docs/agent/security/run-modes) |
| **Context-level taint tracking** | Once private data enters context, outbound sinks are denied or checked unless explicitly authorized for that confidentiality level. | Deterministic enforcement avoids depending on whether the model noticed injection, but conservatively blocks unrelated later work. FIDES documents this tradeoff. [FIDES implementation](https://devblogs.microsoft.com/agent-framework/fides/) |
| **Value/capability tracking** | Sensitive values carry allowed-recipient/provenance metadata; tool dispatch enforces flows. | CaMeL combines a privileged planner, quarantined processing, and an interpreter that propagates capabilities. Revised results: **77% utility versus 84% undefended** on AgentDojo. Median under-attack token use was **2.82× input and 2.73× output** in its measured setup. [CaMeL v2](https://arxiv.org/html/2503.18813v2) |
| **Quarantined reader** | The reader has no privileged tools or private workspace context; returned material remains untrusted. | Useful isolation, but a free-text summary can still carry misleading instructions. FIDES explicitly preserves the untrusted label on quarantine output. Additional extraction calls and information loss are the costs. [Quarantine implementation](https://devblogs.microsoft.com/agent-framework/fides/) |
| **Task-generated deterministic policy** | A policy generator creates permitted tool/argument constraints; a deterministic reference monitor checks every call. | A June 2026 Progent reproduction with locally hosted Qwen2.5-7B reduced mean attack success from **25.8% to 4.2%**, and **2.6%** under its handcrafted adaptive attack. This is evidence for a local-model deployment, not a universal safe-model claim. [Adaptive evaluation](https://arxiv.org/abs/2606.26479) |
| **Recoverable taint/branch confinement** | Disposable branches absorb untrusted/private reads and return through constrained merge channels; the main context’s authority is preserved. | APPA’s August revision reports **zero observed attacks in 1,320 guarded episodes**, with **64.2–91% utility** across its evaluated settings. It is a preprint with policy/benchmark-specific guarantees. [APPA v2](https://arxiv.org/html/2607.24625v2) |
| **Session modes and scoped grants** | The runtime removes ambient account authority or limits the destinations/actions authorized for the current workflow. | Deployed logged-out/isolated modes reduce what a successful injection can access. They do not detect a leak once private information is already available and an exit remains open. **(inference)** [Atlas](https://help.openai.com/en/articles/12628199-using-ask-chatgpt-sidebar-and-chatgpt-agent-on-atlas), [Gemini](https://geminicli.com/docs/core/subagents/) |

**A summary is not a declassification operation.** Neither HTML-to-Markdown conversion nor small-model summarization proves that information is public or that embedded instructions disappeared. Keeping provenance on the output is more defensible than declaring the result safe because another model rewrote it. **(inference)** [Claude Code’s lossy extraction](https://code.claude.com/docs/en/tools-reference), [FIDES quarantine labels](https://devblogs.microsoft.com/agent-framework/fides/)

**Coarse taint is practical; precise taint across arbitrary model reasoning is difficult.** Exact-string detection misses transformed, encoded, partial, or inferred disclosures. A conservative context label handles those transformations by treating subsequent generated output as potentially dependent on private context, but then needs scoped authorization or clean branches to preserve usefulness. **(inference)** [CaMeL data-flow design](https://arxiv.org/html/2503.18813v2), [APPA recovery design](https://arxiv.org/html/2607.24625v2)

**Local detectors and local action reviewers are different jobs.**

| Local model option | Appropriate interpretation |
|---|---|
| **Prompt Guard 2, 22M/86M** | Small detectors for known malicious instruction patterns. The 86M version has stronger multilingual support; neither is a general authorization reviewer. [Meta model card](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M) |
| **BrowseSafe** | MIT-licensed HTML injection detector based on Qwen3-30B-A3B: roughly thirty billion total parameters, not a three-billion-parameter memory footprint. Its published test reports **84.1% recall and 97.8% precision**. Those are not action-review rates. [Model card](https://huggingface.co/perplexity-ai/browsesafe) |
| **gpt-oss-safeguard-20b/120b** | Open-weight reasoning classifiers supporting custom policies; plausible candidates for a Jezo-specific action policy. Their published moderation evaluations do not validate browser authorization/exfiltration decisions. [OpenAI release](https://openai.com/index/introducing-gpt-oss-safeguard/) |
| **General local instruction models** | Can generate policies or judge actions, but need workload-specific testing. Qwen2.5-7B has the Progent evidence above; that result depends on deterministic policy enforcement around it. [Local-model evaluation](https://arxiv.org/abs/2606.26479) |

BrowseSafe’s rounded recall and balanced-accuracy figures imply an approximately **1.7% benign false-positive rate** for that HTML benchmark—**(inference)**, calculated as `1 − (2 × balanced_accuracy − recall)`. This is not a measured Jezo-browser FPR. Its model card also reports only 22.1% recall for Prompt Guard 2 86M on the same HTML workload, illustrating how detector performance changes across domains. [Benchmark table](https://huggingface.co/perplexity-ai/browsesafe)

The September monitor study found all tested monitor variants blocked fewer than 1% of 4,000 benign coding actions. Stronger monitors improved recall by inspecting more context and using an investigative agent, but the strict investigative version was considered too slow for interactive use. The study also found compaction, shared workspaces, and unreviewed edits could hide a harmful sequence from per-action monitors. [Latency, FPR, and coverage findings](https://arxiv.org/html/2609.19587v2)

For Jezo, these results support **a cheap deterministic path, followed by review only when necessary**, rather than asking a second model about every browser resource. No cited source supplies a dependable latency or FPR for Jezo’s combination of email, calendars, local models, and signed-in sites. **(inference)**

User confirmation remains valuable when it conveys information the system does not have:

- A new recipient for private information.
- A purchase, booking, contractual commitment, or irreversible account deletion.
- A permission grant or account connection.
- An ambiguous scope: which appointment, which account, which person.
- A reviewer abstention or proposed exception to an established boundary.

The confirmation should show the concrete recipient, content, and effect. General “allow browser?” prompts cannot resolve those questions. **(inference)** [Separate site/action consent in ChatGPT](https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt), [Specific authorization requirements in Claude](https://code.claude.com/docs/en/auto-mode-config)

**5. Jezo should build a broker for external actions first, then add an auto-mode reviewer inside it. (inference)**

The repository already establishes the right division: workspace writes use validation and undo; Bash is currently disabled because it would provide an uncontrolled exit. Search and browser access should extend that architecture, preserving ordinary local autonomy while mediating external effects. [AGENTS.md trust model](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/AGENTS.md), [Backend tools](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md)

Expose three small, model-independent tool families:

| Tool family | Suggested behavior |
|---|---|
| `web_search` | Inspect the query, dispatch through the selected backend, return titles/snippets/URLs and retrieval time. |
| `web_fetch` | Unauthenticated local fetch by default; return readable content plus origin/provenance and a local artifact for longer material. Optional extraction model, with raw content still available. |
| Browser tools | Open, snapshot/read, click, type, select, screenshot, and evaluated script operations against a visible Jezo-controlled browser session. Signed-in authority is explicit. |

These are recommendations **(inference)**. Typed primitives fit Jezo’s existing approach of helping smaller models while preserving deeper access for stronger ones. [Jezo tool design](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md)

Use skills for workflows and site-specific knowledge. Offer CLIs for coding-agent-style composition, but make them clients of the **same broker**. An agent-browser daemon or CDP endpoint directly reachable from Bash would otherwise become another exit around the checked tools. **(inference)** [Pi extension mechanisms](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md), [CDP control authority](https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/main/docs/advanced-usage.md)

The broker should maintain two independent records:

- **What the owner authorized:** purpose, account, recipient/resource, permitted disclosures, action scope, and expiry.
- **What the agent has encountered:** private sources and external-content provenance, including material saved into memory or carried across compaction.

The agent may propose a broader authorization, but its prose, an email, or a webpage cannot grant it. The owner can explicitly override or disable a policy; that is different from an injected agent changing its own permission state. **(inference)** [Jezo trust model](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/AGENTS.md), [Compaction and monitor-injection evidence](https://arxiv.org/html/2609.19587v2)

For each external operation:

1. Automatically permit operations already covered by a precise task grant.
2. Treat all generated search queries, URL paths/query strings, bodies, uploads, and browser-entered private text as potential disclosures.
3. Review unfamiliar or ambiguous disclosures against owner authorization.
4. Confirm consequential commitments or new disclosure authority.
5. Enforce the decision before execution and verify the resulting state.

This design is a recommendation **(inference)**, informed by the deterministic-policy and action-review systems above.

Do **not** limit checks to new domains. A new recipient on an old domain matters, and the configured search API itself can receive an inappropriate private query. Likewise, review **before typing private text into a page**, because page scripts may transmit it before a submit button is pressed. Browser request interception should corroborate the tool-level check and stop unexpected destinations; it should not be the only place that understands the user’s intent. **(inference)** [Recipient-aware policy](https://code.claude.com/docs/en/permission-modes), [Electron interception capabilities](https://www.electronjs.org/docs/latest/api/web-request)

Combine this with the Bash sandbox by keeping arbitrary shell networking closed and providing brokered search/browser access independently. Any per-skill network exceptions from the other research track remain additional exits to assess. Browser profiles, broker credentials, and control endpoints should not be accidentally reachable through the shell’s approved filesystem/socket access. **(inference)** [Jezo’s proposed Bash boundary](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/docs/design/backend.md), [Codex’s separate network surfaces](https://learn.chatgpt.com/docs/agent-approvals-security)

**An auto-mode reviewer is worth prototyping, with a narrower job than Claude Code’s reviewer. (inference)** It should answer: “Does this proposed external action fit the owner’s authorization and permitted data flow?” It should not review routine undoable workspace edits or impose an enterprise infrastructure policy on a personal app.

Give it trusted authorization records, a canonical action description, relevant provenance, and exact destination/effect. Keep agent explanations and page instructions separate from those facts. Serialize records unambiguously; retain authorization outside lossy conversation compaction. Ambiguous decisions return `ask`, rather than allowing the main agent to persuade the reviewer through repeated retries. **(inference)** [Transcript-formatting and compaction findings](https://arxiv.org/html/2609.19587v2)

For model selection:

- **Cloud research baseline:** Sonnet 5 is a defensible starting comparator because current Claude Code uses it for this task. Do not silently enable it for local-only users. **(inference)** [Current classifier model](https://code.claude.com/docs/en/permission-modes)
- **Local prototype:** evaluate `gpt-oss-safeguard-20b` with Jezo’s authorization policy against a capable general local model. It is designed for custom-policy classification, but its suitability here remains unproven. **(inference)** [Model purpose](https://openai.com/index/introducing-gpt-oss-safeguard/)
- **Small-machine default:** use deterministic grants and meaningful confirmations until a local reviewer passes the actual workload. Prompt Guard can add warnings, but should not decide whether to send someone’s calendar or email. **(inference)** [Detector scope](https://huggingface.co/meta-llama/Llama-Prompt-Guard-2-86M)

Avoid building full CaMeL immediately. Its strongest guarantees come from controlling program/data flow through a custom execution architecture, which is a substantial change to pi’s open-ended tool loop. Start with conservative provenance, task grants, broker coverage, and optional clean research branches; preserve the possibility of stronger information-flow enforcement later. **(inference)** [CaMeL architecture and costs](https://arxiv.org/html/2503.18813v2)

Concrete first steps, all proposed rather than implemented:

1. **Create the broker and action log.** Connect pi `tool_call` checks to it, but enforce again inside the service performing the network/browser operation.
2. **Ship search and unauthenticated fetch first.** Brave is a reasonable general-search default candidate; offer Tavily/Exa and a SearXNG endpoint. Display provider and fallback choices explicitly. **(inference)**
3. **Prototype a visible Electron browser.** Separate public and signed-in sessions; verify authentication compatibility on the actual sites Jezo needs before choosing it over dedicated Chrome.
4. **Implement scoped account tasks.** For example, “Read my utility bill” grants different authority from “Change my utility plan.”
5. **Run reviewers in shadow mode.** Measure missed attacks, unnecessary blocks, abstentions, median/p95 latency, and token cost before permitting automatic external effects.
6. **Build medium-to-hard E2E attacks.** A malicious calendar invite inducing a private search query; an email inducing a collector URL; a signed-in page changing the recipient; an autosaving form; redirect/WebSocket leaks; and a saved-memory injection resumed after compaction. End each run with network/action logs, browser state, and repeatable artifacts.

These steps follow the repository’s testing requirement and address the coverage failures identified in current research. **(inference)** [Jezo testing instructions](/Users/tim/LocalData/coding/2026/Projects/12_jezo/Jezo/AGENTS.md), [Monitor coverage failures](https://arxiv.org/html/2609.19587v2)

The maintainer decisions that research cannot settle are:

- Must the default work without a search-service account or key, even at the cost of scraping failures and bundled maintenance?
- Which first three signed-in workflows must work reliably?
- Should Jezo connect only separately signed-in accounts, or also offer the everyday Chrome profile?
- Which external actions may standing authorization cover—for example, routine messages or appointment bookings?
- What local-model memory and latency budget is acceptable for an independent reviewer?
- Where should persistent browser session material live under the workspace/keychain principles, and what export/delete behavior must the GUI provide?

No files were changed.
