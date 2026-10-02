import { ArrowLeft, Check, Copy } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListCard, Row } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { About as AboutInfo } from '../../../../shared/bridge'

/** Which Jezo is running: the version and the commit it was built from, to name a build in a bug report. */
export function About() {
  const { t, i18n } = useTranslation('settings')
  const navigate = useStore((s) => s.navigate)
  const zone = useStore((s) => s.zone)
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    window.jezo.about().then(setAbout)
  }, [])
  useEffect(() => {
    if (!copied) return
    const done = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(done)
  }, [copied])
  if (!about) return null

  const commit = about.commit || t('about.noCommit')
  const builtAt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(about.builtAt))
  const rows: [string, string][] = [
    [t('about.version'), about.version],
    [t('about.commit'), about.dirty ? `${commit} ${t('about.dirty')}` : commit],
    [t('about.builtAt'), builtAt],
    ['Electron', about.electron],
    ['Chromium', about.chrome],
    ['Node', about.node],
    [t('about.system'), about.system],
  ]
  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n')

  return (
    <div className="flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[620px] flex-col gap-4.5">
        <button
          onClick={() => navigate('settings')}
          className="flex items-center gap-1.5 self-start text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('heading')}
        </button>
        <div className="flex items-end gap-4">
          <h1 className="flex-1 text-[26px] font-semibold tracking-tight">{t('about.title')}</h1>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('about.copied') : t('about.copy')}
          </Button>
        </div>
        <ListCard>
          {rows.map(([label, value]) => (
            <Row key={label} title={label}>
              <span className="font-mono text-[13px] text-muted-foreground tabular-nums" data-selectable data-about={label}>
                {value}
              </span>
            </Row>
          ))}
        </ListCard>
      </div>
    </div>
  )
}
