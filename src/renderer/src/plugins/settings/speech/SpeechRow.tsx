import { ChevronRight, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Row } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import { message, useInventory, useSpeechStatus } from './data'
import { StepText } from './Progress'

/**
 * Speech recognition in 設定: one click to install it, then which model
 * listens, and the way to everything else about it.
 */
export function SpeechRow() {
  const { t } = useTranslation('settings')
  const status = useSpeechStatus()
  const { inventory } = useInventory(status)
  const navigate = useStore((s) => s.navigate)
  if (!status) return <Row title={t('speech.title')} />

  if (!status.installed && !status.step) {
    return (
      <Row
        title={t('speech.title')}
        description={<span className="break-words">{!status.uv ? t('speech.needsUv') : status.error ? t('speech.installFailed', { error: status.error }) : t('speech.installHint')}</span>}
      >
        <Button size="sm" variant="outline" disabled={!status.uv} onClick={() => window.jezo.speech.install().catch(() => {})}>
          {status.error ? t('speech.retry') : t('speech.install')}
        </Button>
      </Row>
    )
  }

  const model = inventory?.models.find((m) => m.id === status.model)
  const description = status.step ? (
    <StepText status={status} />
  ) : status.error ? (
    <span className="line-clamp-2 break-words text-destructive">{message(status.error)}</span>
  ) : !status.model ? (
    t('speech.noModel')
  ) : model?.error ? (
    <span className="text-destructive">{t('speech.modelBroken', { model: model.name })}</span>
  ) : (
    model ? t('speech.using', { model: model.name, engine: model.engine }) : status.engine
  )
  return (
    <button onClick={() => navigate('settings', 'speech')} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/60">
      <div className="min-w-0 flex-1">
        <div className="text-[14.5px] font-medium">{t('speech.title')}</div>
        <div className="mt-0.5 text-[12.5px] text-pretty text-muted-foreground">{description}</div>
      </div>
      {status.step && <LoaderCircle className="size-4 animate-spin text-muted-foreground" />}
      <ChevronRight className="size-4 text-muted-foreground" />
    </button>
  )
}
