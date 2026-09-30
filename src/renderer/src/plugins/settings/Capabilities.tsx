import { Brain, Image } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ProviderModel } from '../../../../shared/bridge'

const size = (tokens: number) => (tokens >= 1_000_000 ? `${Math.round(tokens / 100_000) / 10}M` : `${Math.round(tokens / 1000)}K`)

/** What a model can do, from what the provider says about it: images, reasoning, how much it reads at once, price. */
export function Capabilities({ model, compact }: { model: ProviderModel; compact?: boolean }) {
  const { t } = useTranslation('settings')
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
      {model.loaded && <span className="rounded bg-ok/15 px-1.5 py-px text-[color-mix(in_oklch,var(--ok)_70%,var(--foreground))]">{t('models.loaded')}</span>}
      {model.image && <Image className="size-3.5" aria-label={t('models.image')} />}
      {model.reasoning && <Brain className="size-3.5" aria-label={t('models.reasoning')} />}
      <span className="font-mono tabular-nums">{size(model.contextWindow)}</span>
      {!compact && model.cost && (
        <span className="font-mono tabular-nums">
          ${model.cost.input}/${model.cost.output}
        </span>
      )}
    </span>
  )
}
