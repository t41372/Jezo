import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { Item } from '../../../../shared/workspace'
import { SectionHeader } from './parts'

/** A file with problems: its name, path, and what's wrong. */
interface Problem {
  path: string
  name: string
  problems: string[]
}

/**
 * Files Jezo can't fully read, kept current as they change: item files that don't
 * match their manifest or whose id was changed, and automation histories with
 * lines that can't be read, which keep that automation from starting on its own.
 */
export function useProblems() {
  const { t } = useTranslation('more')
  const [files, setFiles] = useState<Problem[]>([])
  useEffect(() => {
    const name = (i: Item) => String(i.data.title ?? i.data.name ?? i.path)
    const load = async () => {
      const [items, histories] = await Promise.all([window.jezo.workspace.list(), window.jezo.schedule.problems()])
      const byPath = new Map<string, Problem>()
      for (const h of histories) {
        const file = byPath.get(h.path) ?? { path: h.path, name: t('problems.history'), problems: [] }
        file.problems.push(t('problems.line', { line: h.line, message: h.message }))
        byPath.set(h.path, file)
      }
      setFiles([...items.filter((i) => i.problems?.length).map((i) => ({ path: i.path, name: name(i), problems: i.problems! })), ...byPath.values()])
    }
    void load()
    const stops = [window.jezo.workspace.onChange(() => void load()), window.jezo.schedule.onHistory(() => void load())]
    return () => stops.forEach((stop) => stop())
  }, [t])
  return files
}

/**
 * Files the app can't fully read. They're still shown where they belong; this
 * says what's wrong. The messages are the ones the agent gets, so the fix is to
 * hand it to the agent.
 */
export function Problems() {
  const { t } = useTranslation('more')
  const items = useProblems()
  const { openSession } = useStore.getState()
  return (
    <>
      <SectionHeader title={t('sections.problems.title')}>{t('problems.intro')}</SectionHeader>
      <ListCard>
        {items.map((i) => (
          <div key={i.path} className="flex items-start gap-3 px-4 py-3.5" data-problem={i.path}>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-medium">{i.name}</div>
              <div className="mt-0.5 font-mono text-[12px] break-all text-muted-foreground">{i.path}</div>
              <Disclosure label={t('problems.count', { count: i.problems.length })} className="mt-1" triggerClassName="text-[12.5px]">
                <ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted-foreground" data-selectable>
                  {i.problems.map((p) => <li key={p}>{p}</li>)}
                </ul>
              </Disclosure>
            </div>
            <Button variant="outline" size="sm" onClick={() => openSession(null, t('problems.fixPrefill', { path: i.path }))}>
              {t('problems.fix')}
            </Button>
          </div>
        ))}
      </ListCard>
      {items.length === 0 && <p className="text-[13px] text-muted-foreground">{t('problems.none')}</p>}
    </>
  )
}
