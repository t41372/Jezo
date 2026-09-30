## Findings that change the comparison

- **Pi now ships MCP support.** Version 0.99.0, released **September 29, 2026**, added stdio and Streamable HTTP MCP, OAuth, deferred tool discovery, and code execution over tools. The latest npm release checked was 0.99.1. The brief’s “deliberately no native MCP” premise describes an earlier pi. [Release changelog](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/CHANGELOG.md), [npm release metadata](https://registry.npmjs.org/@earendil-works/pi-coding-agent/latest).
- **Google now has official remote Workspace MCP servers**, including Calendar and Gmail, but they are **developer preview**. Google still requires a Cloud project, enabled services, and OAuth configuration; its documented client examples use registered web clients, rather than registration-free public desktop clients. [Google setup guide](https://developers.google.com/workspace/guides/configure-mcp-servers).
- **“Google Calendar API is free” now needs qualification.** Google’s September 11, 2026 documentation lists a daily billing threshold and announces future charges above it. Rates and activation details are not yet published there. [Calendar quotas and billing](https://developers.google.com/workspace/calendar/api/guides/quota).

The comparisons below distinguish verified implementation facts from judgments marked **“(inference)”**. Prices are USD unless stated otherwise.

## A. Jezo-owned OAuth clients and direct provider APIs

### Privacy and authentication

Google explicitly supports installed desktop applications using the system browser, PKCE, and a loopback redirect. It assumes installed applications cannot keep application secrets confidential. A published client ID identifies Jezo; it is not a user’s access credential. [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

For the proposed implementation, the flow would be:

```text
Browser ↔ provider authorization service
                  ↓ loopback callback
Jezo main process ↔ provider token/API endpoints
        ↓
OS keychain: access/refresh credentials
Workspace: imported records and provenance
```

**(inference)** This adds no connector company between Jezo and Google. The maintainer does not receive users’ tokens or calendar contents merely because everyone uses the maintainer’s OAuth client. Google still receives authenticated API requests, and retains the data already held in Google Calendar. This follows the documented installed-app flow. [Google native-app OAuth](https://developers.google.com/identity/protocols/oauth2/native-app).

**(inference)** Connector locality and model locality are separate. Once an email or event enters a cloud model’s prompt, that content goes to the selected model provider—even if OAuth and synchronization are entirely local. Google separately requires disclosure and consent for permitted transfers of Workspace data. [Google API User Data Policy](https://developers.google.com/terms/api-services-user-data-policy).

### The same OAuth recipe does not apply identically to every provider

| Provider | Verified desktop-relevant facts |
|---|---|
| **Google** | Desktop clients support PKCE and loopback redirects. Calendar event reading is an example of sensitive-scope access requiring verification for public distribution. [Native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [sensitive scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification). |
| **Microsoft** | Desktop apps are public clients; system-browser authentication supports a localhost redirect. Microsoft documents Electron/MSAL Node and support for organizational and personal Microsoft accounts. [Desktop registration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration). |
| **GitHub** | Its current documentation supports authorization code plus PKCE for public clients, but still requires the client secret for that exchange. GitHub explicitly acknowledges that a distributed public client cannot keep it confidential. Device flow is another option. [OAuth best practices](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/best-practices-for-creating-an-oauth-app). |
| **Notion REST API** | The documented public connection flow exchanges and refreshes tokens using `CLIENT_ID:CLIENT_SECRET` HTTP Basic authentication. I did **not** verify a documented equivalent of Google’s public native PKCE flow. Internal connection tokens and user-created PATs are available. [Notion authorization](https://developers.notion.com/guides/get-started/authorization). |
| **Todoist** | Current API documentation supports public clients with `token_endpoint_auth_method: none` and PKCE, plus dynamic registration and client ID metadata documents. Its registration documentation describes localhost redirects as allowed for testing; that should not be silently interpreted as a production desktop guarantee. [Todoist OAuth documentation](https://developer.todoist.com/api/v1/). |

**(inference)** A is a viable general direction, but “one universal PKCE-loopback implementation per provider” would hide real differences. Notion is a particularly useful case for comparing direct REST against first-party MCP.

### Costs, onboarding, and maintenance

For **new Google Calendar projects**, the current documented limits are:

- **10,000 requests/minute/project**.
- **600 requests/minute/user/project**.
- **1,000,000 requests/day/project** as the daily billing threshold.
- Standard use currently has no additional charge; above-threshold charging is planned, with at least 90 days’ notice. Some projects used between November 2025 and April 2026 retain previous quotas. [Calendar quotas](https://developers.google.com/workspace/calendar/api/guides/quota).

Google’s testing mode allows up to 100 listed test users, and Calendar authorizations—including refresh tokens—expire after **seven days**. Production publication is distinct from verification; unverified sensitive/restricted access also has a 100-new-user cap. [Audience and expiration rules](https://support.google.com/cloud/answer/15549945), [unverified-app limits](https://support.google.com/googleapi/answer/7454865).

**(inference)** Normal users can get a familiar “Connect Google Calendar” browser flow with no configuration work. BYO-client fallback can also remain GUI-only, but creating a Cloud project, enabling APIs, and configuring consent is substantial cognitive work. It is a recovery path, not equivalent onboarding.

**(inference)** For one Calendar connector, A has relatively little operational machinery: no hosted token database, integration subscription, or service availability to operate. As connectors grow, the maintainer acquires separate responsibilities for scopes, refresh behavior, pagination, synchronization, provider review, and API changes.

Google provides incremental synchronization, including deleted records and invalidated-token recovery. Its push notifications require an HTTPS webhook receiver. [Incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync), [push notifications](https://developers.google.com/workspace/calendar/api/guides/push).

**(inference)** Without a deployed receiver, Calendar synchronization must pull updates while Jezo runs or resumes. That is compatible with a desktop app, but it does not provide an always-online notification service.

### Agent use, injection, and failure

**(inference)** Direct APIs do not require direct model tools. The same implementation can expose a local CLI, write imported records into the workspace, or register selected tools. Files plus a CLI fit Jezo’s stated agent workflow.

**(inference)** External event descriptions and email bodies remain injection-bearing content. A makes the mutation boundary comparatively easy to identify, provided external operations pass through Jezo’s execution path.

**(inference)** If a provider changes terms or disables Jezo’s OAuth project, existing local records remain usable. BYO clients can recover from a Jezo-specific credential/quota problem, but cannot overcome a provider-wide prohibition or an organization’s access policy.

## B. Hosted or self-hosted connector aggregators

### What they actually replace

Composio, Nango, Pipedream Connect, and Arcade offer combinations of hosted authorization, credential storage/refresh, API proxying, and tool execution. They therefore replace operational work as well as library code. Composio and Pipedream explicitly document server-side credential custody and execution. [Composio custody](https://docs.composio.dev/docs/security/token-custody), [Pipedream Connect](https://pipedream.com/connect).

**(inference)** Their strongest fit is an application willing to place a managed integration service between users and providers. Their SDK being open source does not make that service local.

### Privacy, current pricing, and licensing

| Product | Data and token boundary | Verified price and license facts |
|---|---|---|
| **Composio Cloud** | **Composio** stores provider credentials, refreshes them, executes provider requests, and returns results. Supplying Jezo’s own OAuth application does not change custody. Tool arguments/results are retained in execution logs by default. ZDR prevents covered payload retention, not processing. [Custody and retention](https://docs.composio.dev/docs/security/token-custody). | Free: **100,000 tool calls/month**, **50,000 triggers/month**. Pro: **$29/month**, including $29 usage credit; base overage **$0.0003/tool call**. Managed OAuth apps include 20,000 calls before an additional **$0.0002/call**; managed-app connections have separate limits/charges. ZDR is a paid add-on. The public SDK repository is **MIT**; self-hosted platform availability is a separate enterprise arrangement. [Pricing](https://composio.dev/pricing), [license](https://github.com/ComposioHQ/composio/blob/next/LICENSE), [deployment options](https://docs.composio.dev/docs/security/token-custody). |
| **Nango Cloud** | **Nango** manages credentials and refresh. Auth-only use and hosted proxy/sync execution are different modes: content need not all pass through Nango if the application retrieves credentials and calls providers directly, but credential custody remains hosted. [Auth product](https://nango.dev/platform/auth), [architecture](https://nango.dev/docs/guides/platform/self-hosting/self-hosting). | Free: **10 connections**, **10 compute hours/month**, **10 GB/month**. Paid: **$50/month** with $50 credit; **$0.29/connection**, **$0.72/compute hour**, **$0.50/GB**. Repository license is **Elastic License 2.0**, not MIT. [Pricing](https://nango.dev/pricing), [license](https://github.com/NangoHQ/nango/blob/master/LICENSE). |
| **Pipedream Connect** | **Pipedream** stores and refreshes credentials; proxy requests and actions execute in its managed runtime. A locally run MCP bridge still uses Connect for these functions. [Connect](https://pipedream.com/connect), [developer MCP](https://mcp.pipedream.com/developers). | Current docs confirm free **development** use and paid **production** use, billed by external users plus execution credits. Official **July 8, 2025** discussion—**older than 2026**—quotes **$99/month**, 100 external users, then **$2/additional user**. I could not verify that base price on the live rendered pricing page, so it is not a confirmed September 2026 quote. The integration registry uses the **Pipedream Source Available License**; SDK licenses are separate. [Current billing mechanics](https://pipedream.com/docs/pricing), [dated price](https://pipedream.com/community/t/how-to-understand-pricing-for-pd-connect-integration/13036), [registry license](https://github.com/PipedreamHQ/pipedream/blob/master/LICENSE). |
| **Arcade Cloud** | **Arcade** operates the Engine/token vault: it stores encrypted provider tokens, refreshes them, supplies credentials to tools, routes executions, and records execution history. Hosting a tool elsewhere does not by itself remove that vault/routing boundary. [Platform architecture](https://docs.arcade.dev/en/operate/deploy/architecture). | Free: **2,000 auth events** and **2,000 tool calls/month**. Team: **$25/month**, plus **$0.10/auth event** and **$0.01/tool call**. Enterprise: custom. Its MCP development framework is **MIT**; that is not a license grant for the complete managed platform. [Pricing](https://www.arcade.dev/pricing/), [framework license](https://github.com/ArcadeAI/arcade-mcp/blob/main/LICENSE). |

**Constraint conflict:** these hosted paths add **Composio, Nango, Pipedream, or Arcade** as a recipient/custodian of credentials and, depending on execution mode, content. Encryption at rest and non-retention do not make the processing local.

### Does self-hosting rescue the fit?

| Product | Documented self-hosting |
|---|---|
| **Composio** | Enterprise self-hosting, with Helm deployment support; custom arrangements also exist for customer-managed keys. [Deployment documentation](https://docs.composio.dev/docs/security/token-custody). |
| **Nango** | Enterprise self-managed deployment uses Helm and multiple services/data stores. A limited free Auth/Proxy edition exists, but the documented installation uses Docker Compose; it lacks the managed tools/syncs/MCP feature set. [Self-hosting](https://nango.dev/docs/guides/platform/self-hosting/self-hosting). |
| **Pipedream** | Current Conduit marketing advertises a self-hosted **Docker image**. This is distinct from treating Connect’s public components as a complete locally runnable service. [Conduit](https://pipedream.com/conduit). |
| **Arcade** | Full platform deployment requires Kubernetes, Helm, PostgreSQL, Redis, an identity provider, ingress/TLS, and a hostname. [Helm deployment](https://docs.arcade.dev/en/operate/deploy/helm). |

**(inference)** None of these documented platform deployments is a straightforward bundled Node/Python desktop sidecar. The published paths conflict with Jezo’s no-Docker/no-separately-deployed-services constraint, or add paid enterprise infrastructure and maintenance.

### Fit across the requested dimensions

- **Setup:** hosted managed OAuth can give users a short browser flow. **(inference)** Requiring each Jezo user to create their own aggregator account/API key transfers cost and administration to the user, while retaining the privacy change.
- **Project versus user cost:** the table’s limits apply to aggregator accounts/projects. **(inference)** A maintainer-funded shared project pools usage and costs; per-user accounts make users responsible for limits and upgrades.
- **Desktop credentials:** Composio’s ordinary project key has full project access. **(inference)** Shipping one such secret to every installation would expose that shared authority; a desktop distribution needs individual credentials or another authorization arrangement. [Composio API-key scopes](https://docs.composio.dev/reference/authenticating-to-composio).
- **Maintenance:** **(inference)** provider OAuth quirks and tool definitions become the vendor’s work, while account management, outages, billing, SDK migrations, and migration away become Jezo’s work.
- **Agent interface:** Composio offers SDK tools and hosted MCP, and lists an **experimental Pi provider**. **(inference)** Results could still be written to workspace files; hosted custody is independent of tool presentation. [Composio repository and providers](https://github.com/ComposioHQ/composio).
- **Injection:** **(inference)** aggregators do not remove malicious text from emails or pages, and successful authentication does not establish that an outgoing action matches the owner’s intent.
- **Shutdown/terms changes:** **(inference)** an aggregator failure adds a failure mode beyond the original provider. Local snapshots survive; reconnecting directly may require fresh authorization and connector work.

## C. Local and remote MCP servers

### What current MCP authorization does—and does not—solve

The current specification is **2026-07-28**. Its HTTP authorization uses OAuth discovery, resource-bound tokens, and public/confidential-client security requirements. Stdio servers instead obtain credentials locally; they do not use this HTTP authorization flow. [Current authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization).

Client registration has three paths:

1. Pre-registered client information.
2. **Client ID metadata documents**, when advertised.
3. **Dynamic client registration**, when supported.

The 2026 specification deprecates DCR while retaining it for compatibility. A metadata document uses a public HTTPS URL as the client ID and publishes client metadata and redirect URIs. [Registration specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/client-registration).

**(inference)** A metadata document can be a static public file; it does not require a Jezo token-processing backend. Its host receives requests for public application metadata, not the OAuth callback or user tokens.

**(inference)** MCP authorization does not automatically authorize an upstream Google account. A community MCP server that proxies Google still needs some Google OAuth arrangement. “Supports OAuth MCP” and “has a verified Google application” are different capabilities.

### Official remote servers verified

| Provider | Official endpoint/status | Authentication for a third-party local client |
|---|---|---|
| **Google Workspace** | Calendar: `https://calendarmcp.googleapis.com/mcp/v1`; Gmail: `https://gmailmcp.googleapis.com/mcp/v1`. **Developer preview**. [Setup](https://developers.google.com/workspace/guides/configure-mcp-servers). | Requires preview membership, a Cloud project, enabled APIs/MCP services, and OAuth setup. Published examples use web-client IDs/secrets and client-specific callbacks. I did **not** verify a registration-free public desktop flow for these endpoints. The Claude example uses an **Anthropic-hosted callback**, which should not be copied into a local Jezo design. |
| **Microsoft** | Official **Work IQ Calendar and Mail MCP** exist in preview. Separately, the **Microsoft MCP Server for Enterprise** exposes tenant-management capabilities. [Work IQ](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview), [Enterprise server](https://learn.microsoft.com/en-us/graph/mcp-server/get-started). | Work IQ supports coding clients through enterprise application registration and permissions, and requires a **Microsoft 365 Copilot license**. Enterprise MCP requires tenant provisioning/admin consent; its documented scopes are directory/admin scopes, not a generic Outlook connector. **(inference)** Neither is a universal consumer Outlook.com solution. |
| **Notion** | `https://mcp.notion.com/mcp`, first-party hosted MCP. [Client guide](https://developers.notion.com/guides/mcp/build-mcp-client). | Documents authorization code plus PKCE, DCR, and refresh. Its live authorization metadata advertises **DCR, CIMD, and public-client `none` authentication**. This is a documented path for a custom local client without shipping Notion’s REST public-connection secret. [Live metadata](https://mcp.notion.com/.well-known/oauth-authorization-server). |
| **GitHub** | `https://api.githubcopilot.com/mcp/`, first-party remote server; an official local server also exists. [Repository](https://github.com/github/github-mcp-server). | Remote OAuth hosts must configure a **GitHub App or OAuth App**; PAT authentication also works. Do not assume adding its URL gives generic DCR onboarding. |
| **Atlassian** | Current guide uses `https://mcp.atlassian.com/v2/mcp`. [September 2026 setup guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/getting-started/). | OAuth 2.1, user/site permissions, and possible redirect/domain restrictions. Atlassian’s May 2026 migration notice documents changes to its DCR authorization server. I did not verify CIMD for the current v2 endpoint. Some search tools consume **up to 10 Rovo credits/call**. [OAuth guide](https://developer.atlassian.com/cloud/rovo-mcp/guides/configuring-oauth-2-1/), [DCR migration](https://community.atlassian.com/forums/discussion/3227514/atlassian-rovo-mcp-oauth-updates). |
| **Linear** | `https://mcp.linear.app/mcp`, first-party hosted server. A `/mcp/readonly` endpoint also exists. [Documentation](https://linear.app/docs/mcp). | Documents OAuth/DCR and direct bearer/API-key access. Live metadata advertises **DCR, CIMD, public-client authentication, and S256 PKCE**. [Live metadata](https://mcp.linear.app/.well-known/oauth-authorization-server). |
| **Todoist** | Official remote server at `https://ai.todoist.net/mcp`, plus a local npm server. The implementation is **MIT**. [Repository](https://github.com/Doist/todoist-mcp), [license](https://github.com/Doist/todoist-mcp/blob/main/LICENSE). | Official setup uses browser OAuth. Todoist’s underlying OAuth documentation additionally supports DCR/CIMD. I did not verify the remote server’s live discovery document. [API authorization](https://developer.todoist.com/api/v1/). |

**Privacy distinction:** these first-party endpoints process requests at **Google, Microsoft, Notion, GitHub, Atlassian, Linear, or Doist**, respectively. They do not inherently introduce an independent connector aggregator. Connected AI clients can still send returned content elsewhere; Notion explicitly documents that possibility and prompt-injection exposure. [Notion security guidance](https://developers.notion.com/guides/mcp/mcp-security-best-practices).

### Community local MCP

`taylorwilsdon/google_workspace_mcp` is an **MIT**, Python-based Workspace connector supporting local stdio and remote HTTP. Its documentation says the default local deployment contacts Google APIs using your OAuth client, with no analytics/SaaS dependency; optional tracing changes that boundary. It includes Calendar and Gmail tools. [Project documentation](https://github.com/taylorwilsdon/google_workspace_mcp).

GitHub’s official local MCP server is **MIT** and runs as a native binary without Docker. Official released binaries now include a registered OAuth application; local login uses PKCE/loopback, with device-flow fallback. Its documented built-in login keeps the resulting token **in memory**, rather than providing persistent keychain storage. [License](https://github.com/github/github-mcp-server/blob/main/LICENSE), [local OAuth](https://github.com/github/github-mcp-server/blob/main/docs/oauth-login.md).

**(inference)** Local MCP can satisfy Jezo’s deployment and privacy constraints when Jezo bundles and supervises the process. It does not automatically satisfy persistent login, GUI onboarding, synchronization, or workspace-record requirements.

### Pi integration and adapter status

- **Built-in pi, released September 2026:** supports stdio/Streamable HTTP, OAuth with DCR or pre-registration, tool exposure modes, and permission hooks. Its default OAuth store is **`mcp-auth.json`**, not the OS keychain. SDK sessions **do not automatically load built-in extensions**; Jezo must explicitly load the relevant MCP/code-discovery extensions. [Released MCP documentation](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/docs/mcp.md).
- **`nicobailon/pi-mcp-adapter`:** maintained community adapter, **MIT**. It offers lazy discovery through a proxy tool, programmatic SDK integration, OS credential-store persistence, OAuth/PKCE, DCR, and opt-in operator-hosted CIMD. Its current README distinguishes adapter configuration from pi’s new built-in MCP configuration. [README](https://github.com/nicobailon/pi-mcp-adapter), [OAuth implementation](https://github.com/nicobailon/pi-mcp-adapter/blob/main/OAUTH.md), [license](https://github.com/nicobailon/pi-mcp-adapter/blob/main/LICENSE).
- **`mcporter`:** **MIT** TypeScript runtime/CLI for MCP discovery, calls, OAuth, and generating focused CLIs. It can expose MCP functionality through bash rather than model-declared tools. [Repository](https://github.com/openclaw/mcporter), [license](https://github.com/openclaw/mcporter/blob/main/LICENSE).

**(inference)** Pi interoperability is no longer a reason by itself to reject MCP. Its native implementation is only one day old at the research date, however; documented availability is not evidence of mature provider compatibility.

### Operational trade-offs

**(inference)** Local MCP adds sidecar packaging and lifecycle work; first-party remote MCP shifts API/tool maintenance to the provider. Both still need a Jezo GUI for connecting, reconnecting, errors, permissions, and account selection.

**(inference)** MCP tools can be used on demand and their results persisted to disk. Current pi and `mcporter` weaken the old claim that MCP necessarily means injecting every tool definition and every intermediate result into model context.

**(inference)** Remote MCP adds a provider endpoint that may change independently of its REST API. Local open-source servers can be pinned or forked, but neither option defeats upstream API or OAuth policy changes. Workspace snapshots preserve offline usefulness in both cases.

## D. CLI tools plus skills

### Concrete tools

| Tool | License, authentication, and current limitations |
|---|---|
| **`gcalcli`** | **MIT**, Python, Calendar API client. Currently requires users’ own Google client credentials because its shared client remains restricted pending approval. Tokens are stored in a local OAuth file. [Repository and auth behavior](https://github.com/insanum/gcalcli). |
| **`gog` / `openclaw/gogcli`** | **MIT**, Go, Google Workspace CLI. Supports explicit account routing and machine-readable output; normally requires a Desktop OAuth client from a Google Cloud project. Tokens use the platform keyring by default. Current versions also generate agent skills and expose stdio MCP. [README](https://github.com/openclaw/gogcli). |
| **`gws` / `googleworkspace/cli`** | **Apache-2.0**, Rust, structured JSON and bundled skills. Builds commands from Google Discovery documents. Supports its own desktop OAuth setup or supplied tokens; credentials are encrypted using an OS-keyring-held key. Its README says **not an officially supported Google product** and warns of breaking changes before v1.0. [README](https://github.com/googleworkspace/cli). |
| **Himalaya** | **MIT or Apache-2.0**, Rust, JSON output and mail backends including IMAP/SMTP, Gmail REST, and Microsoft Graph. Current v2 documentation says it ships **no OAuth flow and no native keyring support**: an external helper supplies tokens. [README](https://github.com/pimalaya/himalaya). |
| **`gh`** | Official GitHub CLI, **MIT**. Browser authentication uses its supplied application and stores credentials in the system credential store, with a plaintext-file fallback if secure storage fails. [Authentication](https://cli.github.com/manual/gh_auth_login), [license](https://github.com/cli/cli/blob/trunk/LICENSE). |
| **PnP CLI for Microsoft 365, `m365`** | **MIT**, Node-based community CLI. Uses an Entra application registration; device-code login is the default, with browser authentication also available. Its own-identity setup still involves application permissions and tenant consent. [Login](https://pnp.github.io/cli-microsoft365/cmd/login/), [application setup](https://pnp.github.io/cli-microsoft365/user-guide/using-own-identity/), [license](https://github.com/pnp/cli-microsoft365/blob/main/LICENSE). |
| **Microsoft Graph CLI, `mgc`** | Historical official CLI with device-code/browser login and custom client IDs. **Archived August 29, 2025—older than 2026.** It is an existing option, not evidence of current maintenance. [Repository and archived status](https://github.com/microsoftgraph/msgraph-cli). |
| **Doist’s `td`** | Official Todoist CLI, **MIT**. Browser OAuth, read-only authorization, and OS credential-manager storage; secure-storage failure does not silently write plaintext unless explicitly requested. [README](https://github.com/Doist/todoist-cli), [license](https://github.com/Doist/todoist-cli/blob/main/LICENSE). |

These are locally running tools, not mandatory hosted integration subscriptions. **(inference)** Their incremental connector-service cost can be zero, while provider accounts, API limits, model costs, and Jezo’s packaging/support remain separate.

### How the community packages them for agents

Anthropic introduced Agent Skills as directories of instructions, scripts, and resources with progressive disclosure. The introductory article is **October 16, 2025**, with a December 2025 open-standard update—**older than 2026**. The live specification defines `SKILL.md` metadata and optional supporting files. [Original article](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills), [current specification](https://agentskills.io/specification).

OpenClaw distributes concrete `gog` and Himalaya skills that describe executable dependencies, installation, authentication, and command usage. Those skills still expect an installed/configured CLI; the skill itself does not turn setup into a non-technical GUI flow. [Gog skill](https://github.com/openclaw/openclaw/blob/main/skills/gog/SKILL.md), [Himalaya skill](https://github.com/openclaw/openclaw/blob/main/skills/himalaya/SKILL.md).

Pi’s author argued for small CLIs and filesystem composition in **November 2025—older than 2026**. That is evidence of the ecosystem’s design discussion, not proof that CLI is always superior; current pi subsequently added MCP and code composition. [Author’s argument](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/), [September 2026 changes](https://github.com/earendil-works/pi/blob/v0.99.1/packages/coding-agent/CHANGELOG.md).

### Fit for Jezo

**(inference)** CLI plus skills fits Jezo’s agent workflow particularly well: commands can search, filter, paginate, and save records before returning a small result to the model. Jezo can bundle the executable and generate its configuration through the GUI; the user need not see a terminal.

**(inference)** The main trade-off is adopting another product’s command/authentication contract. GUI-wrapping `gcalcli` does not remove Google application verification. Wrapping Himalaya v2 means supplying an OAuth/token helper. Wrapping `gh` requires handling its secure-storage fallback deliberately.

The `gws` README also offers optional **Google Cloud Model Armor** response scanning. Enabling that is a separate Google Cloud processing path, rather than purely local CLI behavior. [Gws documentation](https://github.com/googleworkspace/cli).

**(inference)** CLI execution has a wider action surface than a small typed connector: shell commands, arbitrary URLs, and other installed tools may provide additional exits. A skill’s written instruction to seek approval is not an enforced execution check.

**(inference)** If a CLI maintainer disappears, Jezo can retain a pinned binary or fork permissively licensed code. Provider changes still require fixes. A locally owned file format preserves imported data even if the CLI stops functioning.

## E. Protocol-level connectors

| Approach | Privacy, scope, and provider constraints |
|---|---|
| **ICS subscriptions/imports** | Direct retrieval from the publisher; no aggregator required. Google’s secret iCal address grants viewing access and must be kept private; it can be reset. This is a viewing/subscription path, not equivalent to authenticated event editing. [Google calendar addresses](https://support.google.com/calendar/answer/37648). |
| **CalDAV** | Standard calendar access and management. Google’s CalDAV service requires HTTPS and Google OAuth; it does not remove OAuth-client work. **RFC 4791 dates to 2007—older than 2026.** [Standard](https://datatracker.ietf.org/doc/html/rfc4791), [Google implementation](https://developers.google.com/workspace/calendar/caldav/v2/guide). |
| **CardDAV** | Standard contact/address-book access, not calendar or email access. **RFC 6352 dates to 2011—older than 2026.** [Standard](https://datatracker.ietf.org/doc/html/rfc6352). |
| **IMAP/SMTP** | Direct mailbox-server access. Microsoft supports OAuth for both Microsoft 365 and Outlook.com. Gmail OAuth IMAP/SMTP uses the broad restricted `https://mail.google.com/` scope. Google’s FAQ says narrowly scoped applications may need to migrate to Gmail REST to satisfy minimum-scope requirements. [Microsoft OAuth](https://learn.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth), [Gmail scopes](https://support.google.com/cloud/answer/13464325), [Google IMAP/SMTP verification guidance](https://support.google.com/cloud/answer/13463817). |
| **EventKit** | Accesses the operating system’s event store after user permission. Apple documents that reading events requires full access; there is no read-only EventKit permission. Jezo can implement read-only behavior despite the broader OS grant. [Apple event-store documentation](https://developer.apple.com/documentation/eventkit/accessing-the-event-store). |

**(inference)** Protocol clients can run entirely within Jezo or bundled sidecars. They add no connector-service fee, although the mailbox/calendar provider may charge for the underlying account.

**(inference)** Setup ranges from one pasted ICS URL or an OS permission dialog to server discovery, app passwords, and provider OAuth. Jezo must own those GUI flows; “standard protocol” does not imply easy account setup.

**(inference)** Standards reduce dependence on one API wrapper and can cover multiple providers, but introduce protocol semantics and interoperability work. They cannot connect Notion or GitHub, and they do not bypass Google/Microsoft authorization policy.

**(inference)** Event descriptions, contacts, and mail remain external content. SMTP sends and calendar scheduling changes are exits. If a provider removes a protocol, imported files survive, while live access needs another connector.

## Prompt-injection implications across all five approaches

Notion’s own MCP guidance warns that malicious instructions in returned content can cause disclosure or unintended changes. Pi documents execution hooks for MCP calls, but also says tool annotations are unverified hints. [Notion guidance](https://developers.notion.com/guides/mcp/mcp-security-best-practices), [pi tool annotations](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md).

The following are **(inference)** from Jezo’s trust model and those execution boundaries:

| Approach | Where exit checks can be applied | Important limit |
|---|---|---|
| **A: direct APIs** | Before Jezo executes a structured provider operation. | Other raw network paths can bypass that boundary. |
| **B: aggregator** | Before submitting the aggregator action; possibly also in vendor hooks. | Vendor authorization and scopes do not prove owner intent. |
| **C: MCP** | In the MCP tool-call pipeline, using actual operation arguments. | Server descriptions and `readOnlyHint` are not trustworthy enforcement. |
| **D: CLI/skills** | In Jezo’s execution of managed connector commands. | Unrestricted shell/network commands remain additional exits. |
| **E: protocols** | Before sending mail, changing sharing, scheduling, or destructive protocol operations. | Broad protocol credentials can permit more than the current feature needs. |

**(inference)** Saving an imported email to a file changes its presentation, not its trust. Preserve provenance so quoted outside text does not later become an owner instruction or trusted skill.

**(inference)** Exit checks should inspect the destination account, recipients, attachments, shared content, and irreversibility. Creating an event with an attendee can disclose information through invitations; deleting a remote object is not undone merely by restoring a workspace file.

## Recommendation for Jezo

**(inference)** Keep **A for Google Calendar now**, expose it through **workspace files and a small local CLI/skill**, and retain the solved **ICS/EventKit** paths. Add MCP as another plugin transport when a particular provider offers a useful first-party endpoint or reusable local implementation.

**(inference)** Do not make a hosted aggregator the default connector foundation. Its reduction in OAuth/API maintenance comes with hosted credential custody, another content-processing boundary, shared-service credentials, usage billing, and another vendor dependency. Those are central conflicts with Jezo’s brief, not peripheral disadvantages.

**(inference)** Do not standardize on one transport for every later connector. Notion’s first-party MCP has a materially better documented public-client authentication path than its REST public-connection flow; Google Calendar’s stable native API path currently has a more established desktop fit than its MCP preview.

### What the maintainer needs to do for Google Calendar now

1. **Create the Google application.** Use a maintainer Google account to create separate production/testing Cloud projects, enable Calendar API, configure external consent, and create the production **Desktop app** client. Google documents these prerequisites and client types. [Native-app setup](https://developers.google.com/identity/protocols/oauth2/native-app).

2. **Implement only the scopes used by shipped features.** For calendar selection and event reading, investigate `calendar.calendarlist.readonly` and `calendar.events.readonly`; add event-write access when editing/scheduling ships. Avoid requesting full calendar administration merely for future possibilities. [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

3. **Pass public-app verification.** Prepare branding, support contact, a homepage/privacy policy on a domain whose ownership can be verified, scope justification, and a video showing the actual consent and feature flow. Calendar event-reading access is sensitive; do not use testing mode as the production solution. [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [testing limitations](https://support.google.com/cloud/answer/15549945).

4. **Build GUI connection and recovery.** **(inference)** Jezo should handle browser launch, callback, keychain storage, calendar selection, revoked authorization, and reconnecting. A BYO-client wizard can offer browser instructions and pasted client values without requiring configuration-file editing.

5. **Build repeatable synchronization.** Use provider IDs, pagination, incremental sync, deletion handling, and expired-sync recovery. **(inference)** Pull on reconnect/resume and expose last successful synchronization in the GUI; a webhook would require infrastructure outside the current constraints. [Sync protocol](https://developers.google.com/workspace/calendar/api/guides/sync), [webhook requirement](https://developers.google.com/workspace/calendar/api/guides/push).

6. **Expose local records and checked operations.** **(inference)** Keep credentials out of workspace/model-visible output; store imported events with account/source identity, original time-zone information, and synchronization metadata. Local draft changes can use undo; outgoing provider operations need intent checks.

**Costs:** current standard Calendar usage has no additional API charge, subject to the published quotas and forthcoming billing change. No paid connector subscription or deployed backend is required by this design. The verification documentation does not list a sensitive-scope review fee. A new domain would add registrar-dependent ongoing cost if no suitable verifiable domain already exists. Public repositories can use GitHub Pages without a paid hosting plan, but Google’s domain/branding requirements still need to be satisfied. [Calendar cost policy](https://developers.google.com/workspace/calendar/api/guides/quota), [verification requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [GitHub Pages availability](https://docs.github.com/en/pages/getting-started-with-github-pages/about-github-pages).

### What changes for later connectors

| Connector | Accounts, verification, and cost/work implications |
|---|---|
| **Gmail** | Enable Gmail API and submit the implemented scopes/use case for review. `gmail.readonly` is restricted; `gmail.send` is sensitive. Google permits productivity uses including generative summaries, subject to its policies. [Scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [permitted uses](https://developers.google.com/workspace/workspace-api-user-data-developer-policy). |
| **Microsoft 365/Outlook** | Create an Entra public-client application with appropriate account types and delegated permissions. For broad organizational adoption, pursue publisher verification: verified Partner Program identity, associated tenant, publisher domain, and required administrative roles. Microsoft states no charges for publisher-verification prerequisites; tenant administrators can still restrict consent. Standard Graph APIs are included within applicable user-license access rather than separately metered connector subscriptions. [Desktop registration](https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-registration), [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), [Graph billing categories](https://learn.microsoft.com/en-us/graph/metered-api-overview). |
| **Notion** | **(inference)** First-party MCP is the most promising browser-connect path under the no-backend constraint. A pasted PAT/internal connection token is another direct option, with different permission semantics. Do not assume its MCP token is also a REST API credential. REST rate budgets are currently **180 requests/minute** on other plans and **600/minute** on Business/Enterprise. [MCP client setup](https://developers.notion.com/guides/mcp/build-mcp-client), [token options](https://developers.notion.com/guides/get-started/authorization), [rate limits](https://developers.notion.com/reference/request-limits). |
| **GitHub** | Register Jezo’s own OAuth/GitHub App, or bundle `gh`/the official local MCP binary and its existing auth flow. **(inference)** A GitHub App is worth evaluating where per-repository permissions matter. Ordinary authenticated REST access generally has **5,000 requests/hour/user**, with endpoint-specific and secondary limits. [App authentication options](https://github.com/github/github-mcp-server/blob/main/docs/oauth-login.md), [REST limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api). |
| **Todoist import** | CSV project export is available on **Beginner, Pro, and Business**; its documented export limitations must be reflected in the import UI. **(inference)** A one-time GUI import can therefore avoid maintaining OAuth altogether. For live access, evaluate official `td`, local/remote MCP, or a Jezo OAuth client. [CSV export and limitations](https://www.todoist.com/help/account-and-billing/security/import-or-export-a-project-as-a-csv-file-in-todoist-YC8YvN), [official CLI](https://github.com/Doist/todoist-cli), [OAuth](https://developer.todoist.com/api/v1/). |

**Gmail is the unresolved cost gate.** Google’s developer guidance ties annual security assessments to restricted data accessed from or through third-party servers; its Help Center describes assessment requirements more broadly. It also documents a free Tier 2 assessment route for eligible applications, while assessor-assisted costs are negotiated rather than fixed by Google. Do not promise either “all desktop apps are exempt” or “every Gmail app needs an expensive audit.” [Restricted-scope review](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [assessment overview](https://support.google.com/cloud/answer/13465431), [assessment costs and tiers](https://support.google.com/cloud/answer/13463817).

**(inference)** Jezo should obtain Google’s determination for its exact Gmail data flow—including arbitrary user-selected cloud models—before committing to that connector’s distribution model. Keeping tokens local does not establish that restricted mail stays local. If that design requires a paid annual assessment, it conflicts with the stated zero-budget constraint; local processing, personal BYO clients, or file import are different fallback trade-offs, not automatic exemptions.
