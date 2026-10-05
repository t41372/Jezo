import { cn } from 'cn'
import { ArrowLeft, Check, Ellipsis, LoaderCircle, Plus, Search } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useStore } from '@/data/store'
import type { SpeechInventory, SpeechModel, SpeechPackage } from '../../../../../shared/speech'
import { message, run, useInventory, useSpeechStatus } from './data'
import { AddEngine, Diagnostics, EngineMenu, ErrorText, Updates } from './Engines'
import { useDrafted } from './SettingsForm'
import { ModelPane } from './ModelPane'
import { StepText } from './Progress'

/**
 * Speech recognition's own page. The models come from the engines the user
 * installed, listed by engine; choosing one shows what it can do, its files
 * and its settings, and the way to make it the one ⌥X uses.
 */
export function SpeechPage() {
  const { t } = useTranslation('settings')
  const navigate = useStore((s) => s.navigate)
  const status = useSpeechStatus()
  const { inventory, error } = useInventory(status)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [dialog, setDialog] = useState<'add' | 'updates' | 'diagnostics' | null>(null)
  const drafted = useDrafted()
  const busy = !!status?.step

  const models = inventory?.models ?? []
  // A model that left with its engine falls back to the one ⌥X uses.
  const exists = (id: string | null | undefined) => (id && models.some((m) => m.id === id) ? id : null)
  const current = exists(selected) ?? exists(status?.model) ?? models[0]?.id ?? null
  const shown = models.filter((m) => `${m.name} ${m.id} ${m.package}`.toLowerCase().includes(query.toLowerCase()))
  const groups = (inventory?.plugins ?? []).map((p) => ({ plugin: p, models: shown.filter((m) => m.package === p.name) })).filter((g) => g.models.length || !query)

  return (
    <div className="flex min-h-0 flex-1 flex-col px-10 py-9">
      <div className="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col gap-4">
        <button
          onClick={() => navigate('settings')}
          className="flex items-center gap-1.5 self-start text-[13px] text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t('heading')}
        </button>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <h1 className="text-[26px] font-semibold tracking-tight">{t('speech.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('speech.intro')}</p>
          </div>
          {status?.installed && (
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={() => setDialog('updates')}>
                {t('speech.checkUpdates')}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('speech.more')} />}>
                  <Ellipsis />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem disabled={busy} onClick={() => void run({ kind: 'refresh' }).catch(() => {})}>
                    {t('speech.refresh')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setDialog('diagnostics')}>{t('speech.diagnostics.title')}</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
        {inventory && <OldCore inventory={inventory} busy={busy} onUpdate={() => setDialog('updates')} />}
        {status?.step && (
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            <StepText status={status} />
          </p>
        )}
        {!status?.step && (status?.error || error) && <ErrorText text={message(status?.error || error)} />}
        {status && !status.installed && !busy ? (
          <NotInstalled uv={status.uv} onOther={() => setDialog('add')} />
        ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-card-border bg-card">
          <nav className="flex w-64 shrink-0 flex-col gap-3 overflow-auto border-r border-card-border p-2.5">
            {models.length > 8 && (
              <label className="relative flex items-center">
                <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('speech.search')} className="h-8 bg-muted/70 pl-8 text-[13px] md:text-[13px] dark:bg-muted/70" />
              </label>
            )}
            {groups.map(({ plugin, models }) => (
              <EngineGroup key={plugin.name} plugin={plugin} menu={inventory && <EngineMenu plugin={plugin} inventory={inventory} active={status?.model ?? null} disabled={busy} />}>
                {models.map((m) => (
                  <ModelItem key={m.id} model={m} active={m.id === status?.model} selected={m.id === current} drafted={drafted(m.id)} onSelect={() => setSelected(m.id)} />
                ))}
              </EngineGroup>
            ))}
            {inventory && !inventory.plugins.length && <p className="px-2.5 text-[12.5px] text-muted-foreground">{t('speech.noEngines')}</p>}
            <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" disabled={busy} onClick={() => setDialog('add')}>
              <Plus />
              {t('speech.addEngine')}
            </Button>
          </nav>
          <div className="min-w-0 flex-1 overflow-auto">{current && status && <ModelPane key={current} id={current} status={status} />}</div>
        </div>
        )}
      </div>
      <AddEngine open={dialog === 'add'} status={status} onClose={(added) => (setDialog(null), added?.[0] && setSelected(added[0]))} />
      <Updates open={dialog === 'updates'} inventory={inventory} status={status} onClose={() => setDialog(null)} />
      <Diagnostics open={dialog === 'diagnostics'} inventory={inventory} status={status} onClose={() => setDialog(null)} />
    </div>
  )
}

/**
 * Standard ASR changed what a session promises without changing its version
 * number, so an older install is named here, with the way to update. It's
 * never updated on its own.
 */
function OldCore({ inventory, busy, onUpdate }: { inventory: SpeechInventory; busy: boolean; onUpdate: () => void }) {
  const { t } = useTranslation('settings')
  const runtime = inventory.runtime
  if (!runtime || (runtime.stableText && runtime.sessionCapabilityChecks)) return null
  return (
    <div className="flex items-center gap-3 rounded-xl bg-muted px-3.5 py-2.5 text-[13px]">
      <p className="flex-1 text-pretty">{t('speech.oldCore')}</p>
      <Button size="sm" variant="outline" disabled={busy} onClick={onUpdate}>
        {t('speech.checkUpdates')}
      </Button>
    </div>
  )
}

/** Before anything is installed: the one-click setup, or an engine of the user's choosing. */
function NotInstalled({ uv, onOther }: { uv: boolean; onOther: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl border border-card-border bg-card p-6">
      <p className="text-[14px] text-pretty">{uv ? t('speech.installHint') : t('speech.needsUv')}</p>
      <div className="flex items-center gap-2">
        <Button disabled={!uv} onClick={() => window.jezo.speech.install().catch(() => {})}>
          {t('speech.install')}
        </Button>
        <Button variant="ghost" disabled={!uv} onClick={onOther}>
          {t('speech.installOther')}
        </Button>
      </div>
    </div>
  )
}

function EngineGroup({ plugin, menu, children }: { plugin: SpeechPackage; menu: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1 px-2.5 pb-1 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate" title={`${plugin.name} ${plugin.version}`}>
          {plugin.name}
        </span>
        {menu}
      </div>
      {children}
    </div>
  )
}

function ModelItem({ model, active, selected, drafted, onSelect }: { model: SpeechModel; active: boolean; selected: boolean; drafted: boolean; onSelect: () => void }) {
  const { t } = useTranslation('settings')
  return (
    <button
      onMouseDown={(e) => e.preventDefault()}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] outline-none transition-colors duration-150 hover:bg-muted/70 active:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-muted',
        model.error && 'text-muted-foreground',
      )}
    >
      <span className="flex-1 truncate">{model.name}</span>
      {drafted && <span className="shrink-0 text-[11px] text-muted-foreground">{t('speech.unsaved')}</span>}
      {model.error ? <span className="size-2 shrink-0 rounded-full bg-destructive" /> : active && <Check className="size-3.5 shrink-0 text-ok" strokeWidth={2.5} />}
    </button>
  )
}
