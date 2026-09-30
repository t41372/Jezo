import { cn } from 'cn'
import { ArrowLeft, Check, ExternalLink, LoaderCircle, Plus, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { useStore } from '@/data/store'
import type { ProviderDetail, ProviderSummary } from '../../../../shared/bridge'
import { Capabilities } from './Capabilities'
import { useProviders } from './ModelsCard'

/**
 * Every provider of models in one list, with no split between local and
 * cloud: the ones that work on top, the rest below. Choosing one shows its
 * address, key, a connection test and its models.
 */
export function Providers() {
  const { t } = useTranslation('settings')
  const { providers } = useProviders()
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const navigate = useStore((s) => s.navigate)

  const current = selected ?? providers.find((p) => p.state !== 'off')?.id ?? providers[0]?.id ?? null
  const shown = providers.filter((p) => p.name.toLowerCase().includes(query.toLowerCase()))
  const working = shown.filter((p) => p.state !== 'off' || p.kind === 'custom')
  const popular = shown.filter((p) => p.state === 'off' && p.kind !== 'custom' && (p.popular || p.kind === 'local'))
  const rest = shown.filter((p) => p.state === 'off' && p.kind === 'cloud' && !p.popular)

  const item = (p: ProviderSummary) => (
    <button
      key={p.id}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => setSelected(p.id)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] outline-none transition-colors duration-150 hover:bg-muted/70 active:bg-foreground/8 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        p.id === current && 'bg-muted',
      )}
    >
      <span className="flex-1 truncate">{p.name}</span>
      <State state={p.state} />
    </button>
  )

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
            <h1 className="text-[26px] font-semibold tracking-tight">{t('providers.title')}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t('providers.intro')}</p>
          </div>
          <ImportFromPi />
        </div>
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-card-border bg-card">
          <nav className="flex w-60 shrink-0 flex-col gap-3 overflow-auto border-r border-card-border p-2.5">
            <label className="relative flex items-center">
              <Search className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('providers.search')} className="h-8 bg-muted/70 pl-8 text-[13px] md:text-[13px] dark:bg-muted/70" />
            </label>
            {working.length > 0 && <Group label={t('providers.working')}>{working.map(item)}</Group>}
            {popular.length > 0 && <Group label={t('providers.notSetUp')}>{popular.map(item)}</Group>}
            {rest.length > 0 &&
              (query ? (
                <Group label={t('providers.more')}>{rest.map(item)}</Group>
              ) : (
                <Disclosure label={t('providers.more')} className="px-2.5" triggerClassName="text-xs">
                  <div className="-mx-2.5 flex flex-col pt-1.5">{rest.map(item)}</div>
                </Disclosure>
              ))}
            <Button variant="ghost" size="sm" className="justify-start text-muted-foreground" onClick={() => setAdding(true)}>
              <Plus />
              {t('providers.add')}
            </Button>
          </nav>
          <div className="min-w-0 flex-1 overflow-auto">{current && <Provider key={current} id={current} onRemoved={() => setSelected(null)} />}</div>
        </div>
      </div>
      <AddProvider open={adding} onClose={(id) => (setAdding(false), id && setSelected(id))} />
    </div>
  )
}

/**
 * Copies what the user set up for their own pi (keys, their own servers, the
 * default model). Only when they press it: Jezo never reads ~/.pi otherwise.
 */
function ImportFromPi() {
  const { t } = useTranslation('settings')
  const [busy, setBusy] = useState(false)
  const run = () => {
    setBusy(true)
    window.jezo.providers
      .importFromPi()
      .then((r) => {
        const parts = [
          r.providers.length && t('providers.imported.providers', { names: r.providers.join('、') }),
          r.keys && t('providers.imported.keys', { count: r.keys }),
          r.model && t('providers.imported.model', { model: r.model }),
        ].filter(Boolean)
        toast(parts.length ? parts.join(' · ') : t('providers.imported.nothing'), {
          description: r.skipped.length ? t('providers.imported.skipped', { names: r.skipped.map((s) => s.name).join('、') }) : undefined,
        })
      })
      .finally(() => setBusy(false))
  }
  return (
    <Button variant="outline" size="sm" disabled={busy} onClick={run} title={t('providers.importHint')}>
      {busy && <LoaderCircle className="animate-spin" />}
      {t('providers.import')}
    </Button>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <div className="px-2.5 pb-1 text-xs text-muted-foreground">{label}</div>
      {children}
    </div>
  )
}

