// The ⌥X window: the chat's message box, anywhere. A press opens it for
// typing; the answer shows above the box and the conversation can go on here,
// or in the main window with ⌘↵. ⌥↵ files the text in 隨手記 instead. Holding
// ⌥X listens until the key is released, then sends what was said. It opens
// many times a day, so it has no open or close animation.

import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/noto-sans-tc'
import './styles/globals.css'
import { applyLanguage, storedLanguage } from './i18n'

import { cn } from 'cn'
import { Check, Mic } from 'lucide-react'
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Composer } from '@/components/composer/Composer'
import { PendingMessages } from '@/components/composer/PendingMessages'
import { Button } from '@/components/ui/button'
import { Toaster } from '@/components/ui/sonner'
import { ExtensionQuestionCard } from '@/components/ExtensionQuestionCard'
import { Kbd } from '@/components/ui/kbd'
import type { QuickCommand } from '../../shared/bridge'
import type { SessionView } from '../../shared/session'
import { markPlatform, useDarkClass } from './app/theme'
import { stamp } from '../../shared/time'
import { traditional } from './lib/chinese'
import { useDictation } from './lib/mic'

const SUGGESTIONS = ['quick.planTomorrow', 'quick.badDay', 'quick.freeEvenings'] as const

type Mode =
  | { kind: 'type' }
  /** ⌥X is held. `context` is the page the main window shows. */
  | { kind: 'voice'; context: string | null }
  /** Just filed in 隨手記: says so for a moment, then closes. */
  | { kind: 'noted' }

function Quick() {
  useDarkClass()
  useEffect(() => window.jezo.agent.onNotice(({ message, type }) => toast[type](message)), [])
  const { t } = useTranslation()
  const [mode, setMode] = useState<Mode>({ kind: 'type' })
  const [text, setText] = useState('')
  // The conversation this window is in, once something was asked.
  const [session, setSession] = useState<string | null>(null)
  const [asked, setAsked] = useState<string | null>(null)
  const view = useSession(session)
  const heard = useRef('')
  const root = useFit()

  useEffect(
    () =>
      window.jezo.speech.onText((said) => {
        heard.current = said
      }),
    [],
  )

  // The first question starts a conversation; the ones after it go on in it.
  const sessionRef = useRef<string | null>(null)
  sessionRef.current = session
  const ask = (question: string, behavior?: 'followUp' | 'steer') => {
    setText('')
    setAsked(question)
    const current = sessionRef.current
    if (current) void window.jezo.agent.send(current, question, 'hotkey', behavior)
    else window.jezo.agent.send(null, question, 'hotkey').then(setSession)
  }

  // Filed at once; the confirmation stays long enough to read, short enough not to be in the way.
  // It closes once saved; if it couldn't be, the words come back to the box, where they're the only copy.
  const note = (content: string) => {
    setMode({ kind: 'noted' })
    setText('')
    const saved = window.jezo.time.zone().then((zone) => window.jezo.workspace.create('note', { created: stamp(zone), source: 'hotkey', state: 'new' }, `${content}\n`))
    Promise.all([saved, new Promise((done) => window.setTimeout(done, 600))]).then(
      () => window.jezo.quick.hide(),
      (error) => {
        console.error(error)
        setText(content)
        setMode({ kind: 'type' })
        toast.error(t('quick.noteFailed'))
      },
    )
  }

  // The conversation goes on in the main window: the one started here, or a new one, with what's typed sent in it.
  const continueInMain = () => {
    const question = text.trim()
    if (session) {
      if (question) void window.jezo.agent.send(session, question, 'hotkey')
      return window.jezo.quick.continue(session)
    }
    if (question) window.jezo.agent.send(null, question, 'hotkey').then((id) => window.jezo.quick.continue(id))
  }

  useEffect(
    () =>
      window.jezo.quick.onCommand((command: QuickCommand) => {
        // The main window may have changed the language since this window last showed.
        applyLanguage(storedLanguage())
        // Each press or hold starts fresh; the last conversation is in the main window's list.
        if (command.kind === 'type' || command.kind === 'voice-start') {
          heard.current = ''
          setSession(null)
          setAsked(null)
          setText('')
          setMode(command.kind === 'type' ? { kind: 'type' } : { kind: 'voice', context: command.context })
        }
        if (command.kind === 'voice-end') {
          setMode({ kind: 'type' })
          // The engine finishes the last words after the audio ends, which takes a moment.
          const partial = traditional(heard.current.trim())
          setAsked(partial || null)
          window.jezo.speech.end().then((final) => {
            const said = traditional(final.trim()) || partial
            if (said) ask(said)
            else window.jezo.quick.hide()
          })
        }
      }),
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.jezo.quick.hide()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div ref={root} className="flex flex-col gap-2.5 p-3">
      {mode.kind === 'noted' ? (
        <Noted />
      ) : mode.kind === 'voice' ? (
        <Voice context={mode.context} session={session} />
      ) : (
        <>
          {asked && <Answer question={asked} view={view} onPick={ask} />}
          {view?.pending && <PendingMessages pending={view.pending} onTakeBack={async () => {
            if (!session) return
            const cleared = await window.jezo.agent.pi.clearQueue(session)
            setText([text, ...cleared.steering, ...cleared.followUp].filter(Boolean).join('\n\n'))
          }} />}
          <Composer
            value={text}
            onChange={setText}
            onSubmit={ask}
            onSteer={(question) => ask(question, 'steer')}
            running={view?.running}
            onStop={() => session && void window.jezo.agent.abort(session)}
            placeholder={session ? t('quick.followUp') : t('quick.placeholder')}
            autoFocus
            className="shadow-none"
            textareaClassName="text-[15.5px]"
            commands={window.jezo.agent.commands}
            session={session}
            menuSide="bottom"
            onKeyDown={(e) => {
              const question = text.trim()
              if (e.key === 'Enter' && !e.shiftKey && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                continueInMain()
              } else if (e.key === 'Enter' && e.altKey && question && !e.nativeEvent.isComposing) {
                e.preventDefault()
                note(question)
              }
            }}
          />
          {!asked && !text && <Suggestions onPick={ask} />}
          <Hints canContinue={Boolean(session || text.trim())} onContinue={continueInMain} />
        </>
      )}
      <Toaster position="bottom-center" />
    </div>
  )
}

