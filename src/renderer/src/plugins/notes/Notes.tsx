import { Pencil, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { Note, Session, SortItem } from '@/data/types'
import { easeOut } from '@/lib/motion'
import { dayTime } from '@/lib/time'
import { offerUndo } from '@/lib/undo'
import { liveItems, SortCard } from './SortCard'

/** Notes enter and leave the list like cards in the backlog. */
const rowMotion = {
  initial: { opacity: 0, transform: 'scale(0.97)' },
  animate: { opacity: 1, transform: 'scale(1)' },
  exit: { opacity: 0, transform: 'scale(0.97)' },
  transition: { duration: 0.2, ease: easeOut },
} as const

/**
 * 隨手記: jot things down without sorting them, then hand the unsorted ones to
 * the agent. Its proposal shows here until every note is decided.
 */
export function Notes() {
  const { t } = useTranslation('notes')
  const notes = useStore((s) => s.notes)
  const sessions = useStore((s) => s.sessions)
  // Newest first, right under the box they were typed in.
  const unsorted = notes.filter((n) => n.state === 'new').reverse()
  const sorted = notes.filter((n) => n.state === 'sorted').reverse()
  const closed = useStore((s) => s.closedProposals)
  const pending = pendingProposal(sessions, notes, closed)

  return (
    <div className="flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[640px] flex-col gap-5">
        <div>
          <h1 className="text-[30px] font-semibold tracking-tight">{t('page.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('intro')}</p>
        </div>

        <Composer />

        <AnimatePresence initial={false}>
          {pending && (
            <motion.div key={pending.sessionId} {...rowMotion}>
              <SortCard data={pending.data} sessionId={pending.sessionId} index={pending.index} onPage />
            </motion.div>
          )}
        </AnimatePresence>

        <section className="flex flex-col gap-1">
          {unsorted.length > 0 && <h2 className="px-3 pb-1 text-xs text-muted-foreground">{t('unsorted')}</h2>}
          <ul className="flex flex-col">
            <AnimatePresence initial={false} mode="popLayout">
              {unsorted.map((note) => (
                <motion.li key={note.id} layout {...rowMotion}>
                  <NoteRow note={note} />
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
          {unsorted.length === 0 && !pending && <p className="px-3 text-[13px] text-muted-foreground">{t('empty')}</p>}
        </section>

        {unsorted.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3">
            <Button onClick={() => useStore.getState().flushNotes()} className="px-4">
              {t('flush', { count: unsorted.length })}
            </Button>
            <span className="text-xs text-muted-foreground">{t('flushHint')}</span>
          </div>
        )}

        {sorted.length > 0 && (
          <Disclosure label={t('sorted', { count: sorted.length })} className="px-3">
            <ul className="flex flex-col gap-2.5 pt-3">
              {sorted.map((note) => (
                <SortedRow key={note.id} note={note} />
              ))}
            </ul>
          </Disclosure>
        )}
      </div>
    </div>
  )
}

/**
 * The newest proposal to show on the page: until every note in it is decided,
 * and after that until the user puts it away, so each decision can still be
 * taken back.
 */
function pendingProposal(sessions: Session[], notes: Note[], closed: string[]) {
  for (const session of sessions) {
    if (session.trigger !== 'notes') continue
    const index = session.messages.findIndex((m) => m.kind === 'plugin' && m.plugin === 'notes' && m.type === 'sort')
    const message = session.messages[index]
    if (message?.kind !== 'plugin') continue
    const data = message.data as { items: SortItem[] }
    if (liveItems(data.items, notes, session.id).some((i) => !i.decision) || !closed.includes(session.id)) return { sessionId: session.id, index, data: message.data }
  }
  return null
}

/** The box to jot into. Enter adds the note, Shift+Enter starts a new line. */
function Composer() {
  const { t } = useTranslation('notes')
  const [text, setText] = useState('')
  const add = () => {
    const note = text.trim()
    if (!note) return
    useStore.getState().addNote(note, 'page')
    setText('')
  }
  return (
    <div className="rounded-2xl border border-card-border bg-card px-4 pt-3 pb-2 shadow-[0_1px_2px_var(--card-border)] focus-within:ring-3 focus-within:ring-ring/25">
      <textarea
        value={text}
        rows={1}
        autoFocus
        placeholder={t('placeholder')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault()
            add()
          }
        }}
        className="field-sizing-content max-h-60 min-h-12 w-full resize-none bg-transparent text-[15px] leading-relaxed outline-none placeholder:text-muted-foreground"
      />
      <div className="text-right text-[11.5px] text-muted-foreground">{t('keys')}</div>
    </div>
  )
}

/** One unsorted note. Click it to edit; clearing it deletes it, with undo. */
function NoteRow({ note }: { note: Note }) {
  const { t } = useTranslation('notes')
  const today = useStore((s) => s.now.date)
  const [editing, setEditing] = useState(false)
  const { editNote, deleteNote, restoreNote } = useStore.getState()

  const remove = () => {
    deleteNote(note.id)
    offerUndo(t('deleted', { text: note.text.length > 16 ? `${note.text.slice(0, 16)}…` : note.text }), () => restoreNote(note))
  }
  const save = (text: string) => {
    setEditing(false)
    if (!text.trim()) remove()
    else if (text.trim() !== note.text) editNote(note.id, text.trim())
  }

  return (
    <div className="group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-colors duration-150 hover:bg-muted/60">
      <span className="mt-[11px] size-1.5 shrink-0 rounded-full bg-foreground/25" />
      <div className="min-w-0 flex-1">
        {editing ? (
          <textarea
            autoFocus
            defaultValue={note.text}
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            onBlur={(e) => save(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                save(e.currentTarget.value)
              }
            }}
            className="field-sizing-content -mx-1.5 w-full resize-none rounded-md bg-card px-1.5 text-[15px] leading-relaxed outline-none ring-2 ring-ring/30"
          />
        ) : (
          <p onClick={() => setEditing(true)} className="cursor-text text-[15px] leading-relaxed text-pretty whitespace-pre-wrap">
            {note.text}
          </p>
        )}
        <div className="mt-0.5 text-xs text-muted-foreground">
          {dayTime(note.date, note.time, today)}
          {note.source === 'hotkey' && ` · ${t('viaHotkey')}`}
        </div>
      </div>
      {/* Out of the way until the row is hovered or focused. */}
      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t('edit')} onClick={() => setEditing(true)}>
          <Pencil />
        </Button>
        <Button variant="ghost" size="icon-sm" className="text-muted-foreground" aria-label={t('delete')} onClick={remove}>
          <X />
        </Button>
      </div>
    </div>
  )
}

/** A note the agent sorted: what the user wrote and what it became. A todo opens on the calendar. */
function SortedRow({ note }: { note: Note }) {
  const { t } = useTranslation('notes')
  const todo = useStore((s) => (note.became?.kind === 'todo' ? s.todos.find((x) => x.id === note.became?.ref) : undefined))
  const { navigate, setCalendarDetail } = useStore.getState()
  if (!note.became) return null
  return (
    <li className="flex flex-col gap-0.5 text-[13.5px]">
      <span className="text-pretty">{note.text}</span>
      <span className="text-xs text-muted-foreground">
        {todo ? (
          <button
            onClick={() => {
              setCalendarDetail(todo.id)
              navigate('calendar')
            }}
            className="transition-colors duration-150 hover:text-foreground"
          >
            {t('became.todo')} →
          </button>
        ) : (
          t(`became.${note.became.kind}`)
        )}
      </span>
    </li>
  )
}
