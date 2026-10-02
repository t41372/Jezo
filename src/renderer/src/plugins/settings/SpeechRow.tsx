import { Check, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Row } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import type { SpeechStatus } from '../../../../shared/bridge'

/** Speech recognition for holding ⌥X: installed with one click, then just there. */
export function SpeechRow() {
  const { t } = useTranslation('settings')
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  useEffect(() => {
    window.jezo.speech.status().then(setStatus)
    return window.jezo.speech.onStatus(setStatus)
  }, [])
  if (!status) return <Row title={t('speech')} />

  if (status.step) {
    return (
      <Row title={t('speech')} description={t(`speechStep.${status.step}`)}>
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      </Row>
    )
  }
  // Installed, but moving it to the version this Jezo uses didn't work (offline, say): it runs what's there.
  if (status.installed && status.error) {
    return (
      <Row title={t('speech')} description={<span className="break-words">{t('speechUpdateFailed', { error: status.error })}</span>}>
        <Button size="sm" variant="outline" disabled={!status.uv} onClick={() => window.jezo.speech.install()}>
          {t('speechRetry')}
        </Button>
      </Row>
    )
  }
  if (status.installed) {
    return (
      <Row title={t('speech')} description={t('speechReady', { engine: status.engine })}>
        <Check className="size-4 text-ok" strokeWidth={2.5} />
      </Row>
    )
  }
  const description = !status.uv || status.error === 'uv' ? t('speechNeedsUv') : status.error ? t('speechFailed', { error: status.error }) : t('speechHint', { engine: status.engine })
  return (
    <Row title={t('speech')} description={<span className="break-words">{description}</span>}>
      <Button size="sm" variant="outline" disabled={!status.uv} onClick={() => window.jezo.speech.install()}>
        {status.error ? t('speechRetry') : t('speechInstall')}
      </Button>
    </Row>
  )
}
