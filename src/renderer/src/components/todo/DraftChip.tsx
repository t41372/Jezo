import { useTranslation } from 'react-i18next'
import type { Todo } from '@/data/types'

/**
 * Says what about a todo is still the agent's proposal, before its title: the
 * todo itself, or only its time. Nothing for a settled todo.
 */
export function DraftChip({ todo }: { todo: Todo }) {
  const { t } = useTranslation()
  if (todo.state !== 'draft' && !todo.slot?.proposed) return null
  return <span className="mr-1.5 rounded bg-draft-chip px-1 py-px text-[11px] text-draft-ink">{todo.state === 'draft' ? t('todo.draftChip') : t('todo.proposedChip')}</span>
}
