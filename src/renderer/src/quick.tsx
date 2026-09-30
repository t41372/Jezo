// The ⌥X window. A press opens it for typing; the answer shows right here, and
// ⌘↵ continues in the main window. ⌥↵ files the text in 隨手記 instead. Holding ⌥X turns it into a dark capsule that
// listens until the key is released. It opens many times a day, so it has no
// open or close animation.

import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource-variable/noto-sans-tc'
import './styles/globals.css'
import { applyLanguage, storedLanguage } from './i18n'

import { Command as CommandPrimitive } from 'cmdk'
import { cn } from 'cn'
import { Check, MessageCircle, Mic } from 'lucide-react'
import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import type { QuickCommand } from '../../shared/bridge'
import type { SessionView } from '../../shared/session'
import { markPlatform, useDarkClass } from './app/theme'
import { stamp } from './data/entities'
import { useMicLevels } from './lib/mic'

const SUGGESTIONS = ['quick.planTomorrow', 'quick.badDay', 'quick.freeEvenings'] as const

type State =
  | { mode: 'type' }
  /** Asked; `session` is the conversation once the agent has one. */
  | { mode: 'answer'; question: string; session: string | null }
  | { mode: 'voice'; context: string | null; startedAt: number }
  /** Just filed in 隨手記: says so for a moment, then closes. */
  | { mode: 'noted' }

