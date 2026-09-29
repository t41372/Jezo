import { useEffect, useSyncExternalStore } from 'react'
import { useStore } from '@/data/store'

const darkQuery = matchMedia('(prefers-color-scheme: dark)')

function subscribe(onChange: () => void) {
  darkQuery.addEventListener('change', onChange)
  return () => darkQuery.removeEventListener('change', onChange)
}

/**
 * Whether the window is dark right now. The main process sets nativeTheme from
 * the theme setting, so this media query answers for "system" and for an
 * explicit choice alike.
 */
export function useIsDark() {
  return useSyncExternalStore(subscribe, () => darkQuery.matches)
}

/** Applies the theme setting. Only the main window calls this. */
export function useTheme() {
  const theme = useStore((s) => s.settings.theme)
  useEffect(() => {
    window.jezo.setTheme(theme)
  }, [theme])
  useDarkClass()
}

/** Keeps the `dark` class on <html> in step with the window's appearance. */
export function useDarkClass() {
  const dark = useIsDark()
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
  }, [dark])
}

/** Marks the platform on <html>, for window chrome that differs per OS. */
export function markPlatform() {
  document.documentElement.dataset.platform = window.jezo.platform
}
