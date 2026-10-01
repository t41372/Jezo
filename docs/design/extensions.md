# Installed resources

Status: decided on 2026-09-30. 更多 → 已安裝 has one 安裝 entry for methods, pi packages and MCP servers. All installed code belongs to the owner and has the same trust. Tim chose pi's own package manager and MCP support over a Jezo package format.

## One entry

Paste an address, command or JSON, choose a folder or archive, or write a method. Jezo inspects the source before installing. The preview lists what it found, where it came from and where it will go. Several methods or MCP servers have checkboxes. Existing names require an explicit replacement, as methods already did.

- GitHub repositories, tree and SKILL.md addresses, archive links, local folders and archives use the existing method installer. A repository's root `package.json` changes the discovery result to a pi package when it has a `pi` key or the `pi-package` keyword. An address pointing at a method still selects that method.
- `npm:name[@version]`, including scoped names, uses npm metadata for the preview and `DefaultPackageManager.installAndPersist()` for the installation.
- Other HTTP URLs become streamable HTTP MCP servers. A command becomes one executable and its arguments, with quotes and escapes preserved; it is not a shell script. JSON accepts Claude Desktop, Cursor and Claude Code's `mcpServers` object and VS Code's `servers` object. Each server keeps its pi-compatible fields. pi validates it before installation. Legacy SSE is unsupported.

「已安裝」 replaces the old 「它用的方法」 destination. One page is easier to find than separate pages for three formats of installed behavior. Methods keep their view, editable instructions, update and undo behavior. Packages list their extensions, skills, prompts and themes. Servers list connection state and tools, with login, reconnect, enable/disable and remove controls. Details fold away; no format gets a different trust warning.

Suggestions live in `src/shared/install-suggestions.ts`. The browser and workspace-file options were checked against npm on 2026-09-30. Each shows its config and an install button; 設定 copies it to the editable input when the user wants changes. Nothing is installed by default. These stdio servers use the bundled Node/npm launchers; browser binaries and server-specific setup still belong to the chosen server. A keyless, maintained search option has not been selected.

## pi owns the installation formats

`PI_CODING_AGENT_DIR` is `<app userData>/pi`, set before pi is imported. Jezo never loads the owner's `~/.pi`. Settings use `SettingsManager.create(workspace, agentDir, { projectTrusted: false })` and persist in that directory. Project `.pi`, context files, default skill directories and ambient extensions remain off.

`DefaultPackageManager` installs npm packages under `<agentDir>/npm/node_modules/`. Package declarations, filters and Jezo provenance are in `<agentDir>/settings.json`, in pi's `packages` list. The `jezo` field records original source, resolved GitHub ref, installation time and user/agent. Disabling a package sets all four pi resource filters to `[]`, with its previous filters in `jezoFilters`; enabling restores them. Removing calls pi's `removeAndPersist()`.

GitHub packages do not require git. Jezo downloads and checks a tarball using the method installer's existing archive reader, retains those bytes for confirmation, then unpacks it under `<agentDir>/git/github.com/<owner>/<repo>`. Dependencies install in a temporary directory before it replaces an older directory. pi's git source requires a real git checkout and runs git during installation and reconciliation. A tarball therefore cannot be registered as a git source: Jezo registers the resulting directory as a local-path package. Its original address and ref remain in `jezo`. Removing that managed local package also deletes its directory. Updating a GitHub package means installing its address again and agreeing to replace it; pi's git updater is not used.

The loader gets only enabled package resource paths resolved by pi, plus workspace method paths and Jezo's inline extensions. `DefaultResourceLoader` loads their extensions, skills and prompt templates. Themes are listed as resources; terminal themes do not change React. Jezo's initial tools use `defaultTools`, not the SDK's `tools` allowlist, which would hide package and MCP tools. pi's tool-search and codemode factories handle deferred/codemode exposure. Imported MCP servers default to `deferred`, which lets small models find tools without receiving every schema up front. An explicit exposure is retained.

Installation and enable/disable changes apply to the next conversation. Live sessions keep the resources they loaded. Reopening a saved conversation after an app restart reconstructs resources from the current settings, as pi does. Sessions initialize extensions even without a model, so an extension's setup question can still appear; a message without a model is saved and the user sees Jezo's existing model-selection message.

## npm in Electron

Jezo creates small `npm`, `npx` and `node` launchers in `<agentDir>/bin/` when it opens. The npm launcher is pi's persisted `npmCommand`. It invokes `node_modules/npm/bin/npm-cli.js` with `process.execPath`, setting `ELECTRON_RUN_AS_NODE=1` only in the child. The launcher's PATH includes its companion Node and npx launchers for npm lifecycle scripts. Jezo's own environment never enters Node mode.

`electron-builder.yml` unpacks npm, including its own dependencies, and enables the RunAsNode fuse. Launchers are regenerated so an app move or upgrade changes their paths. npm's cache lives in `<agentDir>/cache/npm`; installation failures retain the last 20,000 characters of npm output in `<agentDir>/npm-error.log`, since pi otherwise reports only an exit code. Native addons requiring a compiler are outside this feature; npm errors mentioning node-gyp or a compiler say that developer tools are needed. Prebuilt addon compatibility is the package author's responsibility.

## MCP and secrets

