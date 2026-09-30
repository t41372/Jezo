import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InstalledMcp, InstalledResources } from '../../../../shared/install'
import { ListCard } from '@/components/ListCard'
import { Button } from '@/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'

const reason = (error: unknown) => String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')

function SignIn({ server }: { server: InstalledMcp }) {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const close = () => { if (busy) void window.jezo.install.replySignIn(server.name); setOpen(false) }
  const signIn = async () => {
    setBusy(true)
    setError('')
    try { await window.jezo.install.signIn(server.name); setOpen(false) }
    catch (e) { setError(reason(e)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else setOpen(true) }}>
    <DialogTrigger render={<Button size="sm" variant="outline" />}>{t('install.signIn')}</DialogTrigger>
    <DialogContent className="gap-4 sm:max-w-md" showCloseButton={false}>
      <DialogHeader><DialogTitle className="text-base">{t('install.signInTitle', { name: server.name })}</DialogTitle><DialogDescription className="text-[13px]">{t('install.signInHint')}</DialogDescription></DialogHeader>
      {busy && <label className="flex flex-col gap-1.5 text-[13px]">{t('install.redirect')}<Input value={url} onChange={(e) => setUrl(e.target.value)} /></label>}
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="ghost" onClick={close}>{t('connections.cancel')}</Button>
        {busy ? <Button disabled={!url.trim()} onClick={() => void window.jezo.install.replySignIn(server.name, url)}>{t('install.send')}</Button> : <Button onClick={() => void signIn()}>{t('install.openBrowser')}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function RemoveInstalled({ kind, id, title }: { kind: 'package' | 'mcp'; id: string; title: string }) {
  const { t } = useTranslation('more')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const remove = async () => {
    setBusy(true)
    try { await window.jezo.install.remove(kind, id); setOpen(false) }
    catch (e) { setError(reason(e)) }
    finally { setBusy(false) }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) { setOpen(next); setError('') } }}>
    <DialogTrigger render={<Button size="sm" variant="ghost" className="text-muted-foreground" />}>{t('skills.remove')}</DialogTrigger>
    <DialogContent className="gap-4 sm:max-w-md" showCloseButton={false}>
      <DialogHeader><DialogTitle className="text-base">{t('skills.removeQuestion', { title })}</DialogTitle><DialogDescription className="text-[13px]">{t('install.removeHint')}</DialogDescription></DialogHeader>
      {error && <p className="text-[13px] text-destructive">{error}</p>}
      <DialogFooter><DialogClose render={<Button variant="ghost" disabled={busy} />}>{t('connections.cancel')}</DialogClose><Button disabled={busy} onClick={() => void remove()}>{t('skills.remove')}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function Installed() {
  const { t } = useTranslation('more')
  const [installed, setInstalled] = useState<InstalledResources>({ packages: [], servers: [] })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  useEffect(() => {
    let disposed = false
    const load = () => window.jezo.install.list().then((value) => { if (!disposed) setInstalled(value) }).catch((e) => { if (!disposed) setError(reason(e)) })
    void load()
    const stop = window.jezo.install.onChange(() => void load())
    return () => { disposed = true; stop() }
  }, [])
  const perform = async (id: string, work: () => Promise<void>) => {
    setBusy(id)
    setError('')
    try { await work(); setInstalled(await window.jezo.install.list()) }
    catch (e) { setError(reason(e)) }
    finally { setBusy('') }
  }
  return <>
    {installed.packages.length > 0 && <section className="flex flex-col gap-2">
      <h2 className="mt-1.5 text-xs text-muted-foreground">{t('install.packages')}</h2>
      <ListCard>{installed.packages.map((pkg) => <div key={pkg.source} data-installed-package={pkg.source} className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><div className="break-all text-[14.5px] font-medium">{pkg.origin?.source ?? pkg.source}</div><p className="mt-0.5 text-[12.5px] text-muted-foreground">{pkg.origin?.by === 'agent' ? t('install.byAgent') : t('install.kinds.package')} · {t(pkg.enabled ? 'install.enabled' : 'install.disabled')}</p></div>
          <RemoveInstalled kind="package" id={pkg.source} title={pkg.origin?.source ?? pkg.source} />
          <Switch checked={pkg.enabled} disabled={busy === pkg.source} aria-label={t('install.toggle', { name: pkg.origin?.source ?? pkg.source })} onCheckedChange={(enabled) => void perform(pkg.source, () => window.jezo.install.setEnabled('package', pkg.source, enabled))} />
        </div>
        <details className="mt-2 text-[12.5px] text-muted-foreground"><summary className="cursor-pointer">{t('install.resources', { count: pkg.resources.length })}</summary><ul className="mt-2 space-y-1">{pkg.resources.map((r) => <li key={`${r.kind}:${r.path}`} className="break-all">{r.kind} · {r.path}</li>)}</ul></details>
      </div>)}</ListCard>
    </section>}
    {installed.servers.length > 0 && <section className="flex flex-col gap-2">
      <h2 className="mt-1.5 text-xs text-muted-foreground">{t('install.servers')}</h2>
      <ListCard>{installed.servers.map((server) => <div key={server.name} data-installed-mcp={server.name} className="px-4 py-3.5">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1"><div className="text-[14.5px] font-medium">{server.name}</div><p className="mt-0.5 text-[12.5px] text-muted-foreground">{t(`install.states.${server.state}`)} · {t('install.tools', { count: server.tools.length })}{server.origin?.by === 'agent' ? ` · ${t('install.byAgent')}` : ''}</p><p className="mt-0.5 break-all text-[12.5px] text-muted-foreground">{server.source}</p></div>
          {server.state === 'needs-auth' && <SignIn server={server} />}
          {['failed', 'disconnected'].includes(server.state) && <Button size="sm" variant="outline" disabled={busy === server.name} onClick={() => void perform(server.name, () => window.jezo.install.reconnect(server.name))}>{t('install.reconnect')}</Button>}
          <RemoveInstalled kind="mcp" id={server.name} title={server.name} />
          <Switch checked={server.enabled} disabled={busy === server.name} aria-label={t('install.toggle', { name: server.name })} onCheckedChange={(enabled) => void perform(server.name, () => window.jezo.install.setEnabled('mcp', server.name, enabled))} />
        </div>
        {server.error && <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-destructive">{server.error}</p>}
        {server.tools.length > 0 && <details className="mt-2 text-[12.5px] text-muted-foreground"><summary className="cursor-pointer">{t('install.showTools')}</summary><p className="mt-2 break-all">{server.tools.join(' · ')}</p></details>}
      </div>)}</ListCard>
    </section>}
    {error && <p className="text-[13px] text-destructive">{error}</p>}
  </>
}
