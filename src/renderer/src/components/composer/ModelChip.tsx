import { cn } from 'cn'
import { Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { easeOut } from '@/lib/motion'
import type { ModelChoices, ProviderModel } from '../../../../shared/bridge'

type Choosable = { provider: string; providerName: string; model: ProviderModel }

/** Keeps the model choices current while mounted. */
function useChoices() {
  const [choices, setChoices] = useState<ModelChoices | null>(null)
  useEffect(() => {
    const load = () => window.jezo.providers.choices().then(setChoices)
    load()
    return window.jezo.providers.onChange(load)
  }, [])
  return [choices, setChoices] as const
}

/**
 * The model and how hard it thinks, from the message box, as ChatGPT does it:
 * the chip says the thinking level; its menu has a slider for it, and the
 * model list one step further in. It changes Jezo's model everywhere, the same
 * choice as in 設定.
 */
export function ModelChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  const [choices, setChoices] = useChoices()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<'thinking' | 'models'>('thinking')
  // Opening the menu puts the keyboard on the slider, the thing most often changed.
  const slider = useRef<HTMLDivElement>(null)
  if (!choices?.main) return null
  const thinks = choices.thinkingLevels.some((l) => l !== 'off')
  const label = thinks ? t(`thinking.${choices.thinking}` as 'thinking.medium') : choices.main.id

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setPage(thinks ? 'thinking' : 'models')
      }}
    >
      <PopoverTrigger
        onMouseDown={(e) => e.preventDefault()}
        className={cn(
          'pressable flex h-9 max-w-44 items-center gap-1 rounded-full px-3 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground data-[popup-open]:bg-muted',
          className,
        )}
      >
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" />
      </PopoverTrigger>
      {/* Opened from the keyboard, focus goes to the slider; opened with the mouse, it stays put, with no ring. */}
      <PopoverContent side="top" align="end" className="w-80 p-0" initialFocus={(type) => (type === 'keyboard' ? slider.current : false)}>
        {page === 'thinking' ? (
          <div className="flex flex-col gap-3 p-3.5">
            <button
              onClick={() => setPage('models')}
              className="flex items-center gap-1 self-start rounded-md text-[13px] text-muted-foreground transition-colors duration-150 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <span className="truncate">{choices.main.id}</span>
              <ChevronRight className="size-3.5" />
            </button>
            <ThinkingSlider
              ref={slider}
              levels={choices.thinkingLevels}
              value={choices.thinking}
              onChange={(level) => window.jezo.providers.setThinking(level).then(setChoices)}
            />
          </div>
        ) : (
          <ModelList
            back={thinks ? () => setPage('thinking') : undefined}
            current={choices.main}
            onPick={(provider, id) =>
              window.jezo.providers.choose('main', { provider, id }).then((c) => {
                setChoices(c)
                setOpen(false)
              })
            }
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

const THUMB = 32 // px, larger than the track, as in Codex's slider
const PAD = 2 // px between the track's edge and the thumb at either end

/**
 * How hard the model thinks, as a slider: the thumb follows the pointer with a
 * little spring while it's dragged, and settles on the nearest level when it's
 * let go. The label says the level under the thumb as it moves. The top level
 * glows, since it's the slowest. Arrow keys move one level.
 */
function ThinkingSlider({
  ref,
  levels,
  value,
  onChange,
}: {
  ref: React.Ref<HTMLDivElement>
  levels: string[]
  value: string
  onChange: (level: string) => void
}) {
  const { t } = useTranslation()
  const reduce = useReducedMotion()
  const track = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [dragging, setDragging] = useState(false)
  // Pointer events read this, not the state, so a move right after the press isn't lost to a render.
  const held = useRef(false)
  const committed = Math.max(0, levels.indexOf(value))
  const [shown, setShown] = useState(committed)
  const last = levels.length - 1

  // Where the thumb's left edge is for a level, and the other way round.
  const span = Math.max(0, width - THUMB - PAD * 2)
  const at = (i: number) => PAD + (last ? (i / last) * span : 0)
  const nearest = (x: number) => (last ? Math.round(((x - PAD) / Math.max(1, span)) * last) : 0)

  const x = useMotionValue(0)
  const spring = useSpring(x, reduce ? { duration: 0 } : { stiffness: 700, damping: 48, mass: 0.7 })
  const transform = useTransform(spring, (v) => `translateX(${v}px)`)
  // The fill runs from the left edge to the thumb's right edge, clipped so its rounded end stays round.
  const clipPath = useTransform(spring, (v) => `inset(0 ${Math.max(0, width - v - THUMB - PAD)}px 0 0 round 999px)`)

  useLayoutEffect(() => {
    const el = track.current
    if (!el) return
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  // Measured, or the level changed elsewhere: the thumb goes there without a spring the first time.
  useLayoutEffect(() => {
    if (dragging || !width) return
    setShown(committed)
    x.set(at(committed))
  }, [committed, width])
  useLayoutEffect(() => {
    if (width) spring.jump(at(committed))
  }, [width > 0])

  const settle = (i: number) => {
    const index = Math.min(last, Math.max(0, i))
    setShown(index)
    x.set(at(index))
    if (index !== committed) onChange(levels[index])
  }
  const follow = (clientX: number) => {
    const left = track.current!.getBoundingClientRect().left
    const pos = Math.min(at(last), Math.max(PAD, clientX - left - THUMB / 2))
    x.set(pos)
    setShown(nearest(pos))
  }

  const top = shown === last && last > 1
  const label = t(`thinking.${levels[shown] ?? value}` as 'thinking.medium')
  return (
    <div className="flex flex-col gap-2.5">
      <div className="relative h-5 text-center text-[14px] font-semibold">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={top ? 'top' : 'level'}
            initial={{ opacity: 0, transform: 'translateY(4px)' }}
            animate={{ opacity: 1, transform: 'translateY(0px)' }}
            exit={{ opacity: 0, transform: 'translateY(-4px)' }}
            transition={{ duration: 0.16, ease: easeOut }}
            className={cn('block', top ? 'text-brand-high' : 'text-brand')}
          >
            {top ? t('thinking.slowest') : label}
          </motion.span>
        </AnimatePresence>
      </div>
      <div
        ref={(el) => {
          track.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) (ref as React.RefObject<HTMLDivElement | null>).current = el
        }}
        role="slider"
        tabIndex={0}
        aria-label={t('thinking.label')}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={shown}
        aria-valuetext={label}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') (e.preventDefault(), settle(shown + 1))
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') (e.preventDefault(), settle(shown - 1))
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          held.current = true
          setDragging(true)
          follow(e.clientX)
        }}
        onPointerMove={(e) => held.current && follow(e.clientX)}
        onPointerUp={(e) => {
          if (!held.current) return
          held.current = false
          setDragging(false)
          const left = track.current!.getBoundingClientRect().left
          settle(nearest(e.clientX - left - THUMB / 2))
        }}
        onPointerCancel={() => {
          held.current = false
          setDragging(false)
          settle(shown)
        }}
        className={cn(
          'relative h-8 touch-none rounded-full bg-muted outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/40',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <motion.div aria-hidden style={{ clipPath }} className="absolute inset-0 overflow-hidden rounded-full bg-brand">
          {/* The top level: the fill turns violet and sparkles. */}
          <span
            className={cn(
              'absolute inset-0 bg-linear-to-r from-brand from-30% to-brand-high opacity-0 transition-opacity duration-200 ease-(--ease-out)',
              top && 'opacity-100',
            )}
          >
            {top && !reduce && <Sparkles />}
          </span>
        </motion.div>
        {/* A dot at each level, light over the fill and faint beyond it. */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {levels.map((level, i) => (
            <span
              key={level}
              className={cn(
                'absolute top-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full transition-colors duration-150',
                i <= shown ? 'bg-white/70' : 'bg-foreground/30',
              )}
              style={{ left: at(i) + THUMB / 2 }}
            />
          ))}
        </div>
        {/* The outer span only moves; the circle inside grows while held. Scaling the mover would scale its travel too. */}
        <motion.span aria-hidden style={{ transform }} className="absolute top-1/2 left-0 -mt-4 size-8">
          <span
            className={cn(
              'block size-full rounded-full bg-white shadow-[0_1px_4px_rgb(10_14_40/0.3)] transition-[scale] duration-150 ease-(--ease-out)',
              dragging && 'scale-[1.08]',
            )}
          />
        </motion.span>
      </div>
    </div>
  )
}

/** Small specks drifting along the fill at the top level. Decorative; off with reduced motion. */
function Sparkles() {
  const specks = [8, 19, 31, 44, 57, 68, 79, 90]
  return (
    <>
      {specks.map((left, i) => (
        <span
          key={left}
          className="absolute size-[2px] rounded-full bg-white/80 motion-safe:animate-[jezo-drift_2.4s_linear_infinite]"
          style={{ left: `${left}%`, top: `${25 + ((i * 37) % 50)}%`, animationDelay: `${-i * 0.31}s` }}
        />
      ))}
    </>
  )
}

function ModelList({ back, current, onPick }: { back?: () => void; current: { provider: string; id: string }; onPick: (provider: string, id: string) => void }) {
  const { t } = useTranslation()
  const [models, setModels] = useState<Choosable[]>([])
  useEffect(() => {
    window.jezo.providers.choosable().then(setModels)
  }, [])
  const groups = [...new Map(models.map((m) => [m.provider, m.providerName])).entries()]
  return (
    <Command>
      <div className="flex items-center">
        {back && (
          <button onClick={back} aria-label={t('thinking.back')} className="ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="size-4" />
          </button>
        )}
        <CommandInput placeholder={t('thinking.searchModels')} className="flex-1" />
      </div>
      <CommandList className="max-h-72">
        <CommandEmpty>{t('thinking.noModels')}</CommandEmpty>
        {groups.map(([provider, name]) => (
          <CommandGroup key={provider} heading={name}>
            {models
              .filter((m) => m.provider === provider)
              .map(({ model }) => (
                <CommandItem key={model.id} value={`${name} ${model.id}`} onSelect={() => onPick(provider, model.id)}>
                  <span className="min-w-0 flex-1 truncate">{model.name}</span>
                  {current.provider === provider && current.id === model.id && <Check className="size-3.5" />}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  )
}
