import { cn } from 'cn'
import { Check, ExternalLink, LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Disclosure } from '@/components/Disclosure'
import { Button } from '@/components/ui/button'
import type { SpeechStatus } from '../../../../../shared/bridge'
import { speechCapabilityAt, type SpeechArtifactReport, type SpeechModelDetail } from '../../../../../shared/speech'
import { bytes, languageName, message, run, useModelDetail, usedReport } from './data'
import { SettingsForm } from './SettingsForm'

/** One model: whether ⌥X uses it, how it listens, its files and its settings. */
export function ModelPane({ id, status }: { id: string; status: SpeechStatus }) {
  const { t } = useTranslation('settings')
  const { detail, error, reload } = useModelDetail(id, status)
  if (error) return <p className="p-6 text-[13px] break-words text-destructive">{error}</p>
  if (!detail) {
    return (
      <div className="flex items-center gap-2 p-6 text-[13px] text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        {t('speech.reading')}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-6 p-6">
      <Header detail={detail} status={status} />
      {detail.error ? (
        <Broken text={detail.error} />
      ) : (
        <>
          {detail.configurationError && <Broken text={t('speech.configurationError', { error: detail.configurationError })} />}
          <Listening detail={detail} />
          <Files detail={detail} busy={!!status.step} onChange={reload} />
        </>
      )}
      {!detail.error && (
        <SettingsForm detail={detail} busy={!!status.step} onSaved={reload} />
      )}
    </div>
  )
}

function Broken({ text }: { text: string }) {
  return <p className="rounded-xl bg-destructive/8 px-3.5 py-2.5 text-[13px] break-words text-destructive">{text}</p>
}

/** The name, and the one action that matters: making it the model ⌥X uses. */
function Header({ detail, status }: { detail: SpeechModelDetail; status: SpeechStatus }) {
  const { t } = useTranslation('settings')
  const [working, setWorking] = useState(false)
  const active = status.model === detail.id
  const report = usedReport(detail)
  const missing = report?.requirements.filter((r) => r.required_for_inference && r.state !== 'ready') ?? []
  const needsDownload = report?.applicable && report.readiness !== 'ready' && missing.length > 0
  const canDownload = needsDownload && missing.every((r) => r.can_acquire_now)
  const blocked = !!detail.error || !!detail.configurationError || (needsDownload && !canDownload)

  const use = async () => {
    setWorking(true)
    try {
      if (canDownload) await run({ kind: 'acquire', model: detail.id, mode: detail.dictation!.mode, refresh: false })
      await run({ kind: 'select', model: detail.id })
      toast(t('speech.nowUsing', { model: detail.name }))
    } catch (e) {
      toast.error(t('speech.useFailed'), { description: message(e) })
    } finally {
      setWorking(false)
    }
  }

  const description = typeof detail.properties.description === 'string' ? detail.properties.description : null
  return (
    <header className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <h2 className="min-w-0 truncate text-xl font-semibold" title={detail.id}>
          {detail.name}
        </h2>
        <span className="flex-1" />
        {active ? (
          <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-[color-mix(in_oklch,var(--ok)_70%,var(--foreground))]">
            <Check className="size-3.5" strokeWidth={2.5} />
            {t('speech.active')}
          </span>
        ) : (
          <Button size="sm" disabled={blocked || working || !!status.step} onClick={use}>
            {working && <LoaderCircle className="animate-spin" />}
            {canDownload ? t('speech.downloadAndUse') : t('speech.use')}
          </Button>
        )}
      </div>
      <p className="text-[12.5px] text-muted-foreground">
        {detail.package} · <span className="font-mono">{detail.id}</span>
      </p>
      {description && <p className="mt-1 text-[13.5px] text-pretty">{description}</p>}
    </header>
  )
}

/**
 * What the model can do, in the field's own terms, each with a line saying
 * what it means for whoever doesn't know them. From the configured model
 * when it builds, from the class declaration otherwise.
 */
function Listening({ detail }: { detail: SpeechModelDetail }) {
  const { t, i18n } = useTranslation('settings')
  const capabilities = detail.effectiveCapabilities ?? detail.capabilities
  const dictation = detail.dictation
  const mode = dictation?.mode
  const partials = speechCapabilityAt(capabilities, 'streaming.emits_partials')?.supported
  const prompt = mode && speechCapabilityAt(capabilities, `${mode}.guidance.prompt`)?.supported
  const hints = mode && speechCapabilityAt(capabilities, `${mode}.guidance.phrase_hints`)?.supported
  const selectable = Array.isArray(detail.properties.selectable_languages) ? (detail.properties.selectable_languages as string[]) : []
  const named = selectable.map((code) => languageName(code, i18n.language)).filter((n): n is string => !!n)
  const detects = selectable.includes('auto')
  const recognition = !dictation ? null : dictation.incremental && partials ? 'live' : dictation.incremental ? 'liveNoPartials' : 'afterwards'
  const guidance = prompt && hints ? 'both' : prompt ? 'prompt' : hints ? 'hints' : 'none'

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{t('speech.facts.title')}</h3>
      <dl className="flex flex-col divide-y divide-card-border rounded-xl border border-card-border">
        {recognition && <Fact label={t('speech.facts.mode')} value={t(`speech.facts.${recognition}`)} hint={t(`speech.facts.${recognition}Hint`)} />}
        <Fact label={t('speech.facts.guidance')} value={t(`speech.facts.guidance_${guidance}`)} hint={t(guidance === 'none' ? 'speech.facts.unguidedHint' : 'speech.facts.guidedHint')} />
        {named.length > 0 && (
          <Fact
            label={t('speech.facts.languages')}
            value={detects ? t('speech.facts.languagesDetect', { count: named.length }) : t('speech.facts.languagesCount', { count: named.length })}
          >
            <Disclosure label={t('speech.facts.whichLanguages')} className="mt-1" triggerClassName="text-xs">
              <p className="pt-1 text-[12px] text-pretty text-muted-foreground">{named.join(t('speech.listSeparator'))}</p>
            </Disclosure>
          </Fact>
        )}
        {dictation && (
          <Fact
            label={t('speech.facts.audio')}
            value={t('speech.facts.audioValue', { rate: dictation.sampleRate / 1000 })}
            hint={t(dictation.incremental ? 'speech.facts.audioStreamHint' : 'speech.facts.audioBatchHint')}
          />
        )}
      </dl>
      {!detail.effectiveCapabilities && <p className="text-xs text-muted-foreground">{t('speech.facts.declared')}</p>}
      <Disclosure label={t('speech.declarations')} triggerClassName="text-xs">
        <pre className="mt-1.5 max-h-80 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px] text-muted-foreground" data-selectable>
          {JSON.stringify({ properties: detail.properties, capabilities, metadata: detail.metadata }, null, 2)}
        </pre>
      </Disclosure>
    </section>
  )
}

