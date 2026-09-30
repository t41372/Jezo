import { Progress as ProgressPrimitive } from '@base-ui/react/progress'
import { cn } from 'cn'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Bar, BarChart, YAxis } from 'recharts'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import { Card } from '@/components/ui/card'
import { ProgressIndicator, ProgressTrack } from '@/components/ui/progress'
import { useStore } from '@/data/store'
import type { Finding, Goal } from '@/data/types'
import { goalStyle } from '@/lib/goal-color'

const n = (x: number) => Math.round(x * 10) / 10

/** "11/15 送出 · 還有 7 週" */
function useDueLabel(goal: Goal) {
  const { t, i18n } = useTranslation('goals')
  const today = useStore((s) => s.now.date)
  if (!goal.due) return null
  const days = Math.round((Date.parse(goal.due) - Date.parse(today)) / 86_400_000)
  const date = new Date(`${goal.due}T00:00`).toLocaleDateString(i18n.language, { month: 'numeric', day: 'numeric' })
  const left = days < 0 ? t('due.past') : days < 14 ? t('due.days', { count: days }) : t('due.weeks', { count: Math.round(days / 7) })
  return `${date}${goal.dueNote ? ` ${goal.dueNote}` : ''} · ${left}`
}

/** How the estimates compare to what things actually took. Fewer than 3 finished todos say nothing yet. */
function estimateSummary(samples: Goal['samples'], t: (key: string, options?: object) => string) {
  if (samples.length < 3) return t('estimates.few')
  const ratio = samples.reduce((sum, s) => sum + s.actual / s.estimated, 0) / samples.length
  const percent = Math.round(Math.abs(ratio - 1) * 100)
  return ratio > 1.15 ? t('estimates.under', { percent }) : ratio < 0.87 ? t('estimates.over', { percent }) : t('estimates.close')
}


/** The list of goals, or one goal when it's open. */
export function Goals() {
  const goals = useStore((s) => s.goals)
  const openId = useStore((s) => s.nav.sub)
  const open = goals.find((g) => g.id === openId)

  return (
    <div className="flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[760px] flex-col gap-5.5">{open ? <GoalView goal={open} /> : <GoalList goals={goals} />}</div>
    </div>
  )
}

