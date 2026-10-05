import { cn } from 'cn'
import { Check, ChevronDown, LoaderCircle, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/Disclosure'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { SpeechModelDetail, SpeechModelSettings } from '../../../../../shared/speech'
import { languageName, message, run } from './data'
import { copy, emptySettings, fallbackOf, type Field, fieldsOf, forSaving, GROUPS, has, same } from './schema'

export interface Draft {
  settings: SpeechModelSettings
  /** "group:field" → a new value, or null to remove the saved one. */
  secrets: Record<string, string | null>
}

/**
 * Unsaved edits, per model. They live outside the page, so leaving it and
 * coming back, or looking at another model, never loses them.
 */
const drafts = new Map<string, Draft>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach((l) => l())

export function useDrafted() {
  const [, tick] = useState(0)
  useEffect(() => {
    const listener = () => tick((n) => n + 1)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])
  return (id: string) => drafts.has(id)
}

/** i18next's own type is too deep to pass around; these helpers only need a key and options in, a string out. */
type T = (key: string, options?: Record<string, unknown>) => string
const plain = (t: unknown) => t as T

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * A model's settings, every one its engine's schemas declare, in collapsed
 * sections. A setting left alone shows the engine's default and isn't saved,
 * so a preset's own defaults stay in charge; only what the user changes is
 * written. Saving checks the whole set with the engine first, so a mistake
 * never replaces settings that work.
 */
export function SettingsForm({ detail, busy, onSaved }: { detail: SpeechModelDetail; busy: boolean; onSaved: () => void }) {
  const { t } = useTranslation('settings')
  const saved = detail.settings
  const [draft, setDraftState] = useState<Draft>(() => drafts.get(detail.id) ?? { settings: copy(saved ?? emptySettings()), secrets: {} })
  // Bumped when the shown values are replaced from outside, so fields holding their own text start over.
  const [generation, setGeneration] = useState(0)
  const [invalid, setInvalid] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Saved settings read again (after saving, say) replace what's shown, unless there are edits.
  const savedKey = JSON.stringify([saved, detail.secrets])
  useEffect(() => {
    if (drafts.has(detail.id)) return
    setDraftState({ settings: copy(saved ?? emptySettings()), secrets: {} })
    setGeneration((n) => n + 1)
  }, [savedKey])

  const setDraft = (next: Draft) => {
    setDraftState(next)
    if (same(next.settings, saved) && !Object.keys(next.secrets).length) drafts.delete(detail.id)
    else drafts.set(detail.id, next)
    changed()
  }
  const id = (f: Field) => `${f.group}:${f.key}`
  const savedSecret = (f: Field) => detail.secrets.includes(id(f))
  const modified = (f: Field) =>
    f.kind.type === 'secret' ? savedSecret(f) || Object.hasOwn(draft.secrets, id(f)) : has(draft.settings, f.group, f.key)

  /** Only an unset value inherits: a class schema's default can differ from a preset's. */
  const setValue = (f: Field, value: unknown) => {
    const group = { ...draft.settings[f.group] }
    if (value === undefined) delete group[f.key]
    else group[f.key] = value
    setDraft({ ...draft, settings: { ...draft.settings, [f.group]: group } })
  }
  const setSecret = (f: Field, value: string | null | undefined) => {
    const secrets = { ...draft.secrets }
    if (value === undefined) delete secrets[id(f)]
    else secrets[id(f)] = value
    setDraft({ ...draft, secrets })
  }
  const markInvalid = (f: Field, bad: boolean) =>
    setInvalid((s) => {
      const next = new Set(s)
      if (bad) next.add(id(f))
      else next.delete(id(f))
      return next
    })
  const reset = (f: Field) => {
    if (f.kind.type === 'secret') return setSecret(f, savedSecret(f) ? null : undefined)
    markInvalid(f, false)
    setGeneration((n) => n + 1)
    setValue(f, undefined)
  }
  const revert = () => {
    drafts.delete(detail.id)
    changed()
    setDraftState({ settings: copy(saved), secrets: {} })
    setGeneration((n) => n + 1)
    setInvalid(new Set())
    setError(null)
  }
  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await run({ kind: 'saveModel', model: detail.id, settings: forSaving(draft.settings), secrets: draft.secrets })
      drafts.delete(detail.id)
      changed()
      onSaved()
    } catch (e) {
      setError(message(e))
    } finally {
      setSaving(false)
    }
  }

  const fields = fieldsOf(detail)
  const sections = GROUPS.map((group) => ({ group, fields: fields.filter((f) => f.group === group) })).filter((s) => s.fields.length)
  const dirty = drafts.has(detail.id)
  if (!sections.length) return null

  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{t('speech.settings.title')}</h3>
      <p className="pb-1 text-[12.5px] text-muted-foreground">{t('speech.settings.intro')}</p>
      {sections.map(({ group, fields }) => {
        const count = fields.filter(modified).length
        return (
          <Disclosure
            key={group}
            label={
              <span className="flex items-baseline gap-2">
                <span className="font-medium text-foreground">{t(`speech.settings.group.${group}`)}</span>
                {count > 0 && <span className="text-xs">{t('speech.settings.modified', { count })}</span>}
              </span>
            }
            triggerClassName="py-1 text-[13.5px]"
          >
            <p className="pb-2 pl-[18px] text-[12px] text-pretty text-muted-foreground">{t(`speech.settings.groupHint.${group}`)}</p>
            {[fields.filter((f) => !f.unused), fields.filter((f) => f.unused)].map((list, unused) => {
              const rows = (
                <ul className="mb-2 flex flex-col divide-y divide-card-border rounded-xl border border-card-border">
                  {list.map((f) => (
                    <FieldRow
                      key={`${id(f)}:${generation}`}
                      field={f}
                      detail={detail}
                      modified={modified(f)}
                      value={draft.settings[f.group]?.[f.key]}
                      set={has(draft.settings, f.group, f.key)}
                      secret={{ saved: savedSecret(f), pending: Object.hasOwn(draft.secrets, id(f)), value: draft.secrets[id(f)] }}
                      onChange={(v) => setValue(f, v)}
                      onSecret={(v) => setSecret(f, v)}
                      onReset={() => reset(f)}
                      onInvalid={(bad) => markInvalid(f, bad)}
                    />
                  ))}
                </ul>
              )
              if (!list.length) return null
              if (!unused) return <div key="used">{rows}</div>
              // What Jezo doesn't read stays reachable, set apart so it isn't mistaken for something that changes dictation.
              return (
                <Disclosure key="unused" label={t('speech.settings.unused', { count: list.length })} className="pl-[18px]" triggerClassName="pb-1.5 text-xs">
                  <p className="pb-2 text-[12px] text-pretty text-muted-foreground">{t('speech.settings.unusedHint')}</p>
                  {rows}
                </Disclosure>
              )
            })}
          </Disclosure>
        )
      })}
      {error && <p className="text-[13px] break-words whitespace-pre-wrap text-destructive">{t('speech.settings.notSaved', { error })}</p>}
      {dirty && (
        <div className="flex items-center gap-2 pt-1">
          <span className="flex-1 text-[12.5px] text-muted-foreground">{invalid.size ? t('speech.settings.fixFirst') : t('speech.settings.unsaved')}</span>
          <Button variant="ghost" size="sm" disabled={saving} onClick={revert}>
            {t('speech.settings.revert')}
          </Button>
          <Button size="sm" disabled={saving || busy || invalid.size > 0} onClick={save}>
            {saving && <LoaderCircle className="animate-spin" />}
            {t('speech.settings.save')}
          </Button>
        </div>
      )}
    </section>
  )
}

