// Undo instead of asking (AGENTS.md, trust model): changes happen right away,
// and a toast offers to take them back.

import { toast } from 'sonner'
import i18n from '@/i18n'

export function offerUndo(message: string, undo: () => void) {
  toast(message, { action: { label: i18n.t('undo.action'), onClick: undo }, duration: 6000 })
}