function State({ state }: { state: ProviderSummary['state'] }) {
  return <span className={cn('size-2 shrink-0 rounded-full', state === 'ready' ? 'bg-ok' : state === 'error' ? 'bg-destructive' : 'border border-foreground/25')} />
}

function Provider({ id, onRemoved }: { id: string; onRemoved: () => void }) {
  const { t } = useTranslation('settings')
  const [p, setP] = useState<ProviderDetail | null>(null)
  const [busy, setBusy] = useState<'check' | 'refresh' | null>(null)
  const [query, setQuery] = useState('')
  useEffect(() => {
    const load = () => window.jezo.providers.get(id).then(setP)
    load()
    return window.jezo.providers.onChange(load)
  }, [id])
  if (!p) return null

  const models = p.models.filter((m) => m.id.toLowerCase().includes(query.toLowerCase()))
  const run = (kind: 'check' | 'refresh', work: Promise<ProviderDetail>) => {
    setBusy(kind)
    work.then(setP).finally(() => setBusy(null))
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <header className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{p.name}</h2>
        <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
          <State state={p.state} />
          {t(`providers.state.${p.state}`)}
        </span>
        <span className="flex-1" />
        {p.kind === 'custom' && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => window.jezo.providers.remove(p.id).then(onRemoved)}>
            {t('providers.remove')}
          </Button>
        )}
      </header>

      {p.kind === 'local' && (
        <p className="-mt-3 text-[13px] text-muted-foreground">{p.state === 'ready' ? t('providers.localFound') : t('providers.localMissing', { name: p.name })}</p>
      )}

      {p.kind !== 'cloud' && (
        <Field label={t('providers.address')}>
          <SavedInput
            value={p.baseUrl ?? ''}
            placeholder={p.defaultBaseUrl}
            onSave={(url) => window.jezo.providers.setBaseUrl(p.id, url || p.defaultBaseUrl || '').then(setP)}
          />
        </Field>
      )}

      {(p.needsKey || p.kind === 'custom') && (
        <Field
          label={t('providers.key')}
          hint={
            p.keyUrl && !p.keyHint ? (
              <a href={p.keyUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                {t('providers.getKey')}
                <ExternalLink className="size-3" />
              </a>
            ) : (
              t('providers.keyHint')
            )
          }
        >
          <KeyInput detail={p} onChange={setP} />
        </Field>
      )}

      {p.models.length > 0 && p.state !== 'off' && <CheckRow detail={p} busy={busy === 'check'} onCheck={(model) => run('check', window.jezo.providers.check(p.id, model))} />}

      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">
            {t('providers.models')} <span className="text-muted-foreground tabular-nums">{p.models.length}</span>
          </h3>
          <span className="flex-1" />
          {p.models.length > 8 && (
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('models.search')} className="h-7 w-40 bg-muted/70 text-[13px] md:text-[13px] dark:bg-muted/70" />
          )}
          {p.canRefresh && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => run('refresh', window.jezo.providers.refresh(p.id))}>
              <RefreshCw className={cn(busy === 'refresh' && 'animate-spin')} />
              {t('providers.refresh')}
            </Button>
          )}
        </div>
        {p.models.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-5 text-center text-[13px] text-muted-foreground">{p.kind === 'cloud' ? t('providers.noModels') : t('providers.noServerModels')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-card-border rounded-xl border border-card-border">
            {models.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3.5 py-2">
                <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', !m.enabled && 'text-muted-foreground')} title={m.id}>
                  {m.name}
                </span>
                <Capabilities model={m} />
                <Switch checked={m.enabled} onCheckedChange={(on) => window.jezo.providers.setModelEnabled(p.id, m.id, on).then(setP)} aria-label={m.name} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

/** Saves when the field loses focus or on Enter. */
function SavedInput({ value, placeholder, onSave }: { value: string; placeholder?: string; onSave: (value: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const save = () => text.trim() !== value && onSave(text.trim())
  return (
    <Input
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && save()}
      className="h-8 font-mono text-[13px]"
    />
  )
}

/** A saved key is shown only by its last characters; replacing it means typing a new one. */
function KeyInput({ detail, onChange }: { detail: ProviderDetail; onChange: (d: ProviderDetail) => void }) {
  const { t } = useTranslation('settings')
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  if (detail.keyHint && !replacing) {
    return (
      <div className="flex items-center gap-2 text-[13px]">
        <Check className="size-3.5 text-ok" strokeWidth={2.5} />
        <span>{t('providers.keySaved')}</span>
        <span className="font-mono text-muted-foreground">{detail.keyHint}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
          {t('providers.keyReplace')}
        </Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => window.jezo.providers.setKey(detail.id, null).then(onChange)}>
          {t('providers.keyRemove')}
        </Button>
      </div>
    )
  }
  const save = () => {
    if (!key.trim()) return
    window.jezo.providers.setKey(detail.id, key.trim()).then(onChange)
    setKey('')
    setReplacing(false)
  }
  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={t('providers.keyPlaceholder')} className="h-7 flex-1" autoComplete="off" autoFocus={replacing} />
      <Button type="submit" size="sm" disabled={!key.trim()}>
        {t('providers.keySave')}
      </Button>
      {replacing && (
        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('providers.cancel')} onClick={() => setReplacing(false)}>
          <X />
        </Button>
      )}
    </form>
  )
}

