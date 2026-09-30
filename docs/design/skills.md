# Skills

Status: decided on 2026-09-30. The user can add methods in 更多 → 已安裝, and ask Jezo's agent to install one in a conversation. The shared entry also installs pi packages and MCP servers ([extensions.md](extensions.md)).

## Sources and destination

A method follows the Agent Skills format: a directory with SKILL.md, YAML frontmatter with a name and description, and any companion files. Installations always go into the workspace's top-level `skills/<name>/`. Names become lowercase ASCII letters, digits and single hyphens, at most 64 characters. An unusable name is refused. Installed methods are on, using pi's own `disable-model-invocation` field.

The user can paste a GitHub repository, tree, or SKILL.md address; paste a link to a .zip, .skill, .tar.gz or .tgz archive; choose a folder or archive in the native picker; or write a name, one-line description and instructions in the app. GitHub repositories without a ref use the default branch reported by the repository API. Jezo downloads a tarball from codeload, removes the repository wrapper and PAX global header, and keeps the method's own file layout. A ref with slashes can be URL-encoded as one path segment.

Jezo finds every directory with SKILL.md, skipping dot directories, .git and node_modules. A GitHub address pointing at a method selects that method. For other sources holding several methods, the dialog shows checkboxes, all selected initially. `install_from_address` writes nothing and returns each method's path, name and description; the agent calls again with a path.

The main process retains the files while the user chooses what to install. It discards them when the dialog closes. Confirmation installs the same files the user saw.

## Integrity checks

SKILL.md must be UTF-8 text and have frontmatter that parses, with a name and description. Invalid methods report their file and the reason. Downloads are limited to 50 MB, what they unpack to to 200 MB, and each method to 2,000 files; errors include the actual count and the limit. Unpacking stops as soon as it passes the limit, since a small archive can unpack to gigabytes.

Archive entries with absolute paths, `..` segments or links are skipped and counted by reason. Jezo checks raw tar names before nanotar reads them, because that parser normalizes unsafe paths. ZIP's central directory supplies link and executable information. Local folders are read without following links. These checks keep an archive's files in their method directory; they do not restrict instructions or the owner's content.

The page says when a method includes scripts, program files or executable files. The agent runs them with its shell when the instructions call for it (backend.md, "Tools").

## Writes, provenance and undo

Text files are written through `Workspace.writeFile` as `currentActing().actor`. Agent installs therefore appear in 修改紀錄 and undo removes their text files. Bytes that are not valid UTF-8, or contain NUL, are written atomically as binary files. Binary files are listed in provenance and removed with the method, but text undo does not restore or remove them. Undoing an installation can leave binary companions in its directory.

`skills/installed.yaml` has a comment header and a `skills` list. An entry records the directory name, original source, resolved GitHub ref when applicable, path in the source, installation time, user or agent, and the SHA-256 of SKILL.md as installed. Local sources say `this computer`. Methods written in the app say `written`, have `by: user`, and need no source hash. Binary companion paths are kept in `binary`.

The list and view show the source and who installed it. Files Jezo seeded without an installation record say Jezo 內建. Top-level built-ins belong to the user and can be removed. Methods inside a plugin's directory can only be turned off.

Removal deletes text files through `Workspace.removeFile`, binary files directly, and the provenance entry. It is the explicit exception to agent-only history: the user's removal is recorded as a user action in 修改紀錄 so the dialog's undo promise works. Other GUI edits are not added to history. Undo keeps files the user changed afterward, as it does for agent runs. The removal dialog explains when binary companions cannot be restored.

## Replacement and update

An existing directory is refused until replacement is agreed to. The dialog asks 取代「title」？. The tool tells the agent to call again with `replace: true` only if the user asked to replace it. All selected directories are checked before any installation begins.

Methods from a GitHub or archive address can be updated from their view. Update fetches the same source and recorded ref, then selects the recorded path. If the current SKILL.md hash differs from its installed hash, the dialog says 你改過這個方法，更新會蓋掉你的修改。 and waits for agreement. The hash is checked again before writing. Replacement removes old companion files, including files missing from the new version, and writes a new provenance record.

pi loads skills when a session is created. Installing during a conversation affects the next conversation. The tool result and dialog say so.

## Who may install

The GUI is always available to the owner. `install_from_address` accepts plain string and boolean parameters: source, optional path, optional replace. Checks run inside the tool, rather than in schema patterns or nullable unions that break local model grammars.

The tool only runs when `currentActing().source` is `user`, in a run started by chat or ⌥X, including a user reply in an earlier automatic conversation. Automations and 隨手記 sorting use `agent` and are refused with: “Skills can only be installed when the user asks in the conversation.” A skill is lasting instructions. Outside content, such as an email or calendar invite, must not get an unattended agent to install instructions that influence later conversations. This follows AGENTS.md's trust model, including the risk from what the agent keeps.

The agent can still write a method by hand with its existing file tools. No execution capability is added with a method.

## Rejected

- Previously rejected: installing pi packages because they can bring executable extensions. Tim reversed this on 2026-09-30: all installed code is equally trusted and pi's own features come first. Packages use Jezo's own persistent pi directory; standalone methods keep their workspace installer and undo ([extensions.md](extensions.md)).
- `git clone`. Git is not installed on every Mac. GitHub's tarballs need no external executable.
- Letting automations install. Outside content must not gain lasting instructions through an unattended run.

## Verification

Pure-function tests start with a list of failure cases: addresses, discovery, naming, unsafe archive entries, download and file limits, and text detection. The GUI E2E uses a local server speaking GitHub's API and codeload shapes, with real nanotar archives. It checks selective installation, provenance, scripts and binaries, replacement, writing, native folder selection, removal and undo, updates over local edits, and escape entries. The agent E2E uses a real local model, checks `by: agent`, and undoes the installed text files. Each E2E leaves its workspace as an artifact.
