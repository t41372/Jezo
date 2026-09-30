import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { ListCard, Row } from '@/components/ListCard'
import { useStore } from '@/data/store'
import type { ModelChoices, ProviderSummary } from '../../../../shared/bridge'
import { ModelPicker } from './ModelPicker'

/** Keeps the model choices and provider list current while mounted. */
export function useProviders() {
  const [choices, setChoices] = useState<ModelChoices | null>(null)
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  useEffect(() => {
    const load = () => {
      window.jezo.providers.choices().then(setChoices)
      window.jezo.providers.list().then(setProviders)
    }
    load()
    return window.jezo.providers.onChange(load)
  }, [])
  return { choices, providers, setChoices }
}

/** 設定's model card: which model the agent uses, and the way to the providers. */
export function ModelsCard() {
  const { t } = useTranslation('settings')
  const { choices, providers, setChoices } = useProviders()
  const navigate = useStore((s) => s.navigate)
  const ready = providers.filter((p) => p.state === 'ready')
  if (!choices) return null

  return (
    <ListCard>
      <Row
        title={t('models.main')}
        description={choices.main ? (choices.mainIsAutomatic ? t('models.automatic') : t('models.mainHint')) : t('models.none')}
      >
        {choices.main && (
          <ModelPicker
            value={choices.main}
            label={
              <>
                {choices.main.id}
                <span className="text-muted-foreground"> · {choices.main.providerName}</span>
              </>
            }
            onChange={(ref) => ref && window.jezo.providers.choose('main', ref).then(setChoices)}
          />
        )}
      </Row>
      {choices.main && (
        <div className="px-4 py-2.5">
          <Disclosure label={t('models.background')} triggerClassName="text-[12.5px]">
            <div className="flex items-center gap-3 pt-2 pb-1">
              <p className="flex-1 text-[12.5px] text-pretty text-muted-foreground">{t('models.backgroundHint')}</p>
              <ModelPicker
                value={choices.background}
                label={choices.background ? choices.background.id : t('models.sameAsMain')}
                extra={{ label: t('models.sameAsMain'), selected: !choices.background }}
                onChange={(ref) => window.jezo.providers.choose('background', ref).then(setChoices)}
              />
            </div>
          </Disclosure>
        </div>
      )}
      <button onClick={() => navigate('settings', 'providers')} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/60">
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-medium">{t('providers.title')}</div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {ready.length ? t('providers.ready', { names: ready.map((p) => p.name).join('、') }) : t('providers.noneReady')}
          </div>
        </div>
        <ChevronRight className="size-4 text-muted-foreground" />
      </button>
    </ListCard>
  )
}