function GoalList({ goals }: { goals: Goal[] }) {
  const { t } = useTranslation('goals')
  const { navigate, openSession } = useStore.getState()
  const notes = useStore((s) => s.notes)
  // Goal ideas the agent sorted out of 隨手記. They become goals by talking them through.
  const ideas = notes.flatMap((n) => (n.became?.kind === 'goal' ? [{ id: n.id, title: n.became.title }] : []))
  return (
    <>
      <h1 className="text-[30px] font-semibold tracking-tight">{t('heading')}</h1>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        {goals.map((g) => (
          <button key={g.id} onClick={() => navigate('goals', g.id)} className="pressable rounded-2xl text-left" style={goalStyle(g.hue)}>
            <Card className="h-full gap-3 p-4.5 transition-colors duration-150 hover:bg-accent">
              <span className="flex items-center gap-2 text-[15.5px] font-semibold">
                <span className="size-2.5 rounded-[3px] bg-goal" />
                {g.name}
              </span>
              <GoalProgress goal={g} className="h-1.5" />
              <span className="text-[12.5px] text-muted-foreground">
                {t('weekShort', { done: n(g.week.done), total: n(g.week.done + g.week.planned), unit: g.progress.unit })}
              </span>
            </Card>
          </button>
        ))}
        <button
          onClick={() => openSession(null, t('newPrefill'))}
          className="pressable flex min-h-[110px] flex-col items-center justify-center gap-1 rounded-2xl border-[1.5px] border-dashed p-4.5 text-sm text-muted-foreground hover:bg-muted"
        >
          <span className="flex items-center gap-1">
            <Plus className="size-4" />
            {t('new')}
          </span>
          <span className="text-xs">{t('newHint')}</span>
        </button>
      </div>
      {ideas.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <div>
            <h2 className="text-[15px] font-semibold">{t('ideas')}</h2>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t('ideasHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ideas.map((idea) => (
              <button
                key={idea.id}
                onClick={() => openSession(null, t('ideaPrefill', { title: idea.title }))}
                className="pressable rounded-full border-[1.5px] border-dashed border-draft bg-draft-bg px-3.5 py-1.5 text-[13px] text-draft-ink hover:bg-draft-chip"
              >
                {idea.title}
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function GoalView({ goal }: { goal: Goal }) {
  const { t } = useTranslation('goals')
  const navigate = useStore((s) => s.navigate)
  const dueLabel = useDueLabel(goal)
  const basis = (f: Finding) =>
    f.basis === 'stated' ? t('basis.stated') : f.basis ? t('basis.records', { count: f.basis.records }) : undefined
  const findings = (lines: Finding[]) => lines.map((f) => <Row key={f.text} text={f.text} basis={basis(f)} />)
  const sections = [
    {
      id: 'rules',
      title: t('sections.rules'),
      hint: goal.ruleProposal ? t('proposalHint') : t('rulesCount', { count: goal.rules.length }),
      body: <Rules goal={goal} />,
    },
    {
      id: 'estimates',
      title: t('sections.estimates'),
      hint: estimateSummary(goal.samples, t as (key: string, options?: object) => string),
      body: goal.samples.length ? <EstimateChart samples={goal.samples} /> : <Row text={t('estimates.none')} />,
    },
    ...(goal.report ? [{ id: 'report', title: t('sections.report'), hint: goal.report.range, body: findings(goal.report.lines) }] : []),
  ]

  return (
    <div className="flex flex-col gap-5.5" style={goalStyle(goal.hue)}>
      <button onClick={() => navigate('goals')} className="self-start text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-150">
        {t('back')}
      </button>
      <div>
        <h1 className="flex items-center gap-2.5 text-[28px] font-semibold">
          <span className="size-3 rounded-[4px] bg-goal" />
          {goal.name}
        </h1>
        {dueLabel && <p className="mt-0.5 text-sm text-muted-foreground">{dueLabel}</p>}
      </div>

      <Card className="gap-0 px-5.5 py-5">
        <div className="flex items-baseline gap-2">
          <span className="text-[40px] leading-none font-medium tabular-nums">{n(goal.progress.done)}</span>
          <span className="text-sm text-muted-foreground">
            / {goal.progress.total} {goal.progress.unit}
          </span>
        </div>
        <GoalProgress goal={goal} showPlanned className="mt-3.5 h-2" />
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span className="flex-1">{t('weekLong', { done: n(goal.week.done), planned: n(goal.week.planned), unit: goal.progress.unit })}</span>
          <span className="text-xs">{t('legendDone')}</span>
          <span className="text-xs">{t('legendPlanned')}</span>
        </div>
      </Card>

      {goal.agentNote && (
        <p className="text-[15px] leading-[1.7] text-pretty" data-selectable>
          {goal.agentNote}
        </p>
      )}

      {/* A proposal waits in the rules section, so that section starts open. */}
      <Accordion multiple defaultValue={goal.ruleProposal ? ['rules'] : []} className="border-t">
        {sections.map((section) => (
          <AccordionItem key={section.id} value={section.id} className="border-b">
            <AccordionTrigger className="items-center rounded-none px-0.5 py-3.5 text-sm hover:no-underline">
              <span className="flex-1">{section.title}</span>
              <span className={cn('mr-2.5 text-[12.5px] font-normal', section.id === 'rules' && goal.ruleProposal ? 'text-draft-ink' : 'text-muted-foreground')}>
                {section.hint}
              </span>
            </AccordionTrigger>
            <AccordionContent className="flex flex-col gap-2 px-0.5 pb-3.5">{section.body}</AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  )
}

function Row({ text, basis, warn }: { text: string; basis?: string; warn?: boolean }) {
  return (
    <div className="flex gap-2.5 text-[13.5px] leading-normal">
      <span className="flex-1 text-pretty">{text}</span>
      {basis && <span className={cn('text-[12.5px]', warn ? 'font-medium text-destructive' : 'text-muted-foreground')}>{basis}</span>}
    </div>
  )
}

/** The if-then rules with how often each worked, and the agent's proposed rewrite of one that doesn't. */
function Rules({ goal }: { goal: Goal }) {
  const { t } = useTranslation('goals')
  const decide = useStore((s) => s.decideRuleProposal)
  const proposal = goal.ruleProposal
  return (
    <>
      {goal.rules.map((r, i) => (
        <Row
          key={i}
          text={`${r.cue} → ${r.action}`}
          basis={r.tries ? t('ruleRecord', { tries: r.tries, hits: r.hits }) : undefined}
          // A rule that works less than half the time is the one worth rethinking.
          warn={r.tries >= 4 && r.hits / r.tries < 0.5}
        />
      ))}
      {proposal && (
        <Card variant="draft" className="mt-1 gap-2.5 px-3.5 py-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-draft-chip px-2 py-0.5 text-[11px] font-semibold text-draft-ink">{t('proposal')}</span>
            <span className="text-[13.5px] font-medium">
              {proposal.cue} → {proposal.action}
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-pretty text-muted-foreground">{proposal.why}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => decide(goal.id, true)}>
              {t('acceptRule')}
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => decide(goal.id, false)}>
              {t('rejectRule')}
            </Button>
          </div>
        </Card>
      )}
    </>
  )
}

/** Recent tasks: what the user estimated next to what it took. */
function EstimateChart({ samples }: { samples: { estimated: number; actual: number }[] }) {
  const { t } = useTranslation('goals')
  const config = {
    estimated: { label: t('estimated'), color: 'var(--muted-foreground)' },
    actual: { label: t('actual'), color: 'var(--goal)' },
  } satisfies ChartConfig
  return (
    <ChartContainer config={config} className="mb-2 aspect-auto h-36 w-full">
      <BarChart data={samples} barGap={3} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <YAxis width={32} tickLine={false} axisLine={false} tickFormatter={(v) => String(v)} fontSize={11} />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        <Bar dataKey="estimated" fill="var(--color-estimated)" fillOpacity={0.35} radius={3} />
        <Bar dataKey="actual" fill="var(--color-actual)" radius={3} />
        <ChartLegend content={<ChartLegendContent />} />
      </BarChart>
    </ChartContainer>
  )
}

/**
 * Progress toward the goal. Only work that was done counts, never what's
 * planned. With `showPlanned`, what's scheduled this week but not done yet is
 * drawn as a hatched segment after it, visibly weaker than the solid part.
 */
function GoalProgress({ goal, className, showPlanned }: { goal: Goal; className?: string; showPlanned?: boolean }) {
  const { t } = useTranslation('goals')
  const done = (goal.progress.done / goal.progress.total) * 100
  const planned = Math.min(100 - done, (goal.week.planned / goal.progress.total) * 100)
  return (
    <ProgressPrimitive.Root value={Math.round(done)} aria-label={t('progress', { goal: goal.name })}>
      <ProgressTrack className={cn('relative rounded-full bg-goal-tint', className)}>
        <ProgressIndicator className="rounded-full bg-goal" />
        {showPlanned && planned > 0 && (
          <span
            aria-hidden
            className="absolute inset-y-0 bg-[repeating-linear-gradient(135deg,color-mix(in_oklch,var(--goal)_45%,transparent)_0_3px,transparent_3px_6px)]"
            style={{ left: `${done}%`, width: `${planned}%` }}
          />
        )}
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}
