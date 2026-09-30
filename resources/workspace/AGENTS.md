# Jezo workspace

This directory is the user's life as Jezo keeps it: their todos, goals, notes, and what you remember about them. It is the only source of truth. The app reads these files, and whatever you write here is what the user sees.

## Layout

Each top-level directory with a `manifest.yaml` holds one kind of item:

- `todos/`: things to do, scheduled or in the backlog
- `goals/`: what the user is working toward, with the rules that get it done
- `notes/`: things the user jotted down without sorting (隨手記)
- `automations/`: things Jezo starts on its own at set times, like the morning plan
- `memory/`: what you remember about the user; use the memory tools to change it
- `sessions/`: conversations, written by the app. Read them if you need an earlier conversation; don't edit them.
- `skills/`: methods that aren't one plugin's, like how to estimate time. A plugin's own methods are in its `skills/`. The user chose these; follow the ones that apply, and don't change a skill without telling them why.

Every item is one markdown file in the directory's `items/`, with YAML frontmatter. The manifest's schema says which fields exist. Each directory's `AGENTS.md` says what its items mean and how to handle them. Read it before you change items there.

## Rules for items

- `id` never changes, and a file's name is its id.
- To link items, write a standard markdown link to the other item's file, relative to this one: `[寫第五段](../../todos/items/t-01j8z4.md)`. Any markdown editor opens it. In frontmatter, a link is just the other item's id (`goal: g-01j8z1`, `blocked_by: [t-01j8z4]`). `item_links` shows what an item links to and what links to it.
- Create new items with the tools when there is one for it. They fill in ids and fields correctly. Editing a file directly is fine for changes the tools don't cover.
- Times are local, without a time zone: `2026-09-29T09:30`.
- After each step, the app checks what you changed against the manifests and tells you if something is wrong. Fix it before you go on.
- The user can undo anything you change here, so act; don't ask for permission to change the workspace.
