import { ArrowLeft, Check, Copy, ExternalLink, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListCard, Row } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import icon from '../../../../../docs/brand/icon.svg'
import type { About as AboutInfo } from '../../../../shared/bridge'

/**
 * What Jezo is and which build is running: where its source lives, its
 * license, and the versions of the app and what it's built on, to name a
 * build in a bug report.
 */
export function About() {
  const { t, i18n } = useTranslation('settings')
  const navigate = useStore((s) => s.navigate)
  const zone = useStore((s) => s.zone)
  const [about, setAbout] = useState<AboutInfo | null>(null)
  // Standard ASR lives in the speech environment, not the app, so it's read from there. Its engines are listed under speech.
  const [speech, setSpeech] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    window.jezo.about().then(setAbout)
    window.jezo.speech.status().then((status) => {
      if (!status.installed) return setSpeech(t('about.notInstalled'))
      window.jezo.speech.inventory().then(
        ({ core }) => setSpeech(core ? `${core.version}${core.commit ? ` (${core.commit.slice(0, 7)})` : ''}` : t('about.notInstalled')),
        () => setSpeech(t('about.unreadable')),
      )
    })
  }, [t])
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
    ['pi', about.pi],
    ['Standard ASR', speech ?? '…'],
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

        <header className="flex items-center gap-4 py-2">
          <img src={icon} alt="" className="size-16 shrink-0" draggable={false} />
          <div className="min-w-0 flex-1">
            <h1 className="text-[26px] font-semibold tracking-tight">Jezo</h1>
            <p className="mt-0.5 text-[13.5px] text-pretty text-muted-foreground">{t('about.tagline')}</p>
          </div>
        </header>

        <ListCard>
          <a href={about.homepage} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 hover:bg-muted/60">
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-medium">{t('about.source')}</div>
              <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{about.homepage.replace(/^https:\/\//, '')}</div>
            </div>
            <ExternalLink className="size-4 text-muted-foreground" />
          </a>
          <Row title={t('about.license')} description={t('about.licenseHint')}>
            <a href={`${about.homepage}/blob/main/LICENSE`} target="_blank" rel="noreferrer" className="font-mono text-[13px] text-muted-foreground hover:text-foreground">
              {about.license}
            </a>
          </Row>
          <Row title={t('about.star')} description={t('about.starHint')}>
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={about.homepage} target="_blank" rel="noreferrer" />}>
              <Star />
              {t('about.starButton')}
            </Button>
          </Row>
        </ListCard>

        <div className="flex items-end gap-4 pt-2">
          <h2 className="flex-1 text-[15px] font-semibold">{t('about.build')}</h2>
          <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('about.copied') : t('about.copy')}
          </Button>
        </div>
        <ListCard>
          {rows.map(([label, value]) => (
            <Row key={label} title={label}>
              <span className="max-w-[70%] text-right font-mono text-[13px] break-all text-muted-foreground tabular-nums" data-selectable data-about={label}>
                {value}
              </span>
            </Row>
          ))}
        </ListCard>
      </div>
    </div>
  )
}