/** Config fields that Standard ASR's own configuration defines the same way for every engine. */
const STANDARD_CONFIG = ['strict', 'allow_private_urls', 'default_language', 'default_candidate_languages', 'download_root', 'local_files_only', 'revision', 'hf_token', 'model_path', 'device']
const standard = (f: Field) => f.group === 'options' || f.group === 'deadlines' || (f.group === 'config' && STANDARD_CONFIG.includes(f.key))

/** Standard settings are named in the app's language; an engine's own keep the name its schema gives them. */
function labelText(f: Field, t: T) {
  const fallback = typeof f.schema.title === 'string' ? f.schema.title : f.key
  return standard(f) ? t(`speech.field.${f.key}.label`, { defaultValue: fallback }) : fallback
}

function hintText(f: Field, t: T) {
  const own = typeof f.schema.description === 'string' ? f.schema.description : ''
  return standard(f) ? t(`speech.field.${f.key}.hint`, { defaultValue: own }) : own
}

const isLanguage = (f: Field) => f.key === 'language' || f.key === 'default_language'

function display(value: unknown, field: Field, t: T, language: string): string {
  if (value === null || value === undefined) return t('speech.settings.none')
  if (isLanguage(field) && typeof value === 'string') return value === 'auto' ? t('speech.settings.auto') : `${languageName(value, language)} (${value})`
  if (typeof value === 'string') return t(`speech.settings.value.${value}`, { defaultValue: value })
  return JSON.stringify(value)
}

