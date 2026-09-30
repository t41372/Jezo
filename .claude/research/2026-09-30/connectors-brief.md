# Research brief: connectors for Jezo (read-only research, do not change any files)

## What Jezo is
Jezo is an open-source (MIT-style), local-first desktop app (Electron + TypeScript, macOS first) for managing a life: todos, goals, calendar, habits. An embedded agent (the pi coding agent SDK, TypeScript, npm `@earendil-works/pi-coding-agent`) plans and follows up. It runs on one person's machine for that person. Models can be local (LM Studio, Ollama) or cloud (any provider the user adds a key for).

## Hard constraints (do not propose anything that breaks these without saying so explicitly)
1. No Docker and no separately deployed services. A sidecar process that Jezo itself starts and bundles (Node or Python) is acceptable.
2. The Jezo project has no servers and no budget for paid infrastructure. The maintainer is one person.
3. Privacy is a core reason people choose Jezo: users "don't want to hand their calendar, email, and life to a company that reads them". Any design where the user's calendar/email content, or their OAuth tokens, pass through or are stored on a third party's servers must be called out as such, with who that third party is.
4. Trust model: the owner is trusted; outside content (emails, calendar invites, web pages) is the threat because it can steer the agent via prompt injection. Defenses go on exits: actions that send private data out or can't be undone get checked.
5. Everything in Jezo is a plugin. The workspace directory on disk is the source of truth; the agent prefers to work with files and bash-like CLI tools / skills rather than having things injected into its context.

## The concrete question behind this research
Jezo needs Google Calendar now (plus ICS subscriptions and macOS EventKit, which are solved). Later it will likely want Gmail, Outlook/Microsoft 365 calendar and mail, Notion, GitHub, Todoist import, etc. For Google, the current plan is: (a) Jezo publishes its own Google Cloud "Desktop app" OAuth client in the open-source code (PKCE + loopback redirect), with (b) "bring your own OAuth client" as a fallback. The maintainer asks: how do connectors usually work in this ecosystem, how does the community do it, and would a connector-aggregator SDK such as Composio be better for Jezo?

## Rules for your answer
- Research on the live web. Today is 2026-09-30. Prefer primary sources (official docs, pricing pages, licenses, GitHub repos, Google/Microsoft developer policy pages). Give a URL for every factual claim, and say when a source is older than 2026.
- Separate what you verified from what you infer. Mark inferences with "(inference)".
- Do not recommend a final architecture unless your section asks for it; report facts and trade-offs.
- Be concrete: names, licenses, prices, limits, what data flows where.
- Write in English, as plain markdown, with no preamble. Aim for depth over breadth, but cover every item listed in your section.
