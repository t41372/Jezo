import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'
import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/data/store'
import type { Todo } from '@/data/types'

/**
 * The round checkbox in the goal's color. Checking fills it first and reports
 * after a beat, so the user sees the check land before the row moves away.
 */
export function TodoCheck({ todo, size = 20, className }: { todo: Todo; size?: number; className?: string }) {
  const setDone = useStore((s) => s.setDone)
  const [pending, setPending] = useState<boolean | null>(null)
  const timer = useRef<number>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const checked = pending ?? todo.state === 'done'

  return (
    <CheckboxPrimitive.Root
      checked={checked}
      onCheckedChange={(next) => {
        setPending(next)
        window.clearTimeout(timer.current)
        timer.current = window.setTimeout(() => {
          setDone(todo.id, next)
          setPending(null)
        }, 280)
      }}
      aria-label={todo.title}
      style={{ width: size, height: size }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border-2 border-goal text-white outline-none',
        'transition-[background-color,border-color] duration-150 ease-out',
        'focus-visible:ring-3 focus-visible:ring-ring/50 data-checked:bg-goal',
        todo.state === 'draft' && 'border-dashed',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="flex data-starting-style:scale-50 data-starting-style:opacity-0 transition-[transform,opacity] duration-150 ease-out">
        <Check className="size-3" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}
