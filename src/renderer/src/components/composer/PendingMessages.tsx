import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** Pi keeps pending input outside the transcript until it is delivered. */
export function PendingMessages({ pending, onTakeBack }: {
  pending: { steering: readonly string[]; followUp: readonly string[] }
  onTakeBack: () => Promise<void>
}) {
  const { t } = useTranslation()
  if (!pending.steering.length && !pending.followUp.length) return null
  return (
    <div className="mb-2 flex flex-col gap-1.5 px-3 text-[12.5px] text-muted-foreground" data-pending-messages>
      {(['steering', 'followUp'] as const).map((mode) => pending[mode].map((text, i) => (
        <div key={`${mode}:${i}`} className="flex gap-2"><span className="shrink-0">{t(mode === 'steering' ? 'composer.steering' : 'composer.queued')}</span><span className="line-clamp-2" data-selectable>{text}</span></div>
      )))}
      <Button variant="ghost" size="sm" className="self-start px-0 text-xs" onClick={() => void onTakeBack()}>{t('composer.takeBack')}</Button>
    </div>
  )
}
