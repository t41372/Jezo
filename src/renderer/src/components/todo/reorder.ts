// Dropping a todo into a list in its own order (the backlog): where it would go,
// judged from the rows on screen. The backlog column and 待辦 both use it.

import type { ClientRect } from '@dnd-kit/core'

/** Where in the list a dragged todo would go: in front of a row, or at the end (null); `y` is the gap's middle, from the list's top. */
export interface Insertion {
  before: string | null
  y: number
}

/** The height the drop is judged at: the drag chip's middle for rows dragged with dnd-kit, the pointer for blocks from the grid. */
export const pointerY = (rect: ClientRect) => (rect.height ? rect.top + 14 : rect.top)

/**
 * The slot at a screen height among the rows other than the one moving, each
 * marked with `attribute` holding its todo's id. Null when dropping there
 * wouldn't change anything: the row is already there. `gap` is the space
 * between rows.
 */
export function insertionAt(list: HTMLElement | null, attribute: string, moving: string | null, y: number, gap: number): Insertion | null {
  if (!list) return null
  const id = (el: Element) => el.getAttribute(attribute)
  const all = [...list.querySelectorAll<HTMLElement>(`[${attribute}]`)]
  const others = all.filter((el) => id(el) !== moving)
  const top = list.getBoundingClientRect().top
  const next = others.find((el) => {
    const r = el.getBoundingClientRect()
    return y < r.top + r.height / 2
  })
  const before = next ? id(next) : null
  const own = all.findIndex((el) => id(el) === moving)
  if (own >= 0 && (all[own + 1] ? id(all[own + 1]) : null) === before) return null
  const last = others.at(-1)
  const at = next ? next.getBoundingClientRect().top - gap / 2 : last ? last.getBoundingClientRect().bottom + gap / 2 : top
  return { before, y: at - top }
}
