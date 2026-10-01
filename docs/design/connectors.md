# Connectors

Status: proposed on 2026-09-30. Tim decided the same day: ICS and EventKit first (built, see [calendar.md](calendar.md)); Google still has to be built, since many people won't add it to their Mac and Gmail needs it; bring-your-own client (b) before Jezo's own verified client (a); pi's MCP for connectors the agent uses. Research was done that day by Codex (four reports: aggregators, how open-source apps do OAuth, the options for Jezo, and the wider landscape). The full reports are kept outside the repo; the facts that decide things are summarized here with their sources.

## Question

How should Jezo connect to Google Calendar now, and later to Gmail, Microsoft 365, Notion, GitHub and Todoist? Would a connector aggregator like Composio be better than doing it ourselves?

## Proposal

1. **No aggregator by default.** Every hosted aggregator surveyed (Composio, Nango, Pipedream Connect, Arcade, Klavis, Nylas, Unified.to, Scalekit, Auth0 Token Vault, WorkOS Pipes, and about thirty more) holds the user's tokens on its servers. Most also run the API calls there, so calendar and mail content passes through them too. Self-hosting them means Docker, Kubernetes or Postgres. No broad, fully local aggregator exists. They also don't fit an open-source desktop app commercially: a project key shipped in every install gives every user the whole project's access and bill, and per-user accounts push signup and cost onto the user. The owner can still add one as their own MCP server, since pi now speaks MCP. That's their choice to make, not ours.
2. **Calendar first through paths that need no OAuth.** ICS subscriptions, and on macOS EventKit. EventKit also sees the Google, Exchange and iCloud calendars the user added in System Settings, so on a Mac Google Calendar works with no Google Cloud project at all (inference, to confirm in a spike: read and write through EventKit on a Google account added to macOS).
3. **Google Calendar directly: Jezo's own Desktop OAuth client, with bring-your-own as the fallback.** PKCE with a loopback redirect, tokens in the keychain, calls straight from the main process to Google. Sync incrementally with sync tokens and pull when the app opens or comes back, not on a short timer, because of the billing threshold below.
4. **Later connectors, one provider at a time, by whichever path is best for that provider:**
   - **Notion, Linear, Todoist:** their official remote MCP servers accept public clients (client ID metadata documents or dynamic registration). Jezo needs no OAuth app and no secret.
   - **GitHub:** the official `gh` CLI or the official local MCP server, which ship with GitHub's own registered app.
   - **Microsoft 365 / Outlook:** our own public client through MSAL and Graph. There's no secret, and publisher verification is free.
   - **Gmail:** held back. Reading mail is a restricted scope, so it needs a security assessment when data goes through third-party servers, and sending mail to a cloud model may count. Ask Google for a determination before building. Alternatives: IMAP with a Google app password (still supported), or file import.
5. **The agent reaches connectors through files and a small CLI or skill, not injected tools.** Imported events are written to the workspace with their source account. What comes in is marked and checked as outside content, and actions that go out (sending mail, inviting attendees, sharing, deleting remote objects) get their own check.

## Facts that decide this

- **Google Calendar isn't free without limit anymore.** Since 2026-09-11 new projects have a daily billing threshold of 1,000,000 requests per project. Charges above it are announced but not priced yet, with at least 90 days' notice. [Quota](https://developers.google.com/workspace/calendar/api/guides/quota)
- **rclone is retiring its shared Google client in 2026** because Google's announced billing made a shared project unaffordable. It's the clearest warning for option 3. [Announcement](https://forum.rclone.org/t/google-drive-and-google-photos-users-action-required/54005)
- **Shipping a Desktop client in open-source code is normal.** Thunderbird and GNOME Online Accounts ship Google client IDs and secrets in their source. `pi-google-services` injects them at release build time. Google says installed apps can't keep a secret. [Thunderbird](https://github.com/thunderbird/thunderbird-desktop/blob/main/mailnews/base/src/OAuth2Providers.sys.mjs), [Google native apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- **Verification:** calendar scopes are sensitive, not restricted. Unverified apps show a warning and cap at 100 users. Testing mode expires refresh tokens after seven days. Verification needs a homepage and privacy policy on a domain we own, and a video of the consent flow. There's no fee for sensitive scopes. [Sensitive scopes](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [testing limits](https://support.google.com/cloud/answer/15549945)
- **pi 0.99.0 (2026-09-29) added MCP**: stdio and HTTP, OAuth, and tools discovered on demand. It's one day old. The SDK doesn't load it automatically, and it stores OAuth in `mcp-auth.json`, not the keychain. [Changelog](https://github.com/earendil-works/pi/blob/v1.0.0/packages/coding-agent/CHANGELOG.md)
- **Google's official Workspace MCP servers** (Calendar, Gmail, …) are a developer preview. They still need our own Cloud project, and Google's docs require screening prompts for injection. Microsoft's official mail and calendar MCP needs a Microsoft 365 Copilot license. [Google](https://developers.google.com/workspace/guides/configure-mcp-servers), [Microsoft](https://learn.microsoft.com/en-us/microsoft-agent-365/tooling-servers-overview)

## How others chose

- **Hosted assistants** (Claude, ChatGPT, Gemini, Manus, Poke, Dust, Notion AI) run connectors in their own cloud, and the content reaches them.
- **Hosted agents that wanted breadth bought it.** Lindy says it spent over $1M building about 250 integrations, then moved to Pipedream. LobeHub replaced Klavis with Composio in June 2026. Open Interpreter's desktop app uses Nylas for email.
- **Local agents make the user bring an OAuth client.** Hermes asks for a Desktop client and stores the token in `~/.hermes`. OpenClaw uses `gogcli`, which also needs the user's own client.
- **Some pi extensions and skills send refresh tokens through someone else's service.** Some use the Gemini CLI Workspace broker, so refresh tokens pass through Google's broker. Raycast offers a PKCE proxy. Home Assistant's account linking passes tokens through Nabu Casa.
- **Desktop mail and calendar apps** (Thunderbird, GNOME) ship a shared client and keep tokens local. That's option 3.
- **Supply-chain incidents are real.** A fake `postmark-mcp` package quietly BCC'd mail (2025), and malicious OpenClaw skills delivered malware (2026). Connector code is code we run, so bundle what we ship, pin versions, and keep checking exits.

## Rejected

- **A hosted aggregator as the base.** It gives a third party token custody and usually the content too, costs money that grows with users, and is another company that can change terms.
- **A token broker of our own** (like Nabu Casa or Raycast). It needs a deployed service, and tokens would pass through it.
- **BYO client only.** Creating a Google Cloud project is too much to ask of the person Jezo is for. It stays as the fallback.
