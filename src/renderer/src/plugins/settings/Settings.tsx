import { ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListCard, Row } from '@/components/ListCard'
import { Segmented } from '@/components/Segmented'
import { Kbd } from '@/components/ui/kbd'
import { Switch } from '@/components/ui/switch'
import { useStore } from '@/data/store'
import { LANGUAGE_NAMES, LANGUAGES } from '@/i18n'
import { About } from './About'
import { ModelsCard } from './ModelsCard'
import { Providers } from './Providers'
import { ScheduleRows } from './ScheduleRows'
import { SpeechPage } from './speech/SpeechPage'
import { SpeechRow } from './speech/SpeechRow'

export function Settings() {
  const { t } = useTranslation('settings')
  const [canHold, setCanHold] = useState(true)
  const [atLogin, setAtLogin] = useState(false)
  const [deadlines, setDeadlines] = useState(true)
  useEffect(() => {
    window.jezo.quick.canHold().then(setCanHold)
    window.jezo.schedule.atLogin().then(setAtLogin)
    window.jezo.reminders.deadlines().then(setDeadlines)
  }, [])
  const settings = useStore((s) => s.settings)
  const { setTheme, setLanguage, navigate } = useStore.getState()
  const sub = useStore((s) => s.nav.sub)
  if (sub === 'providers') return <Providers />
  if (sub === 'about') return <About />
  if (sub === 'speech') return <SpeechPage />
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
        <Row title={t('reminders.title')} description={t('reminders.hint')}>
          <Switch checked={deadlines} onCheckedChange={(on) => void window.jezo.reminders.setDeadlines(on).then(setDeadlines)} aria-label={t('reminders.title')} />
        </Row>
        <Row title={t('atLogin.title')} description={t('atLogin.hint')}>
          <Switch checked={atLogin} onCheckedChange={(on) => void window.jezo.schedule.setAtLogin(on).then(setAtLogin)} aria-label={t('atLogin.title')} />
        </Row>
      </ListCard>
      <ListCard>
        <button onClick={() => navigate('settings', 'about')} className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors duration-150 hover:bg-muted/60">
          <div className="min-w-0 flex-1 text-[14.5px] font-medium">{t('about.title')}</div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </button>
      </ListCard>
      </div>
    </div>
  )
}
