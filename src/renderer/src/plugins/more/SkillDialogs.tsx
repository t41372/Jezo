// Adding and updating methods uses the same dialog and error style as calendars.
// The main process keeps the files between reading a source and installing it.

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SkillInfo, SkillInstallResult, SkillPreview, SkillSkipped } from '../../../../shared/skills'
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

export function AddSkillDialog({ update }: { update?: SkillInfo }) {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'url' | 'local' | 'write'>('url')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [preview, setPreview] = useState<SkillPreview | null>(null)
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
    setPreview(null)
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
  const readSource = async (from: 'url' | 'local' | 'update') => {
    setBusy(true)
    clearPreview()
    try {
      const found = from === 'update' ? await window.jezo.skills.previewUpdate(update!.id)
        : from === 'local' ? await window.jezo.skills.pick() : await window.jezo.skills.preview(url)
      if (found) {
        setPreview(found)
        setSelected(found.skills.map((s) => s.path))
        setModified(!!found.modified)
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
  const confirming = modified || conflicts.length > 0
  const canInstall = mode === 'write' && !update ? !!(name.trim() && description.trim() && instructions.trim()) : !!preview && selected.length > 0
  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>{update ? t('skills.update') : t('skills.add')}</DialogTrigger>
      <DialogContent showCloseButton={false} className="gap-4 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{update ? t('skills.updateTitle', { title: update.title }) : t('skills.add')}</DialogTitle>
          <DialogDescription className="text-[13px] leading-relaxed">{t('skills.addHint')}</DialogDescription>
        </DialogHeader>
        {result ? (
          <>
            {result.installed.map((s) => <p key={s.name} className="text-[13.5px]">{t('skills.installed', { title: s.title, count: s.files })}</p>)}
            <p className="text-[13px] text-muted-foreground">{t('skills.nextConversation')}</p>
            <SkippedFiles skipped={result.skipped} />
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
                  }}>{t(`skills.choices.${choice}`)}</Button>
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
                    <label className="flex flex-col gap-1.5 text-[13px] font-medium">{t('skills.url')}<Input value={url} onChange={(e) => { clearPreview(); setUrl(e.target.value) }} autoFocus autoComplete="off" spellCheck={false} placeholder="https://github.com/…" disabled={busy} /></label>
                    <Button type="submit" variant="outline" size="sm" className="self-start" disabled={!url.trim() || busy}>{busy ? t('skills.reading') : t('skills.find')}</Button>
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
                        </span>
                      </label>
                    ))}
                  </ListCard>
                )}
                {preview && <SkippedFiles skipped={preview.skipped} />}
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
        {!!skill.origin?.binary?.length && <p className="text-[13px] text-muted-foreground">{t('skills.binaryUndo')}</p>}
        {error && <p className="text-[13px] text-destructive">{error}</p>}
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" disabled={busy} />}>{t('connections.cancel')}</DialogClose>
          <Button disabled={busy} onClick={() => void remove()}>{t('skills.remove')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
