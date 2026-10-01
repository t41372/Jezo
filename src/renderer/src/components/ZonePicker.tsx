import { Check } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { cityOf } from '@/lib/zones'

const ZONES = [...Intl.supportedValuesOf('timeZone'), 'UTC']

/** A zone's name in a language, like 日本標準時間 or Pacific Time, which is what people search for besides the city. */
const nameIn = (zone: string, language: string) =>
  new Intl.DateTimeFormat(language, { timeZone: zone, timeZoneName: 'longGeneric' }).formatToParts(0).find((p) => p.type === 'timeZoneName')?.value ?? ''

/** Each zone with what it's found by: its id, its city and its name, in the app's language and in English. */
const indexes = new Map<string, { zone: string; name: string; text: string }[]>()
function indexFor(language: string) {
  let index = indexes.get(language)
  if (!index) {
    index = ZONES.map((zone) => {
      const name = nameIn(zone, language)
      return { zone, name, text: [zone, cityOf(zone, language), cityOf(zone, 'en'), name, nameIn(zone, 'en')].join(' ').toLowerCase() }
    })
    indexes.set(language, index)
  }
  return index
}

/** A zone name Temporal knows, as it names it: "asia/kolkata" → "Asia/Kolkata", which the list spells Asia/Calcutta. */
function exactZone(text: string) {
  try {
    return text.includes('/') ? Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(text).timeZoneId : null
  } catch {
    return null
  }
}

/**
 * A searchable list of every zone, by city. Choices that aren't a zone (this
 * device's, or "wherever I am") come first, from the caller.
 */
export function ZonePicker({ value, onPick, first, placeholder }: {
  value: string | null
  onPick: (zone: string | null) => void
  /** Rows above the list, like the device's own zone. */
  first: { value: string | null; label: string }[]
  placeholder: string
}) {
  const { i18n } = useTranslation()
  const [query, setQuery] = useState('')
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const words = [q, q.replace(/\s+/g, '_')]
    const found = indexFor(i18n.language).filter((z) => words.some((w) => z.text.includes(w))).slice(0, 50)
    const exact = exactZone(query.trim())
    return exact && !found.some((z) => z.zone === exact) ? [{ zone: exact, name: nameIn(exact, i18n.language), text: '' }, ...found] : found
  }, [query, i18n.language])
  const row = (key: string, label: string, detail: string | null, chosen: boolean, pick: () => void) => (
    <button
      key={key}
      onClick={pick}
      aria-pressed={chosen}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-150 hover:bg-muted"
    >
      <span className="min-w-0 flex-1 truncate">
        {label}
        {detail && <span className="ml-1.5 text-[12px] text-muted-foreground">{detail}</span>}
      </span>
      {chosen && <Check className="size-3.5 shrink-0" aria-hidden />}
    </button>
  )
  return (
    <div className="flex w-64 flex-col gap-1.5" data-zone-picker>
      <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={placeholder} className="h-8" />
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {!query && first.map((f) => row(`first:${f.value}`, f.label, null, f.value === value, () => onPick(f.value)))}
        {/* The zone chosen now, so it's there to see without searching for it. */}
        {!query && value && !first.some((f) => f.value === value) && row(`chosen:${value}`, cityOf(value), nameIn(value, i18n.language), true, () => onPick(value))}
        {matches.map((z) => row(z.zone, cityOf(z.zone), z.name || z.zone, z.zone === value, () => onPick(z.zone)))}
      </div>
    </div>
  )
}
