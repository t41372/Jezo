import { ArrowLeft, ArrowRight, NotebookPen, SquareCheck, Target } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/data/store'

type Linked = { id: string; kind: 'todo' | 'goal' | 'note'; title: string }

/**
 * What an item links to and what links to it, from the links in the files
 * (docs/design/backend.md, "Links"). Its goal is left out; it's shown already.
 */
export function Related({ id, links, exclude = [] }: { id: string; links?: string[]; exclude?: string[] }) {
  const { t } = useTranslation()
  const { todos, goals, notes, navigate, setCalendarDetail } = useStore()
  const find = (x: string): Linked | null => {
    const todo = todos.find((i) => i.id === x)
    if (todo) return { id: x, kind: 'todo', title: todo.title }
    const goal = goals.find((i) => i.id === x)
    if (goal) return { id: x, kind: 'goal', title: goal.name }
    const note = notes.find((i) => i.id === x)
    return note ? { id: x, kind: 'note', title: note.text } : null
  }
  const out = (links ?? []).filter((x) => !exclude.includes(x)).flatMap((x) => find(x) ?? [])
  const back = [...todos, ...goals, ...notes].filter((i) => i.links?.includes(id) && !exclude.includes(i.id)).flatMap((i) => find(i.id) ?? [])
  if (!out.length && !back.length) return null

  const open = (item: Linked) => {
    if (item.kind === 'todo') {
      setCalendarDetail(item.id)
      navigate('calendar')
    } else navigate(item.kind === 'goal' ? 'goals' : 'notes', item.kind === 'goal' ? item.id : null)
  }
  const icon = { todo: SquareCheck, goal: Target, note: NotebookPen }
  const row = (item: Linked, direction: 'out' | 'back') => {
    const Icon = icon[item.kind]
    const Arrow = direction === 'out' ? ArrowRight : ArrowLeft
    return (
      <li key={`${direction}-${item.id}`}>
        <button
          onClick={() => open(item)}
          className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[13px] transition-colors duration-150 hover:bg-muted"
          title={direction === 'out' ? t('related.linksTo') : t('related.linkedFrom')}
        >
          <Arrow className="size-3 shrink-0 text-muted-foreground" />
          <Icon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{item.title}</span>
        </button>
      </li>
    )
  }
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-xs text-muted-foreground">{t('related.title')}</h3>
      <ul className="-mx-1.5 flex flex-col">
        {out.map((item) => row(item, 'out'))}
        {back.map((item) => row(item, 'back'))}
      </ul>
    </section>
  )
}
