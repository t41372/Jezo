import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListCard, Row } from '@/components/ListCard'
import { Segmented } from '@/components/Segmented'
import { Kbd } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { useStore } from '@/data/store'
import { LANGUAGE_NAMES, LANGUAGES } from '@/i18n'
import { ModelsCard } from './ModelsCard'
import { Providers } from './Providers'
import { ScheduleRows } from './ScheduleRows'
import { SpeechRow } from './SpeechRow'

export function Settings() {
  const { t } = useTranslation('settings')
  const [canHold, setCanHold] = useState(true)
  const [atLogin, setAtLogin] = useState(false)
  useEffect(() => {
    window.jezo.quick.canHold().then(setCanHold)
    window.jezo.schedule.atLogin().then(setAtLogin)
  }, [])
  const settings = useStore((s) => s.settings)
  const { setTheme, setLanguage } = useStore.getState()
  const sub = useStore((s) => s.nav.sub)
  if (sub === 'providers') return <Providers />
  return (
    <div className="flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[620px] flex-col gap-4.5">
      <h1 className="text-[30px] font-semibold tracking-tight">{t('heading')}</h1>
      <ModelsCard />
      <ListCard>
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
        <ScheduleRows />
        <Row title={t('atLogin.title')} description={t('atLogin.hint')}>
          <Switch checked={atLogin} onCheckedChange={(on) => void window.jezo.schedule.setAtLogin(on).then(setAtLogin)} aria-label={t('atLogin.title')} />
        </Row>
      </ListCard>
      </div>
    </div>
  )
}