/** One capability: its name, its value, and a line on what that means. */
function Fact({ label, value, hint, children }: { label: string; value: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-3.5 py-2.5">
      <dt className="w-28 shrink-0 text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1">
        <div className="text-[13.5px]">{value}</div>
        {hint && <p className="mt-0.5 text-[12px] text-pretty text-muted-foreground">{hint}</p>}
        {children}
      </dd>
    </div>
  )
}

/** The files the model needs to listen, as the engine reports them. Jezo never guesses who owns them, so it doesn't delete them. */
function Files({ detail, busy, onChange }: { detail: SpeechModelDetail; busy: boolean; onChange: () => void }) {
  const { t, i18n } = useTranslation('settings')
  const [working, setWorking] = useState<'download' | 'refresh' | null>(null)
  const mode = detail.dictation?.mode
  const report = usedReport(detail)
  const failed = mode ? detail.artifactErrors[mode] : undefined
  const acquire = (refresh: boolean) => {
    if (!mode) return
    setWorking(refresh ? 'refresh' : 'download')
    run({ kind: 'acquire', model: detail.id, mode, refresh })
      .catch((e) => toast.error(t('speech.downloadFailed'), { description: message(e) }))
      .finally(() => (setWorking(null), onChange()))
  }

  const required = report?.requirements.filter((r) => r.required_for_inference) ?? []
  const missing = required.filter((r) => r.state !== 'ready')
  const size = required.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0)
  const expected = missing.reduce((sum, r) => sum + (r.expected_size_bytes ?? 0), 0)
  const actions = [...(report?.requirements.flatMap((r) => r.required_actions) ?? []), ...(detail.acquisitionError?.required_actions ?? [])]
  const canDownload = missing.length > 0 && missing.every((r) => r.can_acquire_now)

  let summary: React.ReactNode
  if (failed) summary = <span className="text-destructive">{t('speech.files.unreadable', { error: failed })}</span>
  else if (!report || !report.applicable || report.readiness === 'not_applicable') summary = t('speech.files.none')
  else if (report.readiness === 'ready') summary = size ? t('speech.files.readySize', { size: bytes(size, i18n.language) }) : t('speech.files.ready')
  else if (canDownload) summary = expected ? t('speech.files.needDownloadSize', { size: bytes(expected, i18n.language) }) : t('speech.files.needDownload')
  else if (missing.length) summary = t('speech.files.blocked')
  else summary = t('speech.files.unknown')

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 text-sm font-medium">{t('speech.files.title')}</h3>
        {canDownload && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => acquire(false)}>
            {working === 'download' && <LoaderCircle className="animate-spin" />}
            {t('speech.files.download')}
          </Button>
        )}
      </div>
      <p className="text-[13.5px]">{summary}</p>
      {missing.map((r) => r.acquisition_blocker && <p key={r.artifact_id} className="text-[13px] text-muted-foreground">{t(`speech.blocker.${r.acquisition_blocker}`, { defaultValue: r.acquisition_blocker })}</p>)}
      {actions.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {actions.map((a, i) => (
            <li key={i} className="text-[13px] text-pretty">
              {a.message}
              {a.url && (
                <a href={a.url} target="_blank" rel="noreferrer" className="ml-1.5 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                  {t('speech.files.open')}
                  <ExternalLink className="size-3" />
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {detail.acquisitionError && <p className="text-[13px] break-words text-destructive">{t('speech.files.lastFailed', { error: detail.acquisitionError.message })}</p>}
      {report && report.requirements.length > 0 && (
        <Disclosure label={t('speech.files.details')} triggerClassName="text-xs">
          <div className="flex flex-col gap-3 pt-2">
            {(['streaming', 'batch'] as const).map((m) => detail.artifacts[m] && <Report key={m} report={detail.artifacts[m]!} used={m === mode} />)}
            {report.requirements.some((r) => r.source_is_mutable) && (
              <div className="flex items-center gap-3">
                <p className="flex-1 text-[12.5px] text-muted-foreground">{t('speech.files.refreshHint')}</p>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => acquire(true)}>
                  {working === 'refresh' && <LoaderCircle className="animate-spin" />}
                  {t('speech.files.refresh')}
                </Button>
              </div>
            )}
          </div>
        </Disclosure>
      )}
    </section>
  )
}

function Report({ report, used }: { report: SpeechArtifactReport; used: boolean }) {
  const { t, i18n } = useTranslation('settings')
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs text-muted-foreground">{t(used ? 'speech.files.usedMode' : 'speech.files.otherMode', { mode: t(`speech.mode.${report.mode}`, { defaultValue: report.mode }) })}</div>
      <ul className="flex flex-col divide-y divide-card-border rounded-xl border border-card-border">
        {report.requirements.map((r) => (
          <li key={r.artifact_id} className="flex flex-col gap-0.5 px-3.5 py-2 text-[12.5px]">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px]" title={r.label}>
                {r.label}
              </span>
              <span className={cn('shrink-0', r.state === 'ready' ? 'text-[color-mix(in_oklch,var(--ok)_70%,var(--foreground))]' : 'text-muted-foreground')}>
                {t(`speech.state.${r.state}`, { defaultValue: r.state })}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-3 text-muted-foreground tabular-nums">
              {r.size_bytes != null && <span>{bytes(r.size_bytes, i18n.language)}</span>}
              {r.size_bytes == null && r.expected_size_bytes != null && <span>{t('speech.files.expected', { size: bytes(r.expected_size_bytes, i18n.language) })}</span>}
              {r.artifact_version && <span className="font-mono">{r.artifact_version.slice(0, 12)}</span>}
              {!r.required_for_inference && <span>{t('speech.files.optional')}</span>}
            </div>
            {r.location && (
              <span className="font-mono text-[11.5px] break-all text-muted-foreground" data-selectable>
                {r.location}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
