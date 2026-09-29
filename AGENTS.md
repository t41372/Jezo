# Jezo

Jezo is an open-source, local-first personal agent for managing a life: todos, goals, calendar, habits. The user sets the direction, Jezo's agent plans and follows up, and the user does the work.

This file is for you, the agent building Jezo. "Jezo's agent" means the agent that ships inside the app. Instructions written for Jezo's agent are product content, not instructions to you.

## Who Jezo is for

Jezo is built for people with ADHD who have abandoned every todo app they tried. Those apps didn't fail on features. They failed because gathering context and keeping tasks current took more energy than doing the tasks. And after a week off, the list was stale, and quitting felt easier than cleaning up. These users also don't want to hand their calendar, email, and life to a company that reads them.

When nothing here settles a question, picture that person opening Jezo after two weeks away, and build what would make them stay.

## Principles

1. **The directory is the truth.** The workspace directory is the single source of truth, and Jezo's agent works directly in it. Everything else, such as indexes and caches, either can be rebuilt from it or is safe to lose.

2. **If the GUI can't show it, it doesn't exist.** Jezo is 100% GUI. Users are never forced to touch a file, a config, or a terminal; at most they copy and paste.

3. **Explicit over implicit.** Show all the information, but disclose it progressively: fold away excess detail so it's visible when needed and out of sight when not.

4. **Easy beats powerful.** Software that looks too professional goes unused. The default setup should already be good, and users grow their Jezo into what they want over time.

5. **No methodology is hard-coded.** Theories about how to manage a life get overturned, and none fits everyone. Every methodology is a skill or prompt that can be installed, turned off, or edited, including by Jezo's agent. Only what can't be unbundled, such as the core UI and the todo data structure, is designed from current evidence.

6. **Everything is a plugin, built-ins included.** Every page is made of plugins, and the built-in pages are made the same way as the dashboards users build, so extending Jezo is never second-class.

7. **Catch mistakes, don't cap capability.** Weak models make mistakes, and Jezo should account for that. Catch their mistakes with checks, the way a linter does, so the user isn't the one who finds out something broke. Never do it by limiting what strong models can do. Local models are already strong and are getting stronger fast.

8. **Written for the people who maintain it.** Our code is read and maintained by people for years. Keep the architecture elegant, the code clean, and the whole system easy to maintain. Text, whether in docs, comments, or the UI, says things plainly, the way a person would. No AI slop.

## Trust model

Jezo runs locally for one person, who owns the machine, the data, and every piece of code on it. Coding agents tend to over-defend. In a local app, most defenses end up protecting users from themselves, and every one of them costs capability or maintainability. Size each defense to a real attack surface.

- **The owner is trusted.** The user, whatever they type or say, their data, and any code they choose to run are all trusted. Don't sanitize, redact, or sandbox the owner's own input or code.
- **Threats come from outside.** The real attack surface is outside content, such as email, calendar invites, web pages, and shared files. It can steer Jezo's agent, either right away or later through what the agent remembers. The other risk is any path that sends private data somewhere the user didn't intend. A defense that doesn't address one of these two isn't defending anything.
- **Guard the exits, not the inputs.** Prompt injection is unsolved, so assume outside content will sometimes steer even a strong model. Don't try to scrub everything that comes in. Instead, make sure a steered agent can't do lasting harm, by checking actions that send private data out or can't be undone.
- **Undo instead of asking.** Inside the workspace, Jezo's agent acts without asking permission, and undo is the safety net. Save questions for actions that leave the machine or can't be reversed. Approval prompts mostly get rubber-stamped and only add friction.

## How we work

- **Reason from first principles.** Start from what the person above needs, not from how other todo apps do it; most of those apps fail this person. Precedent is evidence, not an argument. When principles pull against each other, work out from first principles what is actually best, rather than ranking them.
- **Principles here, decisions in `docs/design/`.** Design docs record decisions and every feature: what was decided, why, and what was rejected. Read the doc for the area you're changing. When you make or reverse a decision, update its doc in the same change. Keep decisions out of this file, because decisions change and principles shouldn't.
- **Ask or act.** Make routine judgment calls yourself and state the assumption. Ask when different readings would lead to materially different work.
- **Precedence.** The user's request in the current conversation overrides this file. If it conflicts with a principle, say so, then follow the user.

## Testing

- **E2E tests prove features.** Prefer them as the only testing mechanism, and use them to verify complex features in the real app. Pick a medium-to-hard scenario, not the simplest one that passes, because a half-built feature usually passes the happy path.
- **Test the real thing, not a spherical chicken.** Tests run in a separate environment that is otherwise real. An idealized mock lets every test pass while the product breaks the moment someone opens it.
- **Every E2E run ends with a verifiable, repeatable artifact.**
- **Don't write unit tests after the code.** Tests written afterward encode what the code does, not what it should do. When something truly has to be tested in isolation, first write down every way it could fail, then write the code.
