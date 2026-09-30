import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ExtensionQuestion } from '../../../shared/install'
import { Button } from './ui/button'
import { Input } from './ui/input'

export function ExtensionQuestionCard({ session, question: q }: { session: string; question: ExtensionQuestion }) {
  const { t } = useTranslation('more')
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    if (!q.expires || q.answered) return
    const update = () => setRemaining(Math.max(0, Math.ceil((q.expires! - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [q.expires, q.answered])
  const answer = async (value?: string | boolean) => {
    setBusy(true)
    try { await window.jezo.agent.answerExtension(session, q.id, value) }
    catch (e) { setError(String((e as Error).message)) }
    finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-card-border bg-card px-4.5 py-3.5 text-[13.5px]" data-extension-question={q.id}>
      <div className="font-medium">{q.title}</div>
      {q.message && <p className="leading-relaxed whitespace-pre-wrap">{q.message}</p>}
      {q.answered ? <p className="text-muted-foreground">{typeof q.answer === 'boolean' ? t(q.answer ? 'install.allow' : 'install.decline') : q.answer ?? t('connections.cancel')}</p> : (
        <>
          {q.expires && <p className="text-xs text-muted-foreground">{t('install.remaining', { seconds: remaining })}</p>}
          {q.kind === 'input' && <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void answer(value) }}>
            <Input aria-label={q.title} placeholder={q.placeholder} value={value} onChange={(e) => setValue(e.target.value)} disabled={busy} />
            <Button type="submit" disabled={busy}>{t('install.send')}</Button>
          </form>}
          <div className="flex flex-wrap gap-2">
            {q.kind === 'select' && q.options?.map((option) => <Button key={option} variant="outline" className="rounded-full font-normal" disabled={busy} onClick={() => void answer(option)}>{option}</Button>)}
            {q.kind === 'confirm' && <Button disabled={busy} onClick={() => void answer(true)}>{t('install.allow')}</Button>}
            <Button variant="ghost" disabled={busy} onClick={() => void answer(q.kind === 'confirm' ? false : undefined)}>{t(q.kind === 'confirm' ? 'install.decline' : 'connections.cancel')}</Button>
          </div>
        </>
      )}
      {error && <p className="text-destructive">{error}</p>}
    </div>
  )
}
