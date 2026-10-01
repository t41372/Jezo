import { cn } from 'cn'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ArgumentSuggestion, SlashCommand } from '../../../../shared/session'

/** A command in the menu, with what picking it does: run an action, or put text in the box (`/name ` unless `insert` says). */
export type SlashItem = SlashCommand & { run?: () => void; insert?: string; argument?: boolean }

/**
 * The "/" menu: typing "/" at the start of the box lists what can be run from a
 * message, narrowed as the user types (docs/design/frontend.md, "Slash commands").
 * The keys go through `onKey`, since the box keeps the focus.
 */
export function useSlashMenu({ value, load, suggest, actions, onPick }: {
  value: string
  load?: () => Promise<SlashCommand[]>
  /** An extension command's suggestions for its arguments. */
  suggest?: (name: string, typed: string) => Promise<ArgumentSuggestion[]>
  /** Jezo's own actions, like a new conversation. */
  actions: SlashItem[]
  onPick: (item: SlashItem) => void
}) {
  const query = /^\/(\S*)$/.exec(value)?.[1]
  const [loaded, setLoaded] = useState<SlashCommand[]>([])
  // After "/name ", a command that suggests its arguments gets asked for them.
  const after = /^\/(\S+) ([^\n]*)$/.exec(value)
  const completing = after && loaded.find((c) => c.name === after[1] && c.completes)
  const [suggestions, setSuggestions] = useState<SlashItem[]>([])
  const [active, setActive] = useState(0)
  // Escape closes the menu for what's typed now; typing on opens it again.
  const [dismissed, setDismissed] = useState<string | null>(null)
  const typing = query !== undefined
  const slashed = value.startsWith('/')

  // Read again each time the menu opens: a method installed a minute ago is there.
  useEffect(() => {
    if (!slashed) return
    let current = true
    load?.().then((commands) => current && setLoaded(commands), () => undefined)
    return () => {
      current = false
    }
  }, [slashed, load])

  useEffect(() => {
    if (!completing || !after || !suggest) {
      setSuggestions([])
      return
    }
    let current = true
    const name = completing.name
    suggest(name, after[2]).then(
      (found) => current && setSuggestions(found.map((s) => ({ name: s.value, title: s.label, description: s.description, source: 'extension', insert: `/${name} ${s.value}`, argument: true }))),
      () => undefined,
    )
    return () => {
      current = false
    }
  }, [completing?.name, after?.[2], suggest])

  const q = (query ?? '').toLowerCase()
  const items = typing ? [...actions, ...loaded].filter((c) => [c.name, c.title, c.description].some((text) => text?.toLowerCase().includes(q))) : completing ? suggestions : []
  const open = (typing || !!completing) && dismissed !== value && items.length > 0
  useEffect(() => {
    setActive(0)
  }, [value])

  // A picked argument is the user's answer: the menu stays shut until they type on.
  const pick = (item: SlashItem) => {
    if (item.insert) setDismissed(item.insert)
    onPick(item)
  }

  /** Handles a key while the menu is open; true when it took the key. */
  const onKey = (e: React.KeyboardEvent) => {
    if (!open || e.nativeEvent.isComposing) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + items.length) % items.length)
    } else if (e.key === 'Enter' || e.key === 'Tab') pick(items[Math.min(active, items.length - 1)])
    else if (e.key === 'Escape') setDismissed(value)
    else return false
    e.preventDefault()
    return true
  }

  return { open, items, active, setActive, onKey, pick }
}

export function SlashMenu({ items, active, onHover, onPick, side }: {
  items: SlashItem[]
  active: number
  onHover: (index: number) => void
  onPick: (item: SlashItem) => void
  side: 'top' | 'bottom'
}) {
  const { t } = useTranslation()
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.querySelector('[data-active]')?.scrollIntoView({ block: 'nearest' })
  }, [active])
  return (
    <div
      ref={list}
      role="listbox"
      aria-label={t('composer.commands.label')}
      className={cn(
        'max-h-64 overflow-auto rounded-2xl border border-card-border bg-popover p-1.5 text-[13.5px] shadow-[0_4px_16px_rgb(10_14_40/0.08)]',
        side === 'top' ? 'absolute right-0 bottom-full left-0 z-20 mb-2' : 'mt-2',
      )}
      data-slash-menu
    >
      {items.map((item, i) => (
        <div
          key={`${item.source}:${item.name}`}
          role="option"
          aria-selected={i === active}
          {...(i === active && { 'data-active': true })}
          className={cn('flex cursor-default items-baseline gap-2 rounded-xl px-3 py-2', i === active && 'bg-muted')}
          onMouseMove={() => onHover(i)}
          // The box keeps the focus.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(item)}
        >
          <span className="shrink-0 font-medium">{item.title ?? `/${item.name}`}</span>
          {item.title && !item.argument && <span className="shrink-0 font-mono text-[12px] text-muted-foreground">/{item.name}</span>}
          {item.hint && <span className="shrink-0 font-mono text-[12px] text-muted-foreground">{item.hint}</span>}
          {item.description && <span className="min-w-0 truncate text-[12.5px] text-muted-foreground">{item.description}</span>}
          {!item.argument && <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">{t(`composer.commands.source.${item.source}`)}</span>}
        </div>
      ))}
    </div>
  )
}