Configured servers live in `<agentDir>/mcp.json`, in pi's `mcpServers` object. Each entry's `jezo` field records source, time and user/agent. Jezo's management connections and pi's session extension both use pi's transports, client and OAuth implementation. The management page opens its own connections on first inspection; sessions have separate connections, including separate stdio processes. Their tool counts and failures can differ if a server depends on process-local state. The page does not reload a live session when a server is changed.

Literal values in pasted `env`, `headers` and `oauth.clientSecret` go into Jezo's existing OS-encrypted keychain store. Config files contain `${JEZO_MCP_<id>}` references. Existing `${NAME}`, `$NAME` and `!command` pi references are retained. The transport adapter resolves Jezo references only for that connection and escapes the resulting literals before pi evaluates configuration values; secrets never enter Jezo's global environment. Only selected servers' literals are stored. Removal removes their keychain entries. The secret-bearing pasted JSON is not provenance and never comes back in a preview.

`createMcpExtension({ credentials })` uses a `McpOAuthCredentialStore` backed by the same keychain store, with pi's refresh locks in the agent directory. OAuth state, registration details, tokens and PKCE verifiers are stored under `mcp:oauth`; no `mcp-auth.json` is written. Sign-in opens the browser with Electron's `shell.openExternal`. The GUI also accepts the final redirect URL and cancellation when the browser cannot reach the loopback callback. Sign-in reconnects the management connection; existing sessions use the shared credentials on subsequent authentication.

pi 1.0.0 does not publicly export the credential store, config operations, validator, theme object or connection manager. `src/main/install/pi-internals.ts` is the only internal-import boundary. The dependency is pinned to 1.0.0 and the adapter checks the installed version. Since 1.0.0 the credential store keeps sign-ins per server name and URL, so removing a server removes only its own. Review these contracts when upgrading; prefer public exports if pi adds them.

## Extension UI

Sessions bind with `mode: 'json'` and an `ExtensionUIContext` before `session_start`. confirm, select and input become conversation cards in the main and ⌥X windows, using the existing question buttons. Each request has a conversation ID and request ID. Only its matching answer resolves it, and select returns the original option string. Abort and extension-supplied timeouts dismiss pending questions; a timeout shows its remaining seconds. Questions and answers are custom session entries, so finished interactions survive reopening the conversation. notify reaches the renderer as a toast.

`custom()` cannot render terminal components. It resolves undefined and logs the request. Terminal status, widgets, editor factories, shortcuts, footers and themes are not translated to React. Extensions that rely on those need their own GUI integration. Text `editor()` uses the input card. Package tools and lifecycle handlers otherwise retain pi's capabilities and run as the owner's code. Quitting cancels pending cards, emits pi's `session_shutdown` and awaits connections closing before disposing sessions; `dispose()` alone does not emit that event.

## Agent installs, provenance and recovery

`install_from_address` takes any of the paste sources, including a local folder or archive path. It retains plain string and boolean parameters. Multiple methods return paths for a second call; MCP JSON installs the selected named server, or every server when no name is specified. The agent can also write a method with its existing file tools. Only runs the user started by talking to Jezo may install. Automations and note sorting remain refused by the existing rule in `tools.ts`. Agent provenance is `by: agent` in the same records as GUI installation.

The end-of-run check that sends back failed tool calls stays quiet when the run changed a file or did something outside the workspace: a successful package or MCP installation, or a successful outside tool not marked read-only. Tool search and codemode alone don't count; the calls made through them do. Otherwise a failed first try followed by a working installation would be sent back, and the agent would install again.

Workspace methods and `skills/installed.yaml` retain their existing text undo. Packages and MCP configs are outside workspace history; disable/remove and reinstall are their recovery controls. Removing a server also removes its credentials. There is no history-based restore of a removed OAuth grant or package dependency tree.

A workspace backup restores methods and conversations. It does **not** restore the pi directory, its installed packages, MCP configuration, or keychain values today. Moving these user-owned installation records into workspace backup/recovery remains open. The GUI makes their destinations visible; this feature does not solve that storage-policy gap.

## Rejected

- A Jezo package format and package manager: pi already defines resource manifests, dependency installation, filters and MCP.
- Ranking methods, packages and servers by trust or sandboxing one format: they are all code the owner chose to install, as Tim decided on 2026-09-30.
- Requiring git: it is absent on many users' machines; tarballs support GitHub sources without it.
- Exporting secrets into the main process's environment or saving OAuth in `mcp-auth.json`: connection-scoped resolution and the existing keychain store keep credentials out of ordinary files.
- Loading ambient pi resources to discover installed packages: explicit package paths preserve Jezo's current isolation.

## Verification and remaining work

Pure parsing tests start with numbered failure cases. `e2e/install.spec.ts` uses a hand-written stdio server, a streamable HTTP server, a GitHub-shaped archive service and a local npm registry. It checks selection, literal-secret storage, connected tools, real session tool lists, package resources, GUI confirm/select/input replies, disabling, removal and restart persistence. The optional local-model scenario asks the agent to install an MCP and checks provenance. Tests leave the workspace and app-data paths, and attach the final pi config/settings. The method E2E keeps its existing scenarios with the new entry labels.

The E2E tests ran in the real app on 2026-09-30 after merging. Not verified yet: the packaged app's launch, native addon errors and a live OAuth flow. Not built: automatic resource updates, a package gallery, GUI equivalents for terminal-only extension surfaces, and workspace backup of the pi directory.
