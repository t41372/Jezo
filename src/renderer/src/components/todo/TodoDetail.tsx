import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check, Paperclip, X } from 'lucide-react'
import { useRef } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/Disclosure'
import { MarkdownEditor } from '@/components/editor/MarkdownEditor'
import { goalById, useStore } from '@/data/store'
import type { CalendarEvent, Todo } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'
import { useTranslation } from 'react-i18next'
import { easeDrawer, easeOut } from '@/lib/motion'
import { addDays, clock, longDate, monthDay, weekday } from '@/lib/time'
import { offerUndo } from '@/lib/undo'
import { attachmentsIn, fileUrl, isImage, linkedPath } from '@/lib/files'
import { endsPastDue, whenLabel } from './format'
import { Related } from './Related'
import { CueField, DueField, EstimateField, GoalField, SlotField, TitleField, ZoneField } from './TodoFields'

/** Everything about one todo, and what you can do with it. */
/** `zone` is the zone the calendar shows, when the details open from it: times are picked in it. */
export function TodoDetail({ todo, onClose, zone }: { todo: Todo; onClose: () => void; zone?: string }) {
  const { t } = useTranslation()
  const goal = useStore((s) => goalById(s.goals, todo.goalId))
  const { accept, discard, confirmSlot, moveTodo, setDone, setDropped, deleteTodo, openSession, restoreTodo, toggleSubtask, setNotes } = useStore.getState()
  const drop = () => {
    setDropped(todo.id, true)
    offerUndo(t('todo.dropped', { title: todo.title }), () => restoreTodo(todo))
  }
  const remove = async () => {
    const change = await deleteTodo(todo.id)
    if (!change) return
    offerUndo(t('todo.deleted', { title: todo.title }), () => void window.jezo.history.undo(change))
  }
  const discardDraft = () => {
    discard(todo.id)
    offerUndo(t('undo.discarded', { title: todo.title }), () => restoreTodo(todo))
  }
  const unschedule = () => {
    moveTodo(todo.id, null)
    offerUndo(t('undo.unscheduled', { title: todo.title }), () => restoreTodo(todo))
  }
  const draftTodo = todo.state === 'draft'
  const proposedSlot = !draftTodo && !!todo.slot?.proposed

  return (
    <div className="flex h-full flex-col gap-4" style={goalStyle(goal?.hue)}>
      <div className="flex items-center gap-2">
        <GoalField todo={todo} />
        <span className="flex-1" />
        <CloseButton onClick={onClose} />
      </div>

      <TitleField todo={todo} />

      {/* Each value is its own control: click to change it. */}
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-0.5 text-[13.5px]">
        <dt className="text-muted-foreground">{t('todo.when')}</dt>
        <dd>{todo.fromCalendar ? whenLabel(todo) : <CueField todo={todo} />}</dd>
        <dt className="text-muted-foreground">{t('todo.slot')}</dt>
        <dd>
          <SlotField todo={todo} zone={zone} />
          {endsPastDue(todo) && <div className="px-0.5 pb-1 text-[12px] text-warn" data-past-due>{t('todo.pastDue')}</div>}
        </dd>
        {todo.slot && !todo.fromCalendar && (
          <>
            <dt className="text-muted-foreground">{t('todo.meaning.zone')}</dt>
            <dd><ZoneField todo={todo} /></dd>
          </>
        )}
        {!todo.fromCalendar && (
          <>
            <dt className="text-muted-foreground">{t('todo.due')}</dt>
            <dd><DueField todo={todo} /></dd>
          </>
        )}
        <dt className="text-muted-foreground">{t('todo.estimate')}</dt>
        <dd><EstimateField todo={todo} /></dd>
      </dl>

      {(draftTodo || proposedSlot) && (
        <div className="flex flex-col gap-2.5 rounded-[10px] border-[1.5px] border-dashed border-draft bg-draft-bg p-3">
          {todo.why && <p className="text-[13px] leading-relaxed text-pretty">{todo.why}</p>}
          <div className="flex gap-1.5">
            <Button size="sm" onClick={() => (draftTodo ? accept([todo.id]) : confirmSlot(todo.id))}>
              {draftTodo ? t('todo.accept') : t('todo.acceptTime')}
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={draftTodo ? discardDraft : unschedule}>
              {t('todo.reject')}
            </Button>
          </div>
        </div>
      )}

      {todo.subtasks && (
        <ul className="flex flex-col gap-1 text-[13.5px]" aria-label={t('todo.subtasks')}>
          {todo.subtasks.map((sub, i) => (
            <li key={i}>
              <label className="flex cursor-pointer items-center gap-2.5 py-0.5">
                <CheckboxPrimitive.Root
                  checked={sub.done}
                  onCheckedChange={() => toggleSubtask(todo.id, i)}
                  className="flex size-3.5 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border text-white transition-[background-color,border-color] duration-150 ease-out data-checked:border-goal data-checked:bg-goal"
                >
                  <CheckboxPrimitive.Indicator>
                    <Check className="size-2.5" strokeWidth={3.5} />
                  </CheckboxPrimitive.Indicator>
                </CheckboxPrimitive.Root>
                <span className={sub.done ? 'text-muted-foreground line-through' : undefined}>{sub.text}</span>
              </label>
            </li>
          ))}
        </ul>
      )}

      <Notes todo={todo} onSave={(notes) => setNotes(todo.id, notes)} />

      {!draftTodo && !proposedSlot && todo.why && <Why text={todo.why} />}

      <Related id={todo.id} links={todo.links} exclude={todo.goalId ? [todo.goalId] : []} />

      <div className="flex-1" />

      <div className="flex flex-wrap gap-1.5">
        {!draftTodo && todo.state !== 'dropped' && (
          <Button size="sm" onClick={() => setDone(todo.id, todo.state !== 'done')}>
            {todo.state === 'done' ? t('todo.markUndone') : t('todo.markDone')}
          </Button>
        )}
        {todo.state === 'open' && (
          <Button size="sm" variant="outline" onClick={drop}>
            {t('todo.drop')}
          </Button>
        )}
        {todo.state === 'dropped' && (
          <Button size="sm" onClick={() => setDropped(todo.id, false)}>
            {t('todo.undrop')}
          </Button>
        )}
        {todo.slot && !todo.fromCalendar && (
          <Button size="sm" variant="outline" onClick={unschedule}>
            {t('todo.unschedule')}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => openSession(null, t('todo.askPrefill', { title: todo.title }))}>
          {t('todo.ask')}
        </Button>
        {!draftTodo && (
          <Button size="sm" variant="ghost" className="ml-auto text-muted-foreground hover:text-destructive" onClick={() => void remove()}>
            {t('todo.delete')}
          </Button>
        )}
      </div>
    </div>
  )
}

/** A calendar event. It belongs to the calendar it came from, so Jezo doesn't edit it. */
export function EventDetail({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { t } = useTranslation()
  const openSession = useStore((s) => s.openSession)
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center">
        <span className="rounded-md bg-muted px-2.5 py-0.5 text-[11.5px] font-medium text-muted-foreground">{event.source}</span>
        <span className="flex-1" />
        <CloseButton onClick={onClose} />
      </div>
      <h2 className="text-[19px] leading-snug font-semibold" data-selectable>
        {event.title}
      </h2>
      <div className="flex flex-col gap-1">
        <p className="text-[13.5px]">
          {event.allDay
            ? t('event.allDay', { days: event.hours > 24 ? `${monthDay(event.date)} – ${monthDay(addDays(event.date, event.hours / 24 - 1))}` : longDate(event.date) })
            : `${weekday(event.date)} ${clock(event.start)} – ${clock(event.start + event.hours)}`}
        </p>
        {event.location && (
          <p className="text-[13.5px] text-muted-foreground" data-selectable>
            {event.location}
          </p>
        )}
        {event.url && (
          <a href={event.url} target="_blank" rel="noreferrer" className="truncate text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground">
            {event.url}
          </a>
        )}
      </div>
      {event.notes && (
        // Written by whoever made the event, and often long (a meeting link, an agenda), so folded away.
        <Disclosure label={t('event.notes')} className="border-t pt-3">
          <p className="pt-2.5 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground" data-selectable>
            {event.notes}
          </p>
        </Disclosure>
      )}
      <p className="text-[13px] leading-relaxed text-muted-foreground">{t('event.readOnly', { source: event.source })}</p>
      <Button variant="outline" onClick={() => openSession(null, t('event.whatNextPrefill', { title: event.title }))}>
        {t('event.whatNext')}
      </Button>
    </div>
  )
}

/**
 * A todo's notes, and the files in them. Images show in the text; other files
 * (a PDF, a spreadsheet) are links, listed below with a button that opens them.
 */
function Notes({ todo, onSave }: { todo: Todo; onSave: (notes: string) => void }) {
  const { t } = useTranslation()
  const picker = useRef<HTMLInputElement>(null)
  const from = todo.path ?? `todos/items/${todo.id}.md`
  const upload = async (file: File) => window.jezo.workspace.attach(todo.id, file.name, new Uint8Array(await file.arrayBuffer()))
  const display = (url: string) => {
    const path = linkedPath(from, url)
    return path ? fileUrl(path) : url
  }
  const files = attachmentsIn(todo.notes, from).filter((f) => !isImage(f.path))
  const add = async (list: FileList | null) => {
    const lines: string[] = []
    for (const file of list ?? []) lines.push(`${isImage(file.name) ? '!' : ''}[${file.name.replace(/[[\]]/g, '')}](${encodeURI(await upload(file))})`)
    if (lines.length) onSave(`${todo.notes.trimEnd()}${todo.notes.trim() ? '\n\n' : ''}${lines.join('\n\n')}\n`)
  }
  return (
    <section className="flex flex-col gap-2">
      <div className="-mx-1">
        <MarkdownEditor value={todo.notes} onSave={onSave} upload={upload} display={display} placeholder={t('editor.notesPlaceholder')} />
      </div>
      {files.length > 0 && (
        <ul className="flex flex-col gap-1" aria-label={t('editor.files')}>
          {files.map((f) => (
            <li key={f.path}>
              <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted" onClick={() => void window.jezo.workspace.openFile(f.path)}>
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={picker} type="file" multiple hidden onChange={(e) => void add(e.target.files).finally(() => (e.target.value = ''))} />
      <Button size="sm" variant="ghost" className="self-start text-muted-foreground" onClick={() => picker.current?.click()}>
        <Paperclip />
        {t('editor.attach')}
      </Button>
    </section>
  )
}

function Why({ text }: { text: string }) {
  const { t } = useTranslation()
  return (
    <Disclosure label={t('todo.why')} className="border-t pt-3">
      <p className="pt-2.5 text-[13px] leading-relaxed text-pretty text-muted-foreground">{text}</p>
    </Disclosure>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={t('todo.close')} className="text-muted-foreground">
      <X />
    </Button>
  )
}

/**
 * The side panel that holds a detail view. Over the calendar it's a drawer of
 * frosted glass that slides in from the right edge and leaves the same way;
 * beside Today it's part of the layout and only fades in a little. The glass is
 * mostly opaque: Chromium's backdrop blur skips content the calendar draws in its
 * own compositing layers (its scroller, raised chips), which would show through sharp.
 */
export function DetailPanel({ open, overlay, children }: { open: boolean; overlay?: boolean; children: React.ReactNode }) {
  const still = useReducedMotion()
  // A drawer moves by its own width; with reduced motion it only fades.
  const away = overlay && !still ? { transform: 'translateX(100%)' } : { opacity: 0, transform: still ? 'none' : 'translateX(12px)' }
  const here = overlay && !still ? { transform: 'translateX(0%)' } : { opacity: 1, transform: 'none' }
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.aside
          initial={away}
          animate={here}
          // Leaves faster than it arrives: closing is the user done with it.
          exit={{ ...away, transition: { duration: overlay ? 0.2 : 0.15, ease: easeOut } }}
          transition={{ duration: overlay ? 0.3 : 0.2, ease: overlay ? easeDrawer : easeOut }}
          className={
            overlay
              ? 'absolute inset-y-0 right-0 z-10 w-[360px] max-w-[85%] overflow-auto border-l border-white/40 bg-popover/92 px-5.5 py-6 shadow-[-24px_0_60px_-24px_rgb(10_14_40/0.35)] backdrop-blur-2xl backdrop-saturate-150 dark:border-white/8'
              : 'w-[340px] shrink-0 overflow-auto border-l bg-card px-5.5 py-5.5'
          }
        >
          {children}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
