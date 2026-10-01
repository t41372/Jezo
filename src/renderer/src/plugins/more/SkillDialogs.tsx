// One install entry, using the same dialog and error style as calendars.
// The main process keeps the files between reading a source and installing it.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkillInfo, SkillInstallResult, SkillPreview, SkillSkipped } from '../../../../shared/skills'
import type { InstallPreview } from '../../../../shared/install'
import { INSTALL_SUGGESTIONS } from '../../../../shared/install-suggestions'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { useStore } from '@/data/store'

const reason = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

export function SkillSource({ skill }: { skill: Pick<SkillInfo, 'origin'> }) {
  const { t } = useTranslation('more')
  const origin = skill.origin
  let source = t('skills.builtin')
  if (origin?.source === 'written') source = t('skills.written')
  else if (origin?.source === 'this computer') source = t('skills.localSource')
  else if (origin) {
    let url: URL | undefined
    try { url = new URL(origin.source) } catch { /* Show the owner's source as written. */ }
    const address = url?.hostname === 'github.com' ? `github.com/${url.pathname.split('/').slice(1, 3).join('/')}` : url?.host ?? origin.source
    source = t('skills.from', { source: address })
  }
  return <>{origin?.by === 'agent' ? t('skills.agentSource', { source }) : source}</>
}

function SkippedFiles({ skipped }: { skipped: SkillSkipped[] }) {
  const { t } = useTranslation('more')
  return <>{skipped.map((s) => <p key={s.reason} className="text-[12.5px] leading-relaxed text-muted-foreground">{t('skills.skipped', { count: s.count, reason: s.reason })}</p>)}</>
}

