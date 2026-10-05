import { cn } from 'cn'
import { Check, Copy, Ellipsis, ExternalLink, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Disclosure } from '@/components/Disclosure'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import type { SpeechStatus } from '../../../../../shared/bridge'
import type { SpeechInventory, SpeechPackage, SpeechUpdate } from '../../../../../shared/speech'
import { message, run } from './data'
import { StepText } from './Progress'

const normalize = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-')
const CORE = 'standard-asr'
const short = (version: string) => (/^[0-9a-f]{40}$/.test(version) ? version.slice(0, 7) : version)

/** Where a package came from, as a person would name it. */
export function sourceText(p: SpeechPackage) {
  if (p.vcs === 'git' && p.source) return `${p.source}${p.revision ? ` @ ${p.revision}` : ''}${p.commit ? ` (${p.commit.slice(0, 7)})` : ''}`
  return p.source ?? `PyPI ${p.version}`
}

/**
 * Installs a Standard ASR engine plugin: a package name, a Git address or a
 * folder on this computer. Whatever models it brings show up in the list.
 */
export function AddEngine({ open, status, onClose }: { open: boolean; status: SpeechStatus | null; onClose: (installed?: string[]) => void }) {
  const { t } = useTranslation('settings')
  const [requirement, setRequirement] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  const install = async () => {
    setWorking(true)
    setError(null)
    const before = new Set((await window.jezo.speech.inventory().catch(() => null))?.models.map((m) => m.id) ?? [])
    try {
      await run({ kind: 'installPlugin', requirement: requirement.trim() })
      const after = await window.jezo.speech.inventory()
      const added = after.models.filter((m) => !before.has(m.id)).map((m) => m.id)
      toast(added.length ? t('speech.engines.installed', { count: added.length }) : t('speech.engines.installedNothing'))
      setRequirement('')
      onClose(added)
    } catch (e) {
      setError(message(e))
    } finally {
      setWorking(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && !working && (setError(null), onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('speech.engines.addTitle')}</DialogTitle>
          <DialogDescription>{t('speech.engines.addIntro')}</DialogDescription>
        </DialogHeader>
        <form
          id="add-engine"
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (requirement.trim() && !working) void install()
          }}
        >
          <Input
            value={requirement}
            onChange={(e) => setRequirement(e.target.value)}
            placeholder="std-faster-whisper @ git+https://github.com/standard-voice/std-faster-whisper.git"
            className="font-mono text-[13px]"
            aria-label={t('speech.engines.requirement')}
            autoFocus
            disabled={working}
          />
          <p className="text-xs text-muted-foreground">
            {t('speech.engines.requirementHint')}{' '}
            <a href="https://github.com/standard-voice" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
              {t('speech.engines.find')}
              <ExternalLink className="size-3" />
            </a>
          </p>
          {working && status?.step && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              <StepText status={status} />
            </p>
          )}
          {error && <ErrorText text={error} />}
        </form>
        <DialogFooter>
          <Button type="submit" form="add-engine" disabled={!requirement.trim() || working || (!!status?.step && !working)}>
            {working && <LoaderCircle className="animate-spin" />}
            {t('speech.engines.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A failure's first lines, with the rest folded away and copyable. */
export function ErrorText({ text }: { text: string }) {
  const { t } = useTranslation('settings')
  const lines = text.trim().split('\n')
  return (
    <div className="flex flex-col gap-1">
      <p className="line-clamp-3 text-[13px] break-words text-destructive">{lines.slice(-3).join('\n')}</p>
      {lines.length > 3 && (
        <Disclosure label={t('providers.details')} triggerClassName="text-xs">
          <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground" data-selectable>
            {text}
          </pre>
        </Disclosure>
      )}
    </div>
  )
}

/** The menu on an engine's heading: where it came from, and uninstalling it. */
export function EngineMenu({ plugin, inventory, active, disabled }: { plugin: SpeechPackage; inventory: SpeechInventory; active: string | null; disabled: boolean }) {
  const { t } = useTranslation('settings')
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const models = inventory.models.filter((m) => m.package === plugin.name)
  const usesActive = models.some((m) => m.id === active)
  const uninstall = async () => {
    setWorking(true)
    try {
      await run({ kind: 'uninstallPlugin', name: plugin.name })
      toast(t('speech.engines.uninstalled', { name: plugin.name }))
      setConfirming(false)
    } catch (e) {
      toast.error(t('speech.engines.uninstallFailed'), { description: message(e) })
    } finally {
      setWorking(false)
    }
  }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" className="text-muted-foreground" aria-label={t('speech.engines.menu', { name: plugin.name })} />}>
          <Ellipsis />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <div className="flex flex-col gap-0.5 px-2 py-1.5 text-xs text-muted-foreground">
            <span className="text-foreground">
              {plugin.name} {plugin.version}
            </span>
            <span className="break-all" data-selectable>
              {sourceText(plugin)}
            </span>
          </div>
          <DropdownMenuItem disabled={disabled} onClick={() => setConfirming(true)} variant="destructive">
            {t('speech.engines.uninstall')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={confirming} onOpenChange={(o) => !working && setConfirming(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('speech.engines.uninstallTitle', { name: plugin.name })}</DialogTitle>
            <DialogDescription>
              {t('speech.engines.uninstallBody', { count: models.length })}
              {usesActive && ` ${t('speech.engines.uninstallActive')}`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" disabled={working} onClick={() => setConfirming(false)}>
              {t('providers.cancel')}
            </Button>
            <Button variant="destructive" disabled={working} onClick={uninstall}>
              {working && <LoaderCircle className="animate-spin" />}
              {t('speech.engines.uninstall')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Checks Standard ASR, the engines and what they depend on for newer
 * versions, and updates the ones the user picks together, so a new core
 * and the engines written for it arrive at once.
 */
export function Updates({ open, inventory, status, onClose }: { open: boolean; inventory: SpeechInventory | null; status: SpeechStatus | null; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string> | null>(null)

  const check = () => {
    setChecking(true)
    setError(null)
    setPicked(null)
    run({ kind: 'checkUpdates' })
      .catch((e) => setError(message(e)))
      .finally(() => setChecking(false))
  }
  useEffect(() => {
    if (open) check()
    // Checked again each time it opens, since the answer goes stale fast.
  }, [open])

  const updates = inventory?.updates ?? []
  const available = updates.filter((u) => u.requirement)
  const main = new Set([CORE, ...(inventory?.plugins ?? []).map((p) => normalize(p.name))])
  const isMain = (u: SpeechUpdate) => main.has(normalize(u.name))
  // The core and the engines start picked; other packages only when asked for.
  const chosen = picked ?? new Set(available.filter(isMain).map((u) => u.name))
  const toggle = (name: string) => {
    const next = new Set(chosen)
    if (next.has(name)) next.delete(name)
    else next.add(name)
    setPicked(next)
  }
  const update = async () => {
    setUpdating(true)
    setError(null)
    try {
      await run({ kind: 'updatePackages', names: [...chosen] })
      toast(t('speech.updates.done', { count: chosen.size }))
      setPicked(null)
      onClose()
    } catch (e) {
      setError(message(e))
    } finally {
      setUpdating(false)
    }
  }
  const old = inventory?.runtime && (!inventory.runtime.stableText || !inventory.runtime.sessionCapabilityChecks)
  const failed = updates.filter((u) => u.error)
  const row = (u: SpeechUpdate) => (
    <label key={u.name} className="flex items-center gap-3 px-3.5 py-2 text-[13px]">
      <input type="checkbox" className="size-3.5 accent-foreground" checked={chosen.has(u.name)} onChange={() => toggle(u.name)} disabled={updating} />
      <span className="min-w-0 flex-1 truncate">{u.name}</span>
      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
        {short(u.current)} → {short(u.latest ?? '')}
      </span>
    </label>
  )
  const busyElsewhere = !!status?.step && !checking && !updating

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !updating && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('speech.updates.title')}</DialogTitle>
          <DialogDescription>{t('speech.updates.intro')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {old && <p className="rounded-xl bg-muted px-3.5 py-2.5 text-[13px] text-pretty">{t('speech.updates.oldCore')}</p>}
          {checking ? (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              {t('speech.updates.checking')}
            </p>
          ) : available.length === 0 ? (
            <p className="text-[13.5px]">{inventory?.checkedAt ? t('speech.updates.none') : t('speech.updates.notChecked')}</p>
          ) : (
            <>
              {!available.some(isMain) && <p className="text-[13.5px]">{t('speech.updates.mainCurrent')}</p>}
              {available.some(isMain) && <ul className="flex flex-col divide-y divide-card-border rounded-xl border border-card-border">{available.filter(isMain).map(row)}</ul>}
              {available.some((u) => !isMain(u)) && (
                <Disclosure label={t('speech.updates.dependencies', { count: available.filter((u) => !isMain(u)).length })} triggerClassName="text-xs" defaultOpen={!available.some(isMain)}>
                  <ul className="mt-1.5 flex flex-col divide-y divide-card-border rounded-xl border border-card-border">{available.filter((u) => !isMain(u)).map(row)}</ul>
                </Disclosure>
              )}
            </>
          )}
          {failed.length > 0 && !checking && (
            <Disclosure label={t('speech.updates.failed', { count: failed.length })} triggerClassName="text-xs">
              <ul className="mt-1.5 flex flex-col gap-1 text-[12px] text-muted-foreground">
                {failed.map((u) => (
                  <li key={u.name} className="break-words">
                    <span className="text-foreground">{u.name}</span>: {u.error}
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
          {updating && status?.step && (
            <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
              <LoaderCircle className="size-3.5 animate-spin" />
              <StepText status={status} />
            </p>
          )}
          {error && <ErrorText text={error} />}
          <p className="text-xs text-muted-foreground">{t('speech.updates.toolsNote')}</p>
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={checking || updating || busyElsewhere} onClick={check}>
            {t('speech.updates.checkAgain')}
          </Button>
          <Button disabled={!chosen.size || checking || updating || busyElsewhere} onClick={update}>
            {updating && <LoaderCircle className="animate-spin" />}
            {t('speech.updates.update', { count: chosen.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Everything to name this setup in a bug report: versions, sources, and what
 * the checks and recent recognition said. One button copies all of it.
 */
export function Diagnostics({ open, inventory, status, onClose }: { open: boolean; inventory: SpeechInventory | null; status: SpeechStatus | null; onClose: () => void }) {
  const { t } = useTranslation('settings')
  const [running, setRunning] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const done = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(done)
  }, [copied])
  if (!inventory) return null

  const yes = (on: boolean | undefined) => (on ? t('speech.diagnostics.yes') : t('speech.diagnostics.no'))
  const rows: [string, string][] = [
    ['Standard ASR', inventory.core ? `${inventory.core.version} · ${sourceText(inventory.core)}` : t('speech.diagnostics.missing')],
    ...inventory.plugins.map((p): [string, string] => [p.name, `${p.version} · ${sourceText(p)}`]),
    ['Python', inventory.python ?? t('speech.diagnostics.missing')],
    ['uv', inventory.uv ?? t('speech.diagnostics.missing')],
    [t('speech.diagnostics.stableText'), yes(inventory.runtime?.stableText)],
    [t('speech.diagnostics.sessionChecks'), yes(inventory.runtime?.sessionCapabilityChecks)],
    [t('speech.diagnostics.model'), status?.model ?? t('speech.diagnostics.none')],
  ]
  const text = [
    ...rows.map(([k, v]) => `${k}: ${v}`),
    ...(inventory.diagnostics.length ? ['', ...inventory.diagnostics] : []),
    ...(inventory.sessionDiagnostics.length ? ['', ...inventory.sessionDiagnostics.map((d) => `${d.model} ${d.diagnostic.level} ${d.diagnostic.code}: ${d.diagnostic.message}`)] : []),
  ].join('\n')
  const diagnose = () => {
    setRunning(true)
    run({ kind: 'diagnose' })
      .catch((e) => toast.error(message(e)))
      .finally(() => setRunning(false))
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('speech.diagnostics.title')}</DialogTitle>
          <DialogDescription>{t('speech.diagnostics.intro')}</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-4 overflow-auto">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="font-mono text-[12px] break-all" data-selectable>
                  {v}
                </dd>
              </div>
            ))}
          </dl>
          {inventory.diagnostics.map((d, i) => (
            <pre key={i} className="rounded-lg bg-muted px-3 py-2 font-mono text-[11.5px] whitespace-pre-wrap text-muted-foreground" data-selectable>
              {d.trim() || t('speech.diagnostics.empty')}
            </pre>
          ))}
          <section className="flex flex-col gap-1.5">
            <h3 className="text-[13px] font-medium">{t('speech.diagnostics.session')}</h3>
            {inventory.sessionDiagnostics.length === 0 ? (
              <p className="text-[12.5px] text-muted-foreground">{t('speech.diagnostics.sessionNone')}</p>
            ) : (
              <ul className="flex flex-col divide-y divide-card-border rounded-xl border border-card-border">
                {[...inventory.sessionDiagnostics].reverse().map(({ model, diagnostic }, i) => (
                  <li key={i} className="flex flex-col gap-0.5 px-3.5 py-2 text-[12.5px]">
                    <span className="flex gap-2">
                      <span className={cn('font-mono', diagnostic.level === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{diagnostic.level}</span>
                      <span className="font-mono">{diagnostic.code}</span>
                      <span className="flex-1 truncate text-right text-muted-foreground">{model}</span>
                    </span>
                    <span className="text-pretty" data-selectable>
                      {diagnostic.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t('speech.diagnostics.sessionHint')}</p>
          </section>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => navigator.clipboard.writeText(text).then(() => setCopied(true))}>
            {copied ? <Check /> : <Copy />}
            {copied ? t('about.copied') : t('about.copy')}
          </Button>
          <Button variant="outline" disabled={running || !!status?.step || !inventory.core} onClick={diagnose}>
            {running && <LoaderCircle className="animate-spin" />}
            {t('speech.diagnostics.run')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
