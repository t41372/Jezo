import { cn } from 'cn'
import { Bookmark, Brain, CircleCheck, CircleHelp, Target, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStore } from '@/data/store'
import type { Note, NoteKind, SortItem } from '@/data/types'
import { easeOut } from '@/lib/motion'

const ICONS: Record<SortItem['as'], LucideIcon> = { todo: CircleCheck, goal: Target, memory: Brain, keep: Bookmark, ask: CircleHelp }

const KIND_STYLE: Record<SortItem['as'], string> = {
  todo: 'bg-ok/12 text-[color-mix(in_oklch,var(--ok)_70%,var(--foreground))]',
  goal: 'bg-draft-chip text-draft-ink',
  memory: 'bg-foreground/6 text-foreground/70',
  keep: 'bg-foreground/6 text-foreground/70',
  ask: 'bg-warn/18 text-[color-mix(in_oklch,var(--warn)_65%,var(--foreground))]',
}

const ANSWERS: NoteKind[] = ['todo', 'goal', 'memory', 'keep']

/**
 * The proposal's rows as they stand. A note keeps the latest proposal and the
 * user's decision on it; a row whose note was sorted again later shows what
 * this session proposed.
 */
export function liveItems(items: SortItem[], notes: Note[], sessionId: string): SortItem[] {
  return items.map((item) => {
    const proposal = notes.find((n) => n.id === item.noteId)?.proposal
    if (proposal?.session !== sessionId) return item
    return { noteId: item.noteId, as: proposal.as, title: proposal.title, question: proposal.question, decision: proposal.decision }
  })
}

/**
 * Each proposal is put away on its own, so a later one in the same conversation
 * still shows. It's known by its entry's id in the conversation, which a restart
 * keeps; its place in the list can shift when notices come and go.
 */
export const proposalKey = (sessionId: string, message: { id?: string } | undefined, index: number) => `${sessionId}#${message?.id ?? index}`

/**
 * The agent's proposal for a batch of notes: what each one becomes, or a
 * question when it can't tell. Every row is a draft until the user says yes,
 * and every decision can be taken back. The same card shows in the
 * conversation and on the 隨手記 page (`onPage`).
 */
export function SortCard({ data, sessionId, index, onPage }: { data: unknown; sessionId: string; index: number; onPage?: boolean }) {
  const { t } = useTranslation('notes')
  const notes = useStore((s) => s.notes)
  const { decideNote, undoNoteDecision, openSession, closeNoteProposal } = useStore.getState()
  const items = liveItems((data as { items: SortItem[] }).items, notes, sessionId)
  const open = items.filter((i) => !i.decision)
  // Questions need an answer, so "accept all" leaves them.
  const answerable = open.filter((i) => i.as !== 'ask')

  return (
    <Card variant={open.length ? 'draft' : 'default'} className="gap-1 px-4.5 pt-4 pb-3.5 transition-[border-color,background-color] duration-200">
      <div className="flex items-baseline gap-2">
        <span className="text-[14.5px] font-semibold">{t('card.title')}</span>
        <span className="text-xs text-muted-foreground">{open.length ? t('card.meta', { count: items.length }) : t('card.done')}</span>
      </div>
      <ul className="flex flex-col divide-y divide-card-border">
        {items.map((item) => (
          <SortRow
            key={item.noteId}
            item={item}
            note={notes.find((n) => n.id === item.noteId)}
            decide={(accept, as) => decideNote(sessionId, index, item.noteId, accept, as)}
            undo={() => undoNoteDecision(sessionId, index, item.noteId)}
          />
        ))}
      </ul>
      {(answerable.length > 1 || onPage) && (
        <div className="flex items-center gap-2 pt-2">
          {answerable.length > 1 && (
            <Button onClick={() => answerable.forEach((i) => decideNote(sessionId, index, i.noteId, true))} className="px-4">
              {t('card.acceptAll')}
            </Button>
          )}
          <span className="flex-1" />
          {onPage && (
            <button onClick={() => openSession(sessionId)} className="text-[12.5px] text-muted-foreground transition-colors duration-150 hover:text-foreground">
              {t('card.openChat')}
            </button>
          )}
          {onPage && !open.length && (
            <Button size="sm" variant="secondary" className="bg-muted" onClick={() => closeNoteProposal(proposalKey(sessionId, useStore.getState().sessions.find((x) => x.id === sessionId)?.messages[index], index))}>
              {t('card.close')}
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

function SortRow({
  item,
  note,
  decide,
  undo,
}: {
  item: SortItem
  note: Note | undefined
  decide: (accept: boolean, as?: NoteKind) => void
  undo: () => void
}) {
  const { t } = useTranslation('notes')
  const Icon = ICONS[item.as]
  // Show what the user wrote when the agent reworded it.
  const original = note && item.as !== 'ask' && note.text !== item.title ? note.text : null

  return (
    <li className="flex items-start gap-3 py-3">
      <span className={cn('mt-px flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold', KIND_STYLE[item.as])}>
        <Icon className="size-3" strokeWidth={2.2} />
        {t(`kind.${item.as}`)}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('text-[13.5px] leading-snug text-pretty transition-colors duration-150', item.decision === 'rejected' && 'text-muted-foreground')} data-selectable>
          {item.title}
        </div>
        {original && <div className="mt-0.5 text-xs text-pretty text-muted-foreground">{t('card.original', { text: original })}</div>}
        {item.as === 'ask' && !item.decision && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ANSWERS.map((kind) => (
              <Button key={kind} size="xs" variant="outline" onClick={() => decide(true, kind)}>
                {t(`card.answer.${kind}`)}
              </Button>
            ))}
          </div>
        )}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={item.decision ?? 'open'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease: easeOut }}
          className="flex shrink-0 items-center gap-1.5"
        >
          {item.decision ? (
            <>
              <span className="text-xs text-muted-foreground">
                {item.decision === 'accepted' ? t(`card.accepted.${item.as as NoteKind}`) : t('card.rejected')}
              </span>
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={undo}>
                {t('card.undo')}
              </Button>
            </>
          ) : (
            <>
              {item.as !== 'ask' && (
                <Button size="xs" onClick={() => decide(true)}>
                  {t('card.accept')}
                </Button>
              )}
              <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => decide(false)}>
                {t('card.reject')}
              </Button>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </li>
  )
}
