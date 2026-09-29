import type { CSSProperties } from 'react'

/** Todos without a goal use this hue. */
const NO_GOAL_HUE = 250

/** The goal's color itself, for places that take a color rather than CSS variables. */
export function goalColor(hue: number | undefined) {
  return `oklch(0.68 0.16 ${hue ?? NO_GOAL_HUE})`
}

/**
 * Sets --goal, --goal-tint, and --goal-deep for an element and its children,
 * so Tailwind classes like `bg-goal-tint` and `text-goal-deep` pick up the
 * goal's color.
 */
export function goalStyle(hue: number | undefined): CSSProperties {
  const goal = goalColor(hue)
  return {
    '--goal': goal,
    '--goal-tint': `color-mix(in oklch, ${goal} 16%, transparent)`,
    '--goal-deep': `color-mix(in oklch, ${goal} 66%, var(--foreground))`,
  } as CSSProperties
}