/** Sends one word with a chosen model and says plainly whether it worked. */
function CheckRow({ detail, busy, onCheck }: { detail: ProviderDetail; busy: boolean; onCheck: (model: string) => void }) {
  const { t } = useTranslation('settings')
  const enabled = detail.models.filter((m) => m.enabled)
  const [model, setModel] = useState((enabled.find((m) => m.loaded) ?? enabled[0] ?? detail.models[0]).id)
  const result = detail.lastCheck
  return (
    <Field label={t('providers.check')}>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-64" />}>
            <span className="truncate">{model}</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72">
            <DropdownMenuRadioGroup value={model} onValueChange={(v) => setModel(v as string)}>
              {(enabled.length ? enabled : detail.models).map((m) => (
                <DropdownMenuRadioItem key={m.id} value={m.id} closeOnClick>
                  {m.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onCheck(model)}>
          {busy && <LoaderCircle className="animate-spin" />}
          {t('providers.checkRun')}
        </Button>
        {!busy && result && (
          <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', result.ok ? 'text-[color-mix(in_oklch,var(--ok)_70%,var(--foreground))]' : 'text-destructive')}>
            {result.ok ? t('providers.checkOk', { seconds: ((result.ms ?? 0) / 1000).toFixed(1) }) : t('providers.checkFailed')}
          </span>
        )}
      </div>
      {!busy && result && !result.ok && result.message && (
        <Disclosure label={t('providers.details')} triggerClassName="text-xs">
          <pre className="mt-1.5 rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground" data-selectable>
            {result.message}
          </pre>
        </Disclosure>
      )}
    </Field>
  )
}

/** A server that speaks the OpenAI API: a name and an address, and a key if it needs one. */
function AddProvider({ open, onClose }: { open: boolean; onClose: (id?: string) => void }) {
  const { t } = useTranslation('settings')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [key, setKey] = useState('')
  const reset = () => (setName(''), setBaseUrl(''), setKey(''))
  const add = () =>
    window.jezo.providers.addCustom({ name, baseUrl, key: key || undefined }).then((p) => {
      reset()
      onClose(p.id)
    })
  return (
    <Dialog open={open} onOpenChange={(o) => !o && (reset(), onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('providers.addTitle')}</DialogTitle>
        </DialogHeader>
        <form
          id="add-provider"
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && baseUrl.trim()) add()
          }}
        >
          <Field label={t('providers.name')}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vLLM" autoFocus />
          </Field>
          <Field label={t('providers.address')} hint={t('providers.addressHint')}>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="http://localhost:8000/v1" className="font-mono text-[13px]" />
          </Field>
          <Field label={t('providers.key')} hint={t('providers.keyOptional')}>
            <Input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
          </Field>
        </form>
        <DialogFooter>
          <Button type="submit" form="add-provider" disabled={!name.trim() || !baseUrl.trim()}>
            {t('providers.addConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
