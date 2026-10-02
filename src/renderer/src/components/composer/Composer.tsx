import { cn } from 'cn'
import { ArrowUp, CornerUpLeft, Mic, Plus, Square } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { traditional } from '@/lib/chinese'
import { useDictation } from '@/lib/mic'
import type { SlashCommand } from '../../../../shared/session'
import { ModelChip } from './ModelChip'
import { type SlashItem, SlashMenu, useSlashMenu } from './SlashMenu'

/**
 * The box for talking to Jezo, in the chat and in the ⌥X window: what you
 * type, the model and how hard it thinks, the microphone, and send (stop while
 * the agent works). Enter sends or queues; Shift+Enter starts a new line.
 * Typing "/" first opens the command menu.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  onSteer,
  running,
  placeholder,
  autoFocus,
  attach,
  onKeyDown,
  commands,
  onNew,
  menuSide = 'top',
  className,
  textareaClassName,
  session,
}: {
  value: string
  onChange: (value: string) => void
  onSubmit: (text: string) => void
  onStop?: () => void
  onSteer?: (text: string) => void
  running?: boolean
  placeholder: string
  autoFocus?: boolean
  /** Shows the attachment button. */
  attach?: boolean
  /** Other keys the owner handles, like ⌥↵ in the ⌥X window. Call preventDefault to take one. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  /** What the "/" menu offers besides Jezo's own actions. */
  commands?: () => Promise<SlashCommand[]>
  /** Starts a new conversation; offered in the menu as /new. */
  onNew?: () => void
  /** Where the menu opens: above the box, or below it in the ⌥X window, which grows to fit. */
  menuSide?: 'top' | 'bottom'
  className?: string
  textareaClassName?: string
  /** The conversation the box writes into, so dictation can expect what was said there. */
  session?: string | null
}) {
  const { t } = useTranslation()
  const input = useRef<HTMLTextAreaElement>(null)
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [modelMenu, setModelMenu] = useState(0)

  const actions: SlashItem[] = [
    ...(onNew ? [{ name: 'new', title: t('composer.commands.new'), source: 'app' as const, run: onNew }] : []),
    { name: 'model', title: t('composer.commands.model'), source: 'app', run: () => setModelMenu((n) => n + 1) },
  ]
  const pick = (item: SlashItem) => {
    if (item.run) {
      onChange('')
      item.run()
    } else onChange(item.insert ?? `/${item.name} `)
    input.current?.focus()
  }
  const menu = useSlashMenu({ value, load: commands, suggest: commands && window.jezo.agent.argumentSuggestions, actions, onPick: pick })

  useEffect(() => {
    if (autoFocus) input.current?.focus()
  }, [autoFocus])

  const submit = () => {
    const text = value.trim()
    if (text) onSubmit(text)
  }

  // What was said goes into the box, after what was typed; the user sends it.
  const stopListening = async () => {
    setListening(false)
    const said = traditional((await window.jezo.speech.end()).trim()) || heard
    setHeard('')
    if (said) onChange(value ? `${value.trimEnd()} ${said}` : said)
    input.current?.focus()
  }
  // A window put away, like ⌥X dismissed, stops listening and keeps what was heard: the microphone isn't left on out of sight.
  const stopRef = useRef(stopListening)
  stopRef.current = stopListening
  useEffect(() => {
    if (!listening) return
    const onHidden = () => document.hidden && void stopRef.current()
    document.addEventListener('visibilitychange', onHidden)
    return () => document.removeEventListener('visibilitychange', onHidden)
  }, [listening])

  return (
    <div className="relative">
      <div className={cn('flex items-end gap-1.5 rounded-[26px] border border-card-border bg-card py-2 pr-2 pl-2.5 shadow-[0_4px_16px_rgb(10_14_40/0.06)]', className)}>
        {attach && (
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full text-muted-foreground" aria-label={t('composer.attach')}>
            <Plus className="size-5" />
          </Button>
        )}
        <div className="relative flex min-w-0 flex-1 self-center">
          <textarea
            ref={input}
            rows={1}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (menu.onKey(e)) return
              onKeyDown?.(e)
              if (e.defaultPrevented) return
              if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing && running && onSteer && !listening) {
                e.preventDefault()
                if (value.trim()) onSteer(value.trim())
                return
              }
              // Enter while an input method is composing picks a candidate; it must not send.
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (listening) void stopListening()
                else submit()
              }
            }}
            placeholder={listening ? '' : placeholder}
            className={cn(
              'max-h-40 w-full resize-none bg-transparent py-1.5 pl-1.5 text-[14.5px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground',
              listening && heard && 'text-transparent',
              textareaClassName,
            )}
          />
          {/* While listening, what's heard shows in place of the text, faded, until it's inserted. */}
          {listening && (
            <div aria-live="polite" className="pointer-events-none absolute inset-0 py-1.5 pl-1.5 text-[14.5px] leading-relaxed">
              {value && <span>{value.trimEnd()} </span>}
              <span className="text-muted-foreground">{heard || t('composer.listening')}</span>
            </div>
          )}
        </div>
        <ModelChip openModels={modelMenu} />
        {listening ? (
          <Listening session={session} onHeard={setHeard} onStop={() => void stopListening()} onUnavailable={() => setListening(false)} />
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 rounded-full text-muted-foreground"
            aria-label={t('composer.voice')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setListening(true)}
          >
            <Mic className="size-[18px]" />
          </Button>
        )}
        {running && onSteer && (
          <Button variant="ghost" size="icon" className="size-9 shrink-0 rounded-full text-muted-foreground" aria-label={t('composer.steer')} disabled={!value.trim()} onClick={() => onSteer(value.trim())}>
            <CornerUpLeft className="size-[18px]" />
          </Button>
        )}
        {(!running || value.trim()) && (
          <Button size="icon" className="size-9 shrink-0 rounded-full" aria-label={t(running ? 'composer.queue' : 'composer.send')} disabled={!value.trim()} onClick={submit}>
            <ArrowUp className="size-[18px]" />
          </Button>
        )}
        {running && (
          <Button size="icon" className="size-9 shrink-0 rounded-full" aria-label={t('composer.stop')} onClick={onStop}>
            <Square className="size-3.5 fill-current" />
          </Button>
        )}
      </div>
      {menu.open && <SlashMenu items={menu.items} active={menu.active} onHover={menu.setActive} onPick={menu.pick} side={menuSide} />}
    </div>
  )
}

