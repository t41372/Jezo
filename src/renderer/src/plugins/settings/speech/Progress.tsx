import { useTranslation } from 'react-i18next'
import type { SpeechStatus } from '../../../../../shared/bridge'
import { bytes } from './data'

/**
 * What's running now, with how far along it is when the engine says. An
 * unknown total stays unknown: it's never drawn as 0% or as done.
 */
export function StepText({ status }: { status: SpeechStatus }) {
  const { t, i18n } = useTranslation('settings')
  if (!status.step) return null
  const p = status.progress
  const done = p?.completed_units
  const total = p?.total_units
  const amount =
    done == null
      ? null
      : total
        ? `${Math.floor((done / total) * 100)}%`
        : p?.unit === 'bytes'
          ? bytes(done, i18n.language)
          : String(done)
  return (
    <span className="tabular-nums">
      {t(`speech.step.${status.step}`)}
      {amount && ` · ${amount}`}
    </span>
  )
}
