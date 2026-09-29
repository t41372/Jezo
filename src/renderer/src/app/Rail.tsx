import { cn } from 'cn'
import { Moon, Sun } from 'lucide-react'
import { DynamicIcon, type IconName } from 'lucide-react/dynamic'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/data/store'
import { easeOut } from '@/lib/motion'
import { listPages, pageTitle, type Page } from './registry'
import { useIsDark } from './theme'

/** The icon rail on the left. Its items are the registered pages. */
export function Rail() {
  const setTheme = useStore((s) => s.setTheme)
  const dark = useIsDark()
  const { t } = useTranslation() // also re-renders the rail when the language changes
  const pages = listPages()

  return (
    <nav className="drag-region flex flex-col items-center gap-2 pt-3 pb-3.5">
      {/* Room for the macOS traffic lights, which the main process places here. */}
      <div className="hidden h-10 shrink-0 [[data-platform=darwin]_&]:block" />
      {pages
        .filter((p) => p.rail !== 'bottom')
        .map((page) => (
          <RailItem key={page.id} page={page} />
        ))}
      <div className="flex-1" />
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setTheme(dark ? 'light' : 'dark')}
        title={dark ? t('rail.switchToLight') : t('rail.switchToDark')}
        className="pressable flex size-10 items-center justify-center rounded-xl text-foreground/65 hover:text-foreground"
      >
        {/* The icons turn and swap, a small flourish for something toggled rarely. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={dark ? 'sun' : 'moon'}
            initial={{ opacity: 0, transform: 'rotate(-90deg) scale(0.8)' }}
            animate={{ opacity: 1, transform: 'rotate(0deg) scale(1)' }}
            exit={{ opacity: 0, transform: 'rotate(90deg) scale(0.8)' }}
            transition={{ duration: 0.2, ease: easeOut }}
          >
            {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </motion.span>
        </AnimatePresence>
      </button>
      {pages
        .filter((p) => p.rail === 'bottom')
        .map((page) => (
          <RailItem key={page.id} page={page} />
        ))}
    </nav>
  )
}

function RailItem({ page }: { page: Page }) {
  const active = useStore((s) => s.nav.page === page.id)
  const navigate = useStore((s) => s.navigate)
  return (
    <button
      // Like a macOS sidebar, a click doesn't take focus; Tab still does.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => navigate(page.id)}
      aria-current={active ? 'page' : undefined}
      // Muted grey vanishes when a dark desktop turns the glass grey, so the rail uses a faded foreground.
      className={cn(
        'pressable relative flex size-12 flex-col items-center justify-center gap-0.5 rounded-[14px]',
        active ? 'text-foreground' : 'text-foreground/65 hover:text-foreground',
      )}
    >
      {active && (
        <motion.span
          layoutId="rail-active"
          transition={{ duration: 0.2, ease: easeOut }}
          className="absolute inset-0 rounded-[14px] bg-accent shadow-[0_1px_3px_rgb(0_0_0/0.1)]"
        />
      )}
      <DynamicIcon name={page.icon as IconName} className="relative size-5" strokeWidth={1.8} />
      <span className="relative text-[10px] font-medium">{pageTitle(page)}</span>
    </button>
  )
}
