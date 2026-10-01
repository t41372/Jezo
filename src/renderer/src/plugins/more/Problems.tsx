import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { useStore } from '@/data/store'
import type { Item } from '../../../../shared/workspace'
import { SectionHeader } from './parts'

/** Item files that don't match their manifest, or whose id was changed; kept current as files change. */
export function useProblems() {
  const [items, setItems] = useState<Item[]>([])
  useEffect(() => {
    const load = () => window.jezo.workspace.list().then((all) => setItems(all.filter((i) => i.problems?.length)))
    load()
    return window.jezo.workspace.onChange(load)
  }, [])
  return items
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
  const name = (i: Item) => String(i.data.title ?? i.data.name ?? i.path)
  return (
    <>
      <SectionHeader title={t('sections.problems.title')}>{t('problems.intro')}</SectionHeader>
      <ListCard>
        {items.map((i) => (
          <div key={i.path} className="flex items-start gap-3 px-4 py-3.5" data-problem={i.path}>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-medium">{name(i)}</div>
              <div className="mt-0.5 font-mono text-[12px] break-all text-muted-foreground">{i.path}</div>
              <Disclosure label={t('problems.count', { count: i.problems!.length })} className="mt-1" triggerClassName="text-[12.5px]">
                <ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted-foreground" data-selectable>
                  {i.problems!.map((p) => <li key={p}>{p}</li>)}
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
