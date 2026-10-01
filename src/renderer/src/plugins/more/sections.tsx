import { cn } from 'cn'
import { useTranslation } from 'react-i18next'
import { Diff } from '@/components/Diff'
import { Disclosure } from '@/components/Disclosure'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useStore } from '@/data/store'
import type { Memory } from '@/data/types'
import { dayLabel, dayTime } from '@/lib/time'
import { offerUndo } from '@/lib/undo'
import { ListCard, Row } from '@/components/ListCard'
import { CalendarConnections } from './CalendarConnections'
import { InstallDialog, RemoveSkillDialog, SkillSource } from './SkillDialogs'
import { SectionHeader } from './parts'
import { Installed } from './Installed'

export function Memories() {
  const { t } = useTranslation('more')
  const memories = useStore((s) => s.memories)
  const today = useStore((s) => s.now.date)
  const { deleteMemory, restoreMemory } = useStore.getState()
  const remove = (m: Memory) => {
    const index = memories.indexOf(m)
    deleteMemory(m.id)
    offerUndo(t('undo.memoryDeleted', { ns: 'common' }), () => restoreMemory(m, index))
  }
  const groups = [
    { title: t('memory.stated'), items: memories.filter((m) => m.kind === 'stated') },
    { title: t('memory.inferred'), items: memories.filter((m) => m.kind === 'inferred') },
  ]
  const source = (m: Memory) =>
    m.kind === 'inferred'
      ? t('memory.evidence', { count: m.evidence ?? 0, confidence: t(`memory.confidence.${m.confidence ?? 'low'}`) })
      : m.via
        ? t('memory.statedIn', { day: dayLabel(m.date, today), where: t(`trigger.${m.via}.title`, { ns: 'common' }) })
        : dayLabel(m.date, today)

  return (
    <>
      <SectionHeader title={t('sections.memory.title')}>{t('memory.intro')}</SectionHeader>
      {groups.map(
        (g) =>
          g.items.length > 0 && (
            <section key={g.title} className="flex flex-col gap-2">
              <h2 className="mt-1.5 text-xs text-muted-foreground">{g.title}</h2>
              <ListCard>
                {g.items.map((m) => (
                  <Row key={m.id} title={<span className="font-normal">{m.text}</span>} description={source(m)}>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => remove(m)}>
                      {t('memory.delete')}
                    </Button>
                  </Row>
                ))}
              </ListCard>
            </section>
          ),
      )}
    </>
  )
}

export function Skills() {
  const { t } = useTranslation('more')
  const skills = useStore((s) => s.skills)
  const { toggleSkill, navigate } = useStore.getState()
  return (
    <>
      <SectionHeader title={t('sections.skills.title')} action={<InstallDialog />}>{t('skills.intro')}</SectionHeader>
      <Installed />
      <h2 className="mt-1.5 text-xs text-muted-foreground">{t('install.methods')}</h2>
      <ListCard>
        {skills.map((k) => (
          <div
            key={k.id}
            className="flex items-center gap-3 px-4 py-3.5 transition-colors duration-150 has-[>button:hover]:bg-muted has-[>button:active]:bg-foreground/8"
          >
            <button onClick={() => navigate('more', `skill:${k.id}`)} className="min-w-0 flex-1 text-left">
              <div className="flex items-center gap-2 text-[14.5px] font-medium">
                {k.title}
                {k.proposal && <Badge className="bg-draft-chip text-draft-ink">{t('skills.proposalBadge')}</Badge>}
              </div>
              <div className="mt-0.5 text-[12.5px] text-pretty text-muted-foreground">{k.description}</div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground"><SkillSource skill={k} /></div>
            </button>
            <Switch checked={k.enabled} onCheckedChange={() => toggleSkill(k.id)} aria-label={k.title} />
          </div>
        ))}
      </ListCard>
      <p className="text-[13px] text-muted-foreground">{t('skills.tip')}</p>
    </>
  )
}