/** Follows a conversation as the agent writes it. */
function useSession(id: string | null) {
  const [view, setView] = useState<SessionView | null>(null)
  useEffect(() => {
    setView(null)
    if (!id) return
    window.jezo.agent.list().then((all) => setView((v) => v ?? all.find((s) => s.id === id) ?? null))
    return window.jezo.agent.onChange((v) => {
      if (v.id === id) setView(v)
    })
  }, [id])
  return view
}

/** Sizes the window to what it shows, so it grows as the answer does. */
function useFit() {
  const root = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new ResizeObserver(() => window.jezo.quick.resize(Math.ceil(element.getBoundingClientRect().height)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return root
}

/** The question and what the agent says back: its words, its questions, and why it couldn't answer. */
function Answer({ question, view, onPick }: { question: string; view: SessionView | null; onPick: (option: string) => void }) {
  const { t } = useTranslation()
  const messages = view?.messages ?? []
  const shown = messages.filter((m) => m.kind === 'user' || m.kind === 'agent' || m.kind === 'error' || m.kind === 'extension-question' || (m.kind === 'choices' && !m.picked))
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight })
  }, [messages])
  const waiting = !view || (view.running && (view.thinking !== undefined || !messages.some((m) => m.kind === 'agent' && m.streaming)))
  return (
    <div ref={scroller} className="flex max-h-[360px] flex-col gap-2.5 overflow-auto px-1 pt-1">
      {(shown.length ? shown : [{ kind: 'user' as const, text: question }]).map((m, i) =>
        m.kind === 'user' ? (
          <div key={m.id ?? 'pending-question'} className="max-w-[85%] self-end rounded-[18px] bg-primary px-3.5 py-2 text-[14px] leading-relaxed text-primary-foreground" data-selectable>
            {m.text}
          </div>
        ) : m.kind === 'agent' ? (
          <div key={m.id ?? 'pending-question'} className="text-[14.5px] leading-[1.7] text-pretty whitespace-pre-wrap" data-selectable>
            {m.text.trim()}
          </div>
        ) : m.kind === 'error' ? (
          <div key={m.id ?? 'pending-question'} className="text-[13.5px] text-destructive">
            {m.code === 'no-model' ? t('quick.noModel') : m.text}
          </div>
        ) : m.kind === 'choices' ? (
          <div key={m.id ?? 'pending-question'} className="flex flex-wrap gap-1.5">
            {m.options.map((o) => (
              <Button key={o} variant="outline" size="sm" className="rounded-full font-normal" onClick={() => onPick(o)}>
                {o}
              </Button>
            ))}
          </div>
        ) : m.kind === 'extension-question' ? <ExtensionQuestionCard key={i} session={view!.id} question={m.question} /> : null,
      )}
      {waiting && (
        <div className="flex min-w-0 items-baseline gap-2 text-[13px] text-muted-foreground">
          <span className="shrink-0 motion-safe:animate-pulse">{t('quick.thinking')}</span>
          {view?.thinking && <span className="truncate text-muted-foreground/70" data-thinking-line>{view.thinking}</span>}
        </div>
      )}
    </div>
  )
}

