import type { DragItem } from '@/app/Dnd'
import { goalById, useStore } from '@/data/store'
import { goalStyle } from '@/lib/goal-color'

/**
 * What follows the pointer while a todo is dragged: a small chip whose top edge
 * marks where it will land. The dashed ghost on the grid shows the full length.
 */
export function DragPreview({ item }: { item: DragItem }) {
  const todo = useStore((s) => s.todos.find((t) => t.id === item.id))
  const goal = useStore((s) => goalById(s.goals, todo?.goalId ?? null))
  if (!todo) return null
  return (
    <div
      style={goalStyle(goal?.hue)}
      // Lifts as it's picked up: a little larger, with a deeper shadow. Origin at the top-left, which marks where it lands.
      className="flex h-7 w-full max-w-56 origin-top-left cursor-grabbing items-center gap-1.5 overflow-hidden rounded-[10px] border border-goal bg-card px-2 py-1 text-xs font-semibold text-goal-deep shadow-[0_12px_28px_-6px_rgb(10_14_40/0.4)] transition-[scale,box-shadow] duration-150 ease-out starting:scale-100 starting:shadow-none motion-safe:scale-103"
    >
      <span className="size-[11px] shrink-0 rounded-full border-[1.5px] border-goal" />
      <span className="truncate">{todo.title}</span>
    </div>
  )
}