export function InstallDialog({ update }: { update?: SkillInfo }) {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'url' | 'local' | 'write'>('url')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [preview, setPreview] = useState<SkillPreview | null>(null)
  const [extraPreview, setExtraPreview] = useState<Exclude<InstallPreview, { kind: 'skill' }> | null>(null)
  const [extraResult, setExtraResult] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [conflicts, setConflicts] = useState<string[]>([])
  const [modified, setModified] = useState(false)
  const [replace, setReplace] = useState(false)
  const [overwriteModified, setOverwriteModified] = useState(false)
  const [result, setResult] = useState<SkillInstallResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clearPreview = () => {
    if (preview) void window.jezo.skills.discard(preview.token)
    if (extraPreview) void window.jezo.install.discard(extraPreview.token)
    setPreview(null)
    setExtraPreview(null)
    setExtraResult(null)
    setSelected([])
    setConflicts([])
    setModified(false)
    setReplace(false)
    setOverwriteModified(false)
    setError(null)
    setResult(null)
  }
  const reset = (next: boolean) => {
    if (busy) return
    setOpen(next)
    if (!next) {
      clearPreview()
      setMode('url')
      setUrl('')
      setName('')
      setDescription('')
      setInstructions('')
    } else if (update) void readSource('update')
  }
  const readSource = async (from: 'url' | 'local' | 'update', source = url) => {
    setBusy(true)
    clearPreview()
    try {
      const found: InstallPreview | null = from === 'update' ? { kind: 'skill', preview: await window.jezo.skills.previewUpdate(update!.id) }
        : from === 'local' ? await window.jezo.install.pick() : await window.jezo.install.preview(source)
      if (found) {
        if (found.kind === 'skill') {
          setPreview(found.preview)
          setSelected(found.preview.skills.map((s) => s.path))
          setModified(!!found.preview.modified)
        } else {
          setExtraPreview(found)
          setSelected(found.choices.map((s) => s.id))
        }
      }
    } catch (e) { setError(reason(e)) } finally { setBusy(false) }
  }
  const install = async (agreed = false) => {
    setBusy(true)
    setError(null)
    const replacing = replace || (agreed && conflicts.length > 0) || !!update
    const overwriting = overwriteModified || (agreed && modified)
    setReplace(replacing)
    setOverwriteModified(overwriting)
    try {
      if (extraPreview) {
        const installed = await window.jezo.install.apply(extraPreview.token, selected, replacing)
        if (installed.conflicts.length) { setConflicts(installed.conflicts); return }
        setConflicts([])
        setExtraResult(installed.installed)
        return
      }
      const installed = mode === 'write' && !update
        ? await window.jezo.skills.write({ name, description, instructions }, replacing)
        : await window.jezo.skills.install(preview!.token, selected, replacing, overwriting)
      if (installed.modified) { setModified(true); return }
      if (installed.conflicts.length) { setConflicts(installed.conflicts); return }
      setConflicts([])
      setModified(false)
      setResult(installed)
      useStore.getState().loadSkills()
    } catch (e) { setError(reason(e)) } finally { setBusy(false) }
  }
  const installSuggestion = async (source: string) => {
    setBusy(true)
    clearPreview()
    setUrl(source)
    try {
      const found = await window.jezo.install.preview(source)
      if (found.kind !== 'mcp') throw new Error('The suggested source is not an MCP server.')
      setExtraPreview(found)
      const ids = found.choices.map((choice) => choice.id)
      setSelected(ids)
      const result = await window.jezo.install.apply(found.token, ids)
      if (result.conflicts.length) setConflicts(result.conflicts)
      else setExtraResult(result.installed)
    } catch (e) { setError(reason(e)) } finally { setBusy(false) }
  }
  const confirming = modified || conflicts.length > 0
  const canInstall = mode === 'write' && !update ? !!(name.trim() && description.trim() && instructions.trim()) : (!!preview || !!extraPreview) && selected.length > 0
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{update ? t('skills.update') : t('install.add')}</DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{update ? t('skills.updateTitle', { title: update.title }) : t('install.add')}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{update ? t('skills.addHint') : t('install.hint')}</DialogDescription>
        </DialogHeader>
        {result || extraResult ? (
          <>
            {result?.installed.map((s) => <p key={s.name} className="text-[13.5px]">{t('skills.installed', { title: s.title, count: s.files })}</p>)}
            {extraResult?.map((name) => <p key={name} className="text-[13.5px]">{t('install.installed', { name })}</p>)}
            <p className="text-[13px] text-muted-foreground">{t('skills.nextConversation')}</p>
            {result && <SkippedFiles skipped={result.skipped} />}
            <DialogFooter><DialogClose render={<Button />}>{t('skills.done')}</DialogClose></DialogFooter>
          </>
        ) : (
          <>
            {!update && !confirming && (
              <div className="flex flex-wrap gap-2">
                {(['url', 'local', 'write'] as const).map((choice) => (
                  <Button key={choice} variant={mode === choice ? 'default' : 'outline'} size="sm" disabled={busy} onClick={() => {
                    clearPreview()
                    setMode(choice)
                    if (choice === 'local') void readSource('local')
                  }}>{choice === 'url' ? t('install.paste') : t(`skills.choices.${choice}`)}</Button>
                ))}
              </div>
            )}
            {confirming ? (
              <div className="flex flex-col gap-2 text-[13.5px] leading-relaxed">
                {modified && <p>{t('skills.modified')}</p>}
                {conflicts.map((title) => <p key={title}>{t('skills.replaceQuestion', { title })}</p>)}
              </div>
            ) : mode === 'write' && !update ? (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{t('skills.name')}<Input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{t('skills.description')}<Input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
                <label className="flex flex-col gap-1.5 text-[13px] font-medium">{t('skills.content')}<Textarea className="max-h-56 min-h-32 overflow-y-auto" value={instructions} onChange={(e) => setInstructions(e.target.value)} /></label>
              </div>
            ) : (
              <>
                {!update && mode === 'url' && (
                  <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (url.trim()) void readSource('url') }}>
                    <label className="flex flex-col gap-1.5 text-[13px] font-medium">{t('install.source')}<Textarea className="max-h-40 min-h-24 overflow-y-auto" value={url} onChange={(e) => { clearPreview(); setUrl(e.target.value) }} autoFocus autoComplete="off" spellCheck={false} placeholder="https://… / npm:… / {…}" disabled={busy} /></label>
                    <Button type="submit" variant="outline" size="sm" className="self-start" disabled={!url.trim() || busy}>{busy ? t('skills.reading') : t('install.find')}</Button>
                  </form>
                )}
                {!update && mode === 'local' && <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={() => void readSource('local')}>{t('skills.pick')}</Button>}
                {preview && (
                  <ListCard className="max-h-56 overflow-y-auto">
                    {preview.skills.map((s) => (
                      <label key={s.path} className="flex items-center gap-3 px-4 py-3.5">
                        <input type="checkbox" className="size-4 accent-primary" checked={selected.includes(s.path)} disabled={busy || !!update} onChange={(e) => {
                          setSelected(e.target.checked ? [...selected, s.path] : selected.filter((p) => p !== s.path))
                          setReplace(false)
                        }} />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[14.5px] font-medium">{s.title}</span>
                          <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{s.description}</span>
                          {!update && <span className="mt-1 block text-[12.5px] text-muted-foreground">{t('install.destination', { path: `skills/${s.name}/` })}</span>}
                        </span>
                      </label>
                    ))}
                  </ListCard>
                )}
                {preview && <SkippedFiles skipped={preview.skipped} />}
                {preview && !update && <p className="break-all text-[12.5px] text-muted-foreground">{mode === 'local' ? t('skills.localSource') : t('install.from', { source: url })}</p>}
                {extraPreview && <ListCard className="max-h-56 overflow-y-auto">
                  {extraPreview.choices.map((choice) => <label key={choice.id} className="flex items-start gap-3 px-4 py-3.5">
                    <input type="checkbox" className="mt-1 size-4 accent-primary" checked={selected.includes(choice.id)} disabled={busy} onChange={(e) => { setSelected(e.target.checked ? [...selected, choice.id] : selected.filter((id) => id !== choice.id)); setReplace(false) }} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-medium">{choice.title}</span>
                      <span className="mt-0.5 block text-[12.5px] text-muted-foreground">{t(`install.kinds.${extraPreview.kind}`)}{choice.description ? ` · ${choice.description}` : ''}</span>
                      <span className="mt-1 block break-all text-[12.5px] text-muted-foreground">{t('install.from', { source: choice.source })}</span>
                      <span className="mt-1 block break-all text-[12.5px] text-muted-foreground">{t('install.destination', { path: choice.destination })}</span>
                      {choice.resources?.map((resource) => <span key={resource} className="mt-1 block break-all text-[12.5px] text-muted-foreground">{resource}</span>)}
                    </span>
                  </label>)}
                </ListCard>}
                {!update && mode === 'url' && !preview && !extraPreview && <div className="flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">{t('install.suggestions')}</p>
                  <ListCard>{INSTALL_SUGGESTIONS.map((suggestion) => <div key={suggestion.id} className="flex items-center gap-2 px-4 py-3">
                    <div className="min-w-0 flex-1 text-[13px]">{t(`install.options.${suggestion.id}`)}<details className="mt-1 text-xs text-muted-foreground"><summary className="cursor-pointer">{t('install.configuration')}</summary><pre className="mt-2 overflow-auto text-[11px]">{suggestion.source}</pre></details></div>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => { clearPreview(); setUrl(suggestion.source) }}>{t('install.configure')}</Button>
                    <Button variant="outline" size="sm" disabled={busy} aria-label={t('install.installOption', { name: t(`install.options.${suggestion.id}`) })} onClick={() => void installSuggestion(suggestion.source)}>{t('skills.install')}</Button>
                  </div>)}</ListCard>
                </div>}
                {(preview || extraPreview) && <p className="text-[13px] text-muted-foreground">{t('skills.nextConversation')}</p>}
              </>
            )}
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" disabled={busy} />}>{t('connections.cancel')}</DialogClose>
              <Button disabled={busy || !canInstall} onClick={() => void install(confirming)}>{busy ? t('skills.working') : confirming ? (modified ? t('skills.update') : t('skills.replace')) : update ? t('skills.update') : t('skills.install')}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function RemoveSkillDialog({ skill }: { skill: SkillInfo }) {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await window.jezo.skills.remove(skill.id)
      useStore.getState().loadSkills()
      useStore.getState().navigate('more', 'skills')
      setOpen(false)
    } catch (e) { setError(reason(e)) } finally { setBusy(false) }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); setError(null) } }}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-muted-foreground" />}>{t('skills.remove')}</DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{t('skills.removeQuestion', { title: skill.title })}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{t('skills.removeHint')}</DialogDescription>
        </DialogHeader>
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy} />}>{t('connections.cancel')}</DialogClose>
          <Button disabled={busy} onClick={() => void remove()}>{t('skills.remove')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
