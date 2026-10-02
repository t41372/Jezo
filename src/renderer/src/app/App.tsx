import { MotionConfig } from 'motion/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useStore } from '@/data/store'
import { DndProvider } from './Dnd'
import { Layout } from './Layout'
import { Rail } from './Rail'
import { getPage, listPages, pageTitle } from './registry'
import { useTheme } from './theme'

export function App() {
  useTheme()
  useQuickWindow()
  useEffect(() => window.jezo.agent.onNotice(({ message, type }) => toast[type](message)), [])
  const { i18n } = useTranslation()
  const pageId = useStore((s) => s.nav.page)
  const page = getPage(pageId)

  // Voice input from ⌥X brings along what the user was looking at.
  useEffect(() => {
    if (page) window.jezo.setContext(pageTitle(page))
  }, [page, i18n.language])
  // Dictation should expect the app's own page names, as they're said in its language.
  useEffect(() => {
    window.jezo.speech.setVocabulary(listPages().map(pageTitle), i18n.language)
  }, [i18n.language])

  return (
    <MotionConfig reducedMotion="user">
      {/* The window's title bar: you drag the window by its top edge, across its full width. It comes
          first so that buttons in the strip, which opt out in globals.css, still get clicked. */}
      <div className="drag-region fixed inset-x-0 top-0 hidden h-10 [[data-platform=darwin]_&]:block" />
      <div className="grid h-full grid-cols-[88px_minmax(0,1fr)] bg-win">
        <Rail />
        <div className="flex min-h-0 min-w-0 py-2.5 pr-2.5">
          <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-win-border bg-background">
            <DndProvider>{page ? <Layout key={`${page.id}-${i18n.language}`} node={page.layout} /> : null}</DndProvider>
          </main>
        </div>
      </div>
      <Toaster position="bottom-center" />
    </MotionConfig>
  )
}

/** A conversation continues here: from the ⌥X window, or a notification. */
function useQuickWindow() {
  useEffect(
    () =>
      window.jezo.onOpenSession((session) => {
        useStore.getState().openSession(session)
      }),
    [],
  )
  // A deadline's reminder opens its todo in 待辦.
  useEffect(
    () =>
      window.jezo.onOpenTodo((todo) => {
        useStore.getState().navigate('todos')
        if (todo) useStore.getState().setListDetail(todo)
      }),
    [],
  )
}
