// Items in the workspace, as the main process sends them to the windows.
// See docs/design/backend.md.

/** One markdown file with frontmatter: a todo, a note, a goal… */
export interface Item {
  /** The kind named in its directory's manifest, like "todo". */
  kind: string
  id: string
  /** Relative to the workspace, with forward slashes. */
  path: string
  /** The frontmatter. */
  data: Record<string, unknown>
  body: string
  /** The file's hash when it was read, so a write can tell if it changed since. */
  hash: string
  /** What the check found wrong with it. An item with problems is still shown. */
  problems?: string[]
  /**
   * The items it links to: markdown links in the body that point at another
   * item's file, and frontmatter values that are another item's id. Worked out
   * by the app; links that point nowhere aren't listed.
   */
  links?: string[]
}

export interface ItemChanges {
  changed: Item[]
  removed: string[]
}

/** Changes to one item's fields. A field set to null is removed. */
export type Fields = Record<string, unknown>
