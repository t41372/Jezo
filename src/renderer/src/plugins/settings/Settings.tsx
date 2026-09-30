import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListCard, Row } from '@/components/ListCard'
import { Segmented } from '@/components/Segmented'
import { Kbd } from '@/components/ui/kbd'
import { useStore } from '@/data/store'
import { LANGUAGE_NAMES, LANGUAGES } from '@/i18n'
import { ModelRows } from './ModelRows'
import { SpeechRow } from './SpeechRow'

export function Settings() {
  const { t } = useTranslation('settings')
  const [canHold, setCanHold] = useState(true)
  useEffect(() => {
    window.jezo.quick.canHold().then(setCanHold)
  }, [])
  const settings = useStore((s) => s.settings)
  const { setTheme, setLanguage } = useStore.getState()
  return (
    <div className="flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[620px] flex-col gap-4.5">
      <h1 className="text-[30px] font-semibold tracking-tight">{t('heading')}</h1>
      <ListCard>
        <ModelRows />
        <Row title={t('language')}>
          <Segmented
            label={t('language')}
            value={settings.language}
            onChange={setLanguage}
            options={[{ value: 'system', label: t('system') }, ...LANGUAGES.map((l) => ({ value: l, label: LANGUAGE_NAMES[l] }))]}
          />
        </Row>
        <Row title={t('appearance')}>
          <Segmented
            label={t('appearance')}
            value={settings.theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: t('system') },
              { value: 'light', label: t('light') },
              { value: 'dark', label: t('dark') },
            ]}
          />
        </Row>
        <Row title={t('hotkey')} description={canHold ? t('hotkeyHint') : t('hotkeyHintPressOnly')}>
          <Kbd className="h-7 px-2.5 font-mono text-[13px] text-foreground">⌥ X</Kbd>
        </Row>
        <SpeechRow />
        <Row title={t('morning')} description={t('morningHint')}>
          <Kbd className="h-7 px-2.5 font-mono text-[13px] text-foreground">08:00</Kbd>
        </Row>
        <Row title={t('evening')} description={t('eveningHint')}>
          <Kbd className="h-7 px-2.5 font-mono text-[13px] text-foreground">21:30</Kbd>
        </Row>
      </ListCard>
      </div>
    </div>
  )
}