/** One method: its instructions to the agent, and any change the agent wants to make to them. */
export function SkillView({ id }: { id: string }) {
  const { t } = useTranslation('more')
  const skill = useStore((s) => s.skills.find((k) => k.id === id))
  const { toggleSkill, decideSkillProposal, navigate } = useStore.getState()
  if (!skill) return null

  return (
    <>
      <button onClick={() => navigate('more', 'skills')} className="self-start text-[13px] text-muted-foreground hover:text-foreground transition-colors duration-150">
        {t('skills.back')}
      </button>
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h1 className="text-[26px] font-semibold tracking-tight">{skill.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
        </div>
        <Switch checked={skill.enabled} onCheckedChange={() => toggleSkill(skill.id)} aria-label={skill.title} className="mt-2.5" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[13px] text-muted-foreground"><SkillSource skill={skill} /></span>
        {skill.updatable && <InstallDialog update={skill} />}
        {skill.removable && <RemoveSkillDialog skill={skill} />}
      </div>
      {skill.origin && /^https?:\/\//.test(skill.origin.source) && (
        <a href={skill.origin.source} target="_blank" rel="noreferrer" className="self-start break-all text-[12.5px] text-muted-foreground underline underline-offset-2">
          {skill.origin.source}
        </a>
      )}
      {skill.programs && <p className="text-[13px] leading-relaxed text-muted-foreground">{t('skills.programs')}</p>}

      {skill.proposal && (
        <Card variant="draft" className="gap-3 px-4 py-3.5">
          <div className="text-sm font-semibold">{t('skills.proposal')}</div>
          <p className="text-[13.5px] leading-relaxed text-pretty">{skill.proposal.why}</p>
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {t('skills.basedOn')}
            {skill.proposal.evidence.map((e) => (
              <span key={e} className="rounded-md bg-draft-chip px-2 py-0.5 text-draft-ink">
                {e}
              </span>
            ))}
          </div>
          <Diff lines={skill.proposal.diff} className="bg-background/60" />
          <div className="flex gap-2">
            <Button onClick={() => decideSkillProposal(skill.id, true)}>{t('skills.apply')}</Button>
            <Button variant="ghost" className="text-muted-foreground" onClick={() => decideSkillProposal(skill.id, false)}>
              {t('skills.reject')}
            </Button>
          </div>
        </Card>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {t('skills.file')}
          <code className="font-mono">{skill.id}/SKILL.md</code>
          {skill.reviewed && <span className="text-ok">· {t('skills.reviewed')}</span>}
        </div>
        <Card className="py-0">
          <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-[1.75] whitespace-pre-wrap" data-selectable>
            {skill.instructions}
          </pre>
        </Card>
      </section>
      <p className="text-[13px] text-muted-foreground">{t('skills.tip')}</p>
    </>
  )
}

export function History() {
  const { t } = useTranslation('more')
  const history = useStore((s) => s.history)
  const today = useStore((s) => s.now.date)
  const undo = useStore((s) => s.undo)
  return (
    <>
      <SectionHeader title={t('sections.history.title')}>{t('history.intro')}</SectionHeader>
      <ListCard>
        {history.map((h) => (
          <div key={h.id} className="flex items-start gap-3 px-4 py-3.5" data-history={h.id}>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">
                {dayTime(h.date, h.time, today)} · {t(`history.source.${h.source}`)}
                {h.interrupted && <span className="text-warn"> · {t('history.interrupted')}</span>}
              </div>
              <div className={cn('mt-0.5 text-[14.5px]', h.undone && 'text-muted-foreground line-through')}>{h.summary || (h.found ? t('history.foundSummary') : h.interrupted ? t('history.interruptedSummary') : '')}</div>
              {/* Cut off mid-way: the conversation can pick up from the files as they are, not from the start. */}
              {h.interrupted && h.session && !h.undone && (
                <button
                  className="mt-1 text-[12.5px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                  onClick={() => useStore.getState().openSession(h.session!, t('history.continuePrefill'))}
                >
                  {t('history.continue')}
                </button>
              )}
              {h.check && (
                <div className="mt-0.5 text-[12.5px] text-warn">
                  {t('history.retried', { count: h.check.retries })}
                </div>
              )}
              {h.files && (
                <Disclosure label={t('history.files', { count: h.files.length })} className="mt-1.5" triggerClassName="text-xs">
                  <div className="flex flex-col gap-2.5 pt-2">
                    {h.files.map((f) => (
                      <div key={f.path} className="flex flex-col gap-1">
                        <code className="font-mono text-[11.5px] text-muted-foreground">{f.path}</code>
                        <Diff lines={f.lines} />
                        {f.note && <div className="text-[12px] text-warn">{f.note}</div>}
                      </div>
                    ))}
                  </div>
                </Disclosure>
              )}
            </div>
            {h.undone ? (
              <span className="text-[12.5px] text-muted-foreground">{t('history.undone')}</span>
            ) : (
              <Button variant="outline" size="sm" onClick={() => undo(h.id)}>
                {t('history.undo')}
              </Button>
            )}
          </div>
        ))}
      </ListCard>
    </>
  )
}

export function Connections() {
  const { t } = useTranslation('more')
  const navigate = useStore((s) => s.navigate)
  return (
    <>
      <SectionHeader title={t('sections.connections.title')}>{t('connections.intro')}</SectionHeader>
      <CalendarConnections />
      {/* Other services come in as MCP servers or pi packages, through the one install entry (extensions.md). */}
      <p className="text-[13px] text-muted-foreground">
        {t('connections.others')}{' '}
        <button className="underline underline-offset-2 hover:text-foreground" onClick={() => navigate('more', 'skills')}>
          {t('connections.toInstalled')}
        </button>
      </p>
      <p className="text-[13px] text-muted-foreground">{t('connections.outside')}</p>
    </>
  )
}