function Suggestions({ onPick }: { onPick: (text: string) => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5 px-1">
      {SUGGESTIONS.map((key) => (
        <Button key={key} variant="outline" size="sm" className="rounded-full font-normal text-muted-foreground" onClick={() => onPick(t(key))}>
          {t(key)}
        </Button>
      ))}
    </div>
  )
}

function Hints({ canContinue, onContinue }: { canContinue: boolean; onContinue: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 px-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Kbd>↵</Kbd>
        {t('quick.hintAsk')}
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd>⌥↵</Kbd>
        {t('quick.hintNote')}
      </span>
      <span className="flex-1" />
      <button
        onClick={onContinue}
        disabled={!canContinue}
        className="flex items-center gap-1.5 transition-colors duration-150 enabled:hover:text-foreground disabled:opacity-50"
      >
        <Kbd>⌘↵</Kbd>
        {t('quick.continue')}
      </button>
      <span className="flex items-center gap-1.5">
        <Kbd>esc</Kbd>
        {t('quick.close')}
      </span>
    </div>
  )
}

function Noted() {
  const { t } = useTranslation()
  return (
    <div className="flex h-14 items-center justify-center gap-2 text-[15px]">
      <Check className="size-4.5 text-ok" strokeWidth={2.5} />
      {t('quick.noted')}
    </div>
  )
}

/**
 * While ⌥X is held: the same box, showing what's heard as it's heard, with
 * the microphone's level, and what comes along from the main window.
 */
function Voice({ context, session }: { context: string | null; session: string | null }) {
  const { t } = useTranslation()
  const mic = useDictation(24, session)
  const [heard, setHeard] = useState('')
  useEffect(() => window.jezo.speech.onText((said) => setHeard(traditional(said))), [])
  return (
    <>
      <div className="flex min-h-[54px] items-center gap-3 rounded-[26px] border border-card-border bg-card py-2 pr-2 pl-4">
        <p className={cn('min-w-0 flex-1 text-[15.5px] leading-relaxed', !heard && 'text-muted-foreground')}>
          {mic.error ? t('quick.micDenied') : !mic.ready ? t('quick.speechMissing') : heard || t('quick.listening')}
        </p>
        <div className="flex h-7 items-center gap-[3px]" aria-hidden>
          {mic.levels.map((level, i) => (
            <span key={i} className="w-[3px] rounded-full bg-foreground/70" style={{ height: 3 + level * 22, opacity: 0.3 + level * 0.7 }} />
          ))}
        </div>
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[oklch(0.62_0.2_25)] text-white">
          <Mic className="size-4" strokeWidth={2.2} />
        </span>
      </div>
      <div className="flex items-center gap-2 px-1.5 text-xs text-muted-foreground">
        {context && (
          <>
            <span className="rounded-md bg-muted px-2 py-0.5 text-foreground">{t('quick.context', { page: context })}</span>
            <span>{t('quick.contextNote')}</span>
          </>
        )}
        <span className="flex-1" />
        <span>{t('quick.release')}</span>
      </div>
    </>
  )
}

markPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Quick />
  </StrictMode>,
)
