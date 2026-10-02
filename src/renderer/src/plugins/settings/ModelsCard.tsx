import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { ListCard, Row } from '@/components/ListCard'
import { useStore } from '@/data/store'
import type { ModelChoices, ProviderSummary } from '../../../../shared/bridge'
import { ModelPicker } from './ModelPicker'
import { tooSmallForAgent } from '../../../../shared/models'

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
  const [models, setModels] = useState<Awaited<ReturnType<typeof window.jezo.providers.choosable>>>([])
  useEffect(() => void window.jezo.providers.choosable().then(setModels), [choices])
  if (!choices) return null
  const mainContext = models.find((m) => m.provider === choices.main?.provider && m.model.id === choices.main?.id)?.model.contextWindow
  const mainTooSmall = tooSmallForAgent(mainContext, choices.agentContext)

  return (
    <ListCard>
      <Row
        title={t('models.main')}
        description={
          !choices.main
            ? t('models.none')
            : mainTooSmall
              ? t('models.mainTooSmall', { has: Math.round((mainContext ?? 0) / 1000), needed: Math.ceil(choices.agentContext / 1000) })
              : choices.mainIsAutomatic
                ? t('models.automatic')
                : t('models.mainHint')
        }
      >
        {choices.main && (
          <ModelPicker
            needed={choices.agentContext}
            value={choices.main}
            label={
              <>
                {choices.main.name}
                <span className="text-muted-foreground"> · {choices.main.providerName}</span>
              </>
            }
            onChange={(ref) => ref && window.jezo.providers.choose('main', ref).then(setChoices)}
          />
        )}
      </Row>
      {choices.main && (
        <div className="px-4 py-2.5">
          <Disclosure label={t('models.others')} triggerClassName="text-[12.5px]">
            <div className="flex items-center gap-3 pt-2 pb-1">
              <p className="flex-1 text-[12.5px] text-pretty text-muted-foreground">
                <span className="font-medium text-foreground">{t('models.background')}</span>　{t('models.backgroundHint')}
              </p>
              <ModelPicker
                needed={choices.agentContext}
                value={choices.background}
                label={choices.background ? choices.background.name : t('models.sameAsMain')}
                extra={{ label: t('models.sameAsMain'), selected: !choices.background }}
                onChange={(ref) => window.jezo.providers.choose('background', ref).then(setChoices)}
              />
            </div>
            <div className="flex items-center gap-3 pt-3 pb-1">
              <p className="flex-1 text-[12.5px] text-pretty text-muted-foreground">
                <span className="font-medium text-foreground">{t('models.small')}</span>　{t('models.smallHint')}
              </p>
              <ModelPicker
                value={choices.small}
                label={choices.small ? choices.small.name : t('models.sameAsBackground')}
                extra={{ label: t('models.sameAsBackground'), selected: !choices.small }}
                onChange={(ref) => window.jezo.providers.choose('small', ref).then(setChoices)}
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
