import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useStore } from '@/data/store'
import { ListCard } from '@/components/ListCard'
import { Connections, Experiments, History, Memories, SkillView, Skills } from './sections'

const SECTIONS = {
  memory: Memories,
  skills: Skills,
  experiments: Experiments,
  history: History,
  connections: Connections,
} as const

type SectionId = keyof typeof SECTIONS

/** How the agent works and how to adjust it. Nothing here is needed for everyday use. */
export function More() {
  const sub = useStore((s) => s.nav.sub)
  const Section = sub && SECTIONS[sub as SectionId]
  const skillId = sub?.startsWith('skill:') ? sub.slice('skill:'.length) : null

  return (
    <div className="flex-1 overflow-auto px-10 py-9">
      <div className="mx-auto flex max-w-[620px] flex-col gap-4.5">{skillId ? <SkillView id={skillId} /> : Section ? <Section /> : <Index />}</div>
    </div>
  )
}

function Index() {
  const { t } = useTranslation('more')
  const s = useStore()
  const counts: Record<SectionId, string> = {
    memory: String(s.memories.length),
    skills: '',
    experiments: t('counts.experiments', { count: s.experiments.filter((x) => !x.finished).length }),
    history: '',
    connections: t('counts.connections', { count: s.connections.filter((c) => c.connected).length }),
  }

  return (
    <>
      <h1 className="text-[30px] font-semibold tracking-tight">{t('heading')}</h1>
      <p className="-mt-2 text-sm text-muted-foreground">{t('intro')}</p>
      <ListCard>
        {(Object.keys(SECTIONS) as SectionId[]).map((id) => (
          <button
            key={id}
            onClick={() => s.navigate('more', id)}
            className="flex items-center gap-3 px-4 py-3.5 text-left outline-none transition-colors duration-150 hover:bg-muted active:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <div className="flex-1">
              <div className="text-[15px] font-medium">{t(`sections.${id}.title`)}</div>
              <div className="mt-0.5 text-[12.5px] text-muted-foreground">{t(`sections.${id}.description`)}</div>
            </div>
            <span className="text-[12.5px] text-muted-foreground tabular-nums">{counts[id]}</span>
            <ChevronRight className="size-4 text-muted-foreground" />
          </button>
        ))}
      </ListCard>
    </>
  )
}