function Quick() {
  useDarkClass()
  const [state, setState] = useState<State>({ mode: 'type' })
  const transcript = useRef('')
  const setTranscript = useCallback((text: string) => {
    transcript.current = text
  }, [])

  const ask = (question: string) => {
    setState({ mode: 'answer', question, session: null })
    window.jezo.agent.send(null, question, 'hotkey').then((session) =>
      setState((s) => (s.mode === 'answer' && s.question === question ? { ...s, session } : s)),
    )
  }

  useEffect(
    () =>
      window.jezo.quick.onCommand((command: QuickCommand) => {
        // The main window may have changed the language since this window last showed.
        applyLanguage(storedLanguage())
        if (command.kind === 'type') setState({ mode: 'type' })
        if (command.kind === 'voice-start') {
          transcript.current = ''
          setState({ mode: 'voice', context: command.context, startedAt: Date.now() })
        }
        if (command.kind === 'voice-end') {
          const said = transcript.current.trim()
          if (said) ask(said)
          else window.jezo.quick.hide()
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

  // Filed at once; the confirmation stays long enough to read, short enough not to be in the way.
  const note = (text: string) => {
    setState({ mode: 'noted' })
    window.jezo.workspace.create('note', { created: stamp(), source: 'hotkey', state: 'new' }, `${text}\n`).catch(console.error)
    window.setTimeout(() => window.jezo.quick.hide(), 600)
  }

  if (state.mode === 'voice') {
    return <Voice context={state.context} startedAt={state.startedAt} onTranscript={setTranscript} />
  }
  if (state.mode === 'noted') return <Noted />
  return <Typing state={state} onAsk={ask} onNote={note} onReset={() => setState({ mode: 'type' })} />
}

function Typing({
  state,
  onAsk,
  onNote,
  onReset,
}: {
  state: Extract<State, { mode: 'type' | 'answer' }>
  onAsk: (q: string) => void
  onNote: (text: string) => void
  onReset: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setText(state.mode === 'answer' ? state.question : '')
    input.current?.focus()
  }, [state.mode === 'answer' ? state.question : null])

  const question = text.trim()
  const answer = useAnswer(state.mode === 'answer' ? state.session : null)
  // The conversation goes on in the main window: the one already started, or a new one.
  const continueInMain = () => {
    if (state.mode === 'answer' && state.session) window.jezo.quick.continue(state.session)
    else if (question) window.jezo.agent.send(null, question, 'hotkey').then((id) => window.jezo.quick.continue(id))
  }

  return (
    <Command
      loop
      shouldFilter={state.mode === 'type'}
      className="h-screen rounded-none! bg-popover/70 p-0"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          continueInMain()
        }
        if (e.key === 'Enter' && e.altKey && question && !e.nativeEvent.isComposing) {
          e.preventDefault()
          onNote(question)
        }
      }}
    >
      <div className="drag-region flex h-15 shrink-0 items-center gap-3 border-b px-5">
        <MessageCircle className="size-5 text-muted-foreground" strokeWidth={1.8} />
        <CommandPrimitive.Input
          ref={input}
          autoFocus
          value={text}
          onValueChange={(v) => {
            setText(v)
            if (state.mode === 'answer') onReset()
          }}
          // Enter while an input method is composing picks a candidate; keep it from reaching the list.
          onKeyDown={(e) => e.nativeEvent.isComposing && e.stopPropagation()}
          placeholder={t('quick.placeholder')}
          className="flex-1 bg-transparent text-lg outline-none placeholder:text-muted-foreground"
        />
        <Kbd className="bg-muted/60">↵</Kbd>
      </div>

      {state.mode === 'answer' ? (
        <div className="flex flex-1 flex-col gap-3 p-3">
          <div className="rounded-xl border border-card-border bg-card px-4 py-3.5 text-sm leading-relaxed text-pretty" data-selectable>
            {answer?.error ? (
              <span className="text-destructive">{answer.error === 'no-model' ? t('quick.noModel') : answer.error}</span>
            ) : answer?.text ? (
              <span className="whitespace-pre-wrap">{answer.text.trim()}</span>
            ) : (
              <span className="text-muted-foreground">{t('quick.thinking')}</span>
            )}
          </div>
          <div className="flex-1" />
          <Hints onContinue={continueInMain} />
        </div>
      ) : (
        <CommandList className="max-h-none flex-1 p-2">
          {question && (
            <CommandGroup forceMount>
              <CommandItem forceMount value={`ask:${question}`} onSelect={() => onAsk(question)} className="rounded-lg px-3 py-2.5">
                {t('quick.ask', { text: question })}
              </CommandItem>
              <CommandItem forceMount value={`note:${question}`} onSelect={() => onNote(question)} className="rounded-lg px-3 py-2.5">
                <span className="flex-1 truncate">{t('quick.note', { text: question })}</span>
                <Kbd className="bg-muted/60">⌥↵</Kbd>
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading={t('quick.common')}>
            {SUGGESTIONS.map((key) => (
              <CommandItem key={key} value={t(key)} onSelect={() => onAsk(t(key))} className="rounded-lg px-3 py-2.5">
                {t(key)}
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      )}
    </Command>
  )
}

/** What the agent has said so far in a conversation, following it as it writes. */
function useAnswer(session: string | null) {
  const [view, setView] = useState<SessionView | null>(null)
  useEffect(() => {
    setView(null)
    if (!session) return
    return window.jezo.agent.onChange((v) => v.id === session && setView(v))
  }, [session])
  if (!view) return null
  const agent = view.messages.filter((m) => m.kind === 'agent')
  const error = view.messages.findLast((m) => m.kind === 'error')
  return {
    text: agent.map((m) => m.text).join('\n\n'),
    error: error?.kind === 'error' ? (error.code ?? error.text ?? '') : null,
  }
}

function Noted() {
  const { t } = useTranslation()
  return (
    <div className="flex h-screen items-center justify-center gap-2 bg-popover/70 text-[15px]">
      <Check className="size-4.5 text-ok" strokeWidth={2.5} />
      {t('quick.noted')}
    </div>
  )
}

function Hints({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Kbd>esc</Kbd>
        {t('quick.close')}
      </span>
      <span className="flex-1" />
      <button onClick={onContinue} className="flex items-center gap-1.5 hover:text-foreground">
        <Kbd>⌘↵</Kbd>
        {t('quick.continue')}
      </button>
    </div>
  )
}

/** Levels shown in the waveform, newest on the right. */
const BARS = 28

function Voice({ context, startedAt, onTranscript }: { context: string | null; startedAt: number; onTranscript: (text: string) => void }) {
  const { t } = useTranslation()
  const mic = useMicLevels(BARS)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [])

  // Mock transcription: the sentence appears as if being recognized. The last
  // few characters are still tentative, so they're shown faded.
  const sentence = t('quick.mockTranscript')
  const elapsed = now - startedAt
  const heard = sentence.slice(0, Math.max(0, Math.floor((elapsed - 300) / 90)))
  const settled = heard.slice(0, Math.max(0, heard.length - 6))
  useEffect(() => {
    onTranscript(heard)
  }, [heard, onTranscript])

  const seconds = Math.floor(elapsed / 1000)
  return (
    <div className="dark flex h-screen flex-col gap-3 bg-[rgb(28_24_48/0.55)] px-4.5 py-4 text-white">
      <div className="flex items-center gap-3.5">
        <span className="relative flex size-8.5 shrink-0 items-center justify-center rounded-full bg-[oklch(0.66_0.2_15)]">
          <span className="absolute inset-0 rounded-full bg-[oklch(0.66_0.2_15/0.35)] motion-safe:animate-ping" />
          <Mic className="relative size-4" strokeWidth={2.2} />
        </span>
        <div className="flex h-7 items-center gap-[3px]">
          {mic.levels.map((level, i) => (
            <span key={i} className="w-[3px] rounded-full bg-white" style={{ height: 4 + level * 24, opacity: 0.35 + level * 0.65 }} />
          ))}
        </div>
        <span className="flex-1" />
        <span className="font-mono text-xs text-white/65 tabular-nums">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      </div>
      <p className="min-h-[1.55em] text-[17px] leading-[1.55]">
        {mic.error ? (
          <span className="text-sm text-white/80">{t('quick.micDenied')}</span>
        ) : (
          <>
            {settled}
            <span className="text-white/50">{heard.slice(settled.length)}</span>
          </>
        )}
      </p>
      <div className="flex items-center gap-2 text-xs text-white/65">
        {context && (
          <>
            <span className="rounded-md bg-white/12 px-2 py-0.5 text-white">{t('quick.context', { page: context })}</span>
            <span>{t('quick.contextNote')}</span>
          </>
        )}
        <span className="flex-1" />
        <span className={cn(mic.error && 'hidden')}>{t('quick.release')}</span>
      </div>
    </div>
  )
}

markPlatform()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Quick />
  </StrictMode>,
)
