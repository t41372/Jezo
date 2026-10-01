import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useStore } from '@/data/store'
import type { Experiment, ISODate } from '@/data/types'
import { SectionHeader } from './parts'

const DECISIONS = [
  { id: 'adopt', variant: 'default' },
  { id: 'rerun', variant: 'outline' },
  { id: 'drop', variant: 'ghost' },
] as const

/** The first and last day the experiment runs. */
function span(x: Experiment) {
  const periods = x.arms.flatMap((a) => a.periods)
  return { from: periods.map((p) => p.from).sort()[0], to: periods.map((p) => p.to).sort().at(-1) }
}

const daysBetween = (from: ISODate, to: ISODate) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000)

/**
 * Small experiments, from `experiments/items/`. The agent sets them up, plans
 * each day by the arm it falls in, and writes the result; the user decides here
 * what to do with it (docs/design/experiments.md).
 */
export function Experiments() {
  const { t } = useTranslation('more')
  const experiments = useStore((s) => s.experiments)
  const openSession = useStore((s) => s.openSession)
  const add = (
    <Button variant="outline" size="sm" onClick={() => openSession(null, t('experiments.addPrefill'))}>
      {t('experiments.add')}
    </Button>
  )
  return (
    <>
      <SectionHeader title={t('sections.experiments.title')} action={add}>{t('experiments.intro')}</SectionHeader>
      {experiments.map((x) => (x.state === 'finished' ? <Finished key={x.id} experiment={x} /> : <Running key={x.id} experiment={x} />))}
      {experiments.length === 0 && <p className="text-[13px] text-muted-foreground">{t('experiments.none')}</p>}
    </>
  )
}

function Running({ experiment: x }: { experiment: Experiment }) {
  const { t } = useTranslation('more')
  const today = useStore((s) => s.now.date)
  const { from, to } = span(x)
  const arm = x.arms.find((a) => a.periods.some((p) => p.from <= today && today <= p.to))
  const weeks = from && to ? Math.ceil((daysBetween(from, to) + 1) / 7) : 0
  const status = !from || today < from
    ? t('experiments.starts', { date: from })
    : to && today > to
      ? t('experiments.waiting')
      : t('experiments.running', { week: Math.floor(daysBetween(from, today) / 7) + 1, weeks })
  return (
    <Card className="gap-1.5 px-4.5 py-3.5" data-experiment={x.id}>
      <div className="flex items-center gap-2.5">
        <span className="size-[7px] rounded-full bg-ok" />
        <span className="flex-1 text-sm font-medium">{x.title}</span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </div>
      {arm && <p className="pl-[17px] text-[13px] text-muted-foreground">{t('experiments.thisWeek', { label: arm.label, condition: arm.condition ?? '' })}</p>}
      <p className="pl-[17px] text-[12.5px] text-muted-foreground">{t('experiments.measure', { measure: x.measure })}</p>
    </Card>
  )
}

function Finished({ experiment: x }: { experiment: Experiment }) {
  const { t } = useTranslation('more')
  const { decideExperiment, openSession } = useStore.getState()
  const { from, to } = span(x)
  const weeks = from && to ? Math.ceil((daysBetween(from, to) + 1) / 7) : 0
  return (
    <Card className="gap-3.5 px-5 py-4.5" data-experiment={x.id}>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[15.5px] font-semibold">{x.title}</span>
        <span className="text-xs text-muted-foreground">{t('experiments.finished', { count: weeks })}</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {x.arms.map((arm) => (
          <div key={arm.label} className="rounded-lg bg-muted px-3.5 py-3" title={arm.basis}>
            <div className="text-xs text-muted-foreground">{arm.label}</div>
            <div className="mt-0.5 text-[26px] font-medium tabular-nums">{arm.value ?? '–'}</div>
            <div className="text-xs text-muted-foreground">{x.measure}</div>
          </div>
        ))}
      </div>
      {x.conclusion && <p className="text-[14.5px] leading-[1.7] text-pretty">{x.conclusion}</p>}
      {x.decision ? (
        <div className="flex flex-wrap items-center gap-2 text-[13.5px] text-muted-foreground">
          <span className="flex-1">{t(`experiments.choices.${x.decision}.reply`)}</span>
          {(x.decision === 'adopt' || x.decision === 'rerun') && (
            <Button variant="outline" size="sm" onClick={() => openSession(null, t(`experiments.choices.${x.decision as 'adopt' | 'rerun'}.prefill`, { title: x.title }))}>
              {t('experiments.tellJezo')}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {DECISIONS.map((d) => (
            <Button key={d.id} variant={d.variant} className={d.variant === 'ghost' ? 'text-muted-foreground' : undefined} onClick={() => decideExperiment(x.id, d.id)}>
              {t(`experiments.choices.${d.id}.label`)}
            </Button>
          ))}
        </div>
      )}
    </Card>
  )
}