/** One setting: its name and what it does, its control, and a way back to the default once changed. */
function FieldRow({
  field,
  detail,
  modified,
  value,
  set,
  secret,
  onChange,
  onSecret,
  onReset,
  onInvalid,
}: {
  field: Field
  detail: SpeechModelDetail
  modified: boolean
  value: unknown
  set: boolean
  secret: { saved: boolean; pending: boolean; value: string | null | undefined }
  onChange: (value: unknown) => void
  onSecret: (value: string | null | undefined) => void
  onReset: () => void
  onInvalid: (bad: boolean) => void
}) {
  const { t, i18n } = useTranslation('settings')
  const tt = plain(t)
  const label = labelText(field, tt)
  const hint = hintText(field, tt)
  const kind = field.kind
  const fallback = fallbackOf(field)
  const current = set ? value : fallback
  const languages = Array.isArray(detail.properties.selectable_languages) ? (detail.properties.selectable_languages as string[]) : null
  const placeholder =
    fallback === undefined || fallback === null ? tt('speech.settings.unset') : tt('speech.settings.default', { value: display(fallback, field, tt, i18n.language) })

  let control: React.ReactNode
  let wide = false
  if (kind.type === 'boolean' || kind.type === 'marker') {
    const on = kind.type === 'boolean' ? current === true : current != null
    control = <Switch checked={on} onCheckedChange={(next) => onChange(kind.type === 'boolean' ? next : next ? {} : null)} aria-label={label} />
  } else if (kind.type === 'choice' || (isLanguage(field) && languages && kind.type === 'text')) {
    const values = [...(kind.type === 'choice' ? kind.values : languages!), ...(field.nullable ? [null] : [])]
    control = (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="max-w-60" aria-label={label} />}>
          <span className="truncate">{set ? display(value, field, tt, i18n.language) : placeholder}</span>
          <ChevronDown className="size-3.5 opacity-60" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-72">
          <DropdownMenuRadioGroup value={JSON.stringify(current)} onValueChange={(v) => onChange(JSON.parse(v as string))}>
            {values.map((v) => (
              <DropdownMenuRadioItem key={JSON.stringify(v)} value={JSON.stringify(v)} closeOnClick>
                {display(v, field, tt, i18n.language)}
                {equal(v, fallback) && <span className="text-muted-foreground">{tt('speech.settings.isDefault')}</span>}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  } else if (kind.type === 'number') {
    control = <NumberInput field={field} label={label} value={set ? value : undefined} placeholder={placeholder} onChange={onChange} onInvalid={onInvalid} />
  } else if (kind.type === 'text') {
    control = (
      <Input
        defaultValue={set && typeof value === 'string' ? value : ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
        className="h-8 w-60 font-mono text-[13px]"
        aria-label={label}
      />
    )
  } else if (kind.type === 'secret') {
    control = <SecretControl label={label} {...secret} onChange={onSecret} />
  } else if (kind.type === 'list') {
    wide = true
    control = (
      <Textarea
        defaultValue={set && Array.isArray(value) ? value.join('\n') : ''}
        placeholder={Array.isArray(fallback) && fallback.length ? fallback.join('\n') : tt('speech.settings.onePerLine')}
        onChange={(e) => {
          const lines = e.target.value.split('\n').map((l) => l.trim()).filter(Boolean)
          onChange(lines.length ? lines : undefined)
        }}
        rows={3}
        className="font-mono text-[13px]"
        aria-label={label}
      />
    )
  } else {
    wide = true
    control = <JsonInput label={label} value={set ? value : undefined} fallback={fallback} onChange={onChange} onInvalid={onInvalid} />
  }

  return (
    <li className="flex flex-col gap-2 px-3.5 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 text-[13px] font-medium">
            <span>{label}</span>
            <span className="truncate font-mono text-[11px] font-normal text-muted-foreground">{field.key}</span>
          </div>
          {hint && <p className="mt-0.5 text-[12px] text-pretty text-muted-foreground">{hint}</p>}
        </div>
        {!wide && <div className="flex shrink-0 items-center">{control}</div>}
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn('shrink-0 self-center text-muted-foreground', !modified && 'invisible')}
          aria-label={tt(kind.type === 'secret' ? 'speech.settings.removeSecret' : 'speech.settings.reset', { name: label })}
          title={tt(kind.type === 'secret' ? 'speech.settings.removeSecretHint' : 'speech.settings.resetHint')}
          onClick={onReset}
          tabIndex={modified ? 0 : -1}
        >
          <RotateCcw />
        </Button>
      </div>
      {wide && control}
    </li>
  )
}

function NumberInput({
  field,
  label,
  value,
  placeholder,
  onChange,
  onInvalid,
}: {
  field: Field
  label: string
  value: unknown
  placeholder: string
  onChange: (v: unknown) => void
  onInvalid: (bad: boolean) => void
}) {
  const { t } = useTranslation('settings')
  const [bad, setBad] = useState(false)
  const [text, setText] = useState(value == null ? '' : String(value))
  const integer = field.kind.type === 'number' && field.kind.integer
  const choose = (value: null | undefined) => {
    setText('')
    setBad(false)
    onInvalid(false)
    onChange(value)
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <Input
          value={text}
          inputMode="decimal"
          placeholder={value === null ? t('speech.settings.nullValue') : placeholder}
          onChange={(e) => {
            setText(e.target.value)
            const raw = e.target.value.trim()
            const parsed = Number(raw)
            const ok = raw === '' || (Number.isFinite(parsed) && (!integer || Number.isInteger(parsed)))
            setBad(!ok)
            onInvalid(!ok)
            if (ok) onChange(raw === '' ? undefined : parsed)
          }}
          className={cn('h-8 w-36 text-right font-mono text-[13px] tabular-nums', bad && 'border-destructive')}
          aria-label={label}
          aria-invalid={bad}
        />
        {field.nullable && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={t('speech.settings.numberOptions', { name: label })} />}>
              <ChevronDown />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => choose(undefined)}>{t('speech.settings.useDefault')}</DropdownMenuItem>
              <DropdownMenuItem onClick={() => choose(null)}>{t('speech.settings.nullValue')}</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {bad && <span className="text-[12px] text-destructive">{integer ? t('speech.settings.needInteger') : t('speech.settings.needNumber')}</span>}
    </div>
  )
}

/** Settings shaped in a way no control here knows, edited as the JSON the engine reads. */
function JsonInput({ label, value, fallback, onChange, onInvalid }: { label: string; value: unknown; fallback: unknown; onChange: (v: unknown) => void; onInvalid: (bad: boolean) => void }) {
  const { t } = useTranslation('settings')
  const [bad, setBad] = useState(false)
  const initial = value === undefined ? '' : JSON.stringify(value, null, 2)
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        defaultValue={initial}
        placeholder={fallback === undefined ? '' : JSON.stringify(fallback)}
        onChange={(e) => {
          const text = e.target.value
          if (text.trim() === '') {
            setBad(false)
            onInvalid(false)
            return onChange(undefined)
          }
          try {
            onChange(JSON.parse(text))
            setBad(false)
            onInvalid(false)
          } catch {
            setBad(true)
            onInvalid(true)
          }
        }}
        rows={Math.min(8, initial.split('\n').length + 1)}
        className={cn('font-mono text-[12.5px]', bad && 'border-destructive')}
        aria-label={label}
        aria-invalid={bad}
      />
      <span className={cn('text-[12px]', bad ? 'text-destructive' : 'text-muted-foreground')}>{bad ? t('speech.settings.badJson') : t('speech.settings.json')}</span>
    </div>
  )
}

/** A saved secret is never shown or sent back; it can only be replaced or removed. */
function SecretControl({
  label,
  saved,
  pending,
  value,
  onChange,
}: {
  label: string
  saved: boolean
  pending: boolean
  value: string | null | undefined
  onChange: (value: string | null | undefined) => void
}) {
  const { t } = useTranslation('settings')
  const [replacing, setReplacing] = useState(false)
  if (pending && value === null)
    return (
      <div className="flex items-center gap-1 text-[13px] text-muted-foreground">
        {t('speech.settings.secretRemoving')}
        <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
          {t('speech.settings.undo')}
        </Button>
      </div>
    )
  if (saved && !pending && !replacing)
    return (
      <div className="flex items-center gap-1.5 text-[13px]">
        <Check className="size-3.5 text-ok" strokeWidth={2.5} />
        {t('speech.settings.secretSaved')}
        <Button variant="ghost" size="sm" onClick={() => setReplacing(true)}>
          {t('speech.settings.secretReplace')}
        </Button>
      </div>
    )
  return (
    <Input
      type="password"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
      onBlur={() => !value && setReplacing(false)}
      placeholder={saved ? t('speech.settings.secretNew') : t('speech.settings.unset')}
      className="h-8 w-60"
      autoComplete="off"
      autoFocus={replacing}
      aria-label={label}
    />
  )
}