/** The microphone while it's on: its level as three bars, and a click to stop. */
function Listening({ session, onHeard, onStop, onUnavailable }: { session?: string | null; onHeard: (text: string) => void; onStop: () => void; onUnavailable: () => void }) {
  const { t } = useTranslation()
  const mic = useDictation(3, session)
  useEffect(() => window.jezo.speech.onText((text) => onHeard(traditional(text))), [onHeard])
  // Another window took the microphone (⌥X held while dictating here): stop, keeping what was heard.
  useEffect(() => window.jezo.speech.onReplaced(onStop), [onStop])
  useEffect(() => {
    if (mic.ready && !mic.error) return
    void window.jezo.speech.end()
    onUnavailable()
    toast(mic.error ? t('composer.micDenied') : t('composer.speechMissing'))
  }, [mic.ready, mic.error])
  return (
    <Button
      size="icon"
      className="size-9 shrink-0 gap-[3px] rounded-full bg-[oklch(0.62_0.2_25)] text-white hover:bg-[oklch(0.58_0.2_25)]"
      aria-label={t('composer.stopListening')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onStop}
    >
      {mic.levels.map((level, i) => (
        <span key={i} className="w-[3px] rounded-full bg-current transition-[height] duration-75" style={{ height: 5 + level * 14 }} />
      ))}
    </Button>
  )
}
