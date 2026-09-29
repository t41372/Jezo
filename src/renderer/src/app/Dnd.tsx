// Drag and drop across widgets. Widgets sit side by side in a layout without
// knowing about each other, so the shell owns the drag context: a draggable
// says what it carries, and a drop target says what to do with it.

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type ClientRect,
} from '@dnd-kit/core'
import { useCallback, useRef, useState } from 'react'
import { DragPreview } from '@/components/todo/DragPreview'

export type DragItem = { kind: 'todo'; id: string }

export interface DropTarget {
  /** `rect` is where the dragged item was on screen when it was let go; zero-sized, at the pointer, for drags from the calendar grid. */
  onDrop(item: DragItem, rect: ClientRect): void
}

export function DndProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<DragItem | null>(null)
  // A few pixels of movement before a drag starts, so clicks still open things.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(e) => setActive((e.active.data.current as { item: DragItem }).item)}
      onDragCancel={() => setActive(null)}
      onDragEnd={(e) => {
        const target = e.over?.data.current as DropTarget | undefined
        const rect = e.active.rect.current.translated
        if (active && target && rect) target.onDrop(active, rect)
        setActive(null)
      }}
    >
      {children}
      <DragOverlay dropAnimation={null}>{active && <DragPreview item={active} />}</DragOverlay>
    </DndContext>
  )
}

export function useDragItem(item: DragItem, disabled?: boolean) {
  return useDraggable({ id: `${item.kind}:${item.id}`, data: { item }, disabled })
}

/**
 * Every mounted drop target and its element, so a drag that isn't dnd-kit's
 * (a block moved on the calendar grid, which has its own drag engine) can land
 * on one too, through the same onDrop.
 */
const targets = new Map<string, { node: HTMLElement; target: { current: DropTarget } }>()

export function useDropTarget(id: string, target: DropTarget) {
  const latest = useRef(target)
  latest.current = target
  const droppable = useDroppable({ id, data: target })
  const { setNodeRef: setDroppableRef } = droppable
  const setNodeRef = useCallback(
    (node: HTMLElement | null) => {
      setDroppableRef(node)
      if (node) targets.set(id, { node, target: latest })
      else targets.delete(id)
    },
    [id, setDroppableRef],
  )
  return { ...droppable, setNodeRef }
}

/** Drops an item on whatever target is at this screen point. False when there's none. */
export function dropAtPoint(item: DragItem, x: number, y: number) {
  for (const { node, target } of targets.values()) {
    const r = node.getBoundingClientRect()
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
      target.current.onDrop(item, { left: x, top: y, right: x, bottom: y, width: 0, height: 0 })
      return true
    }
  }
  return false
}
