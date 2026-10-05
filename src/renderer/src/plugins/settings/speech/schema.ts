// Reads the JSON Schemas an engine declares into the few kinds of control a
// settings form needs. Anything this doesn't recognize is edited as JSON, so
// a plugin's new kind of setting is never out of reach.
import { speechCapabilityAt, type SpeechModelDetail, type SpeechModelSettings, type SpeechSchema } from '../../../../../shared/speech'

export type Group = 'config' | 'options' | 'provider' | 'deadlines'
export const GROUPS: Group[] = ['options', 'config', 'provider', 'deadlines']

export type Kind =
  | { type: 'boolean' }
  | { type: 'number'; integer: boolean }
  | { type: 'text' }
  | { type: 'secret' }
  | { type: 'list' }
  | { type: 'choice'; values: unknown[] }
  /** An empty object whose presence turns something on, like diarization: {} or null. */
  | { type: 'marker' }
  | { type: 'json' }

export interface Field {
  group: Group
  key: string
  schema: SpeechSchema
  kind: Kind
  nullable: boolean
  /** Passed to the engine like any other, but nothing Jezo reads depends on it. */
  unused: boolean
}

const own = <T>(record: Record<string, T> | undefined, key: string) => (record && Object.hasOwn(record, key) ? record[key] : undefined)

/** Follows a local `#/$defs/...` reference; anything else stays as it is. */
function resolve(node: SpeechSchema, root: SpeechSchema): SpeechSchema {
  const ref = node.$ref?.match(/^#\/\$defs\/(.+)$/)?.[1]
  const target = ref ? own(root.$defs, ref) : undefined
  return target ? { ...target, ...node, $ref: undefined } : node
}

export function isSecret(node: SpeechSchema) {
  return !!(node.writeOnly || node.format === 'password' || node.anyOf?.some((n) => n.writeOnly || n.format === 'password'))
}

function kindOf(node: SpeechSchema, root: SpeechSchema): { kind: Kind; nullable: boolean } {
  const variants = (node.anyOf ?? [node]).map((n) => resolve(n, root))
  const nullable = variants.some((v) => v.type === 'null') || (Array.isArray(node.type) && node.type.includes('null'))
  const real = variants.filter((v) => v.type !== 'null')
  if (isSecret(node)) return { kind: { type: 'secret' }, nullable }
  if (real.length !== 1) {
    const choices = real.every((v) => v.const !== undefined) ? real.map((v) => v.const) : null
    return { kind: choices?.length ? { type: 'choice', values: choices } : { type: 'json' }, nullable }
  }
  const [v] = real
  if (Array.isArray(v.enum)) return { kind: { type: 'choice', values: v.enum }, nullable }
  if (v.const !== undefined) return { kind: { type: 'choice', values: [v.const] }, nullable }
  if (v.type === 'boolean') return { kind: { type: 'boolean' }, nullable }
  if (v.type === 'integer' || v.type === 'number') return { kind: { type: 'number', integer: v.type === 'integer' }, nullable }
  if (v.type === 'string') return { kind: { type: 'text' }, nullable }
  if (v.type === 'object' && nullable && !Object.keys(v.properties ?? {}).length && v.additionalProperties === false) return { kind: { type: 'marker' }, nullable }
  const items = v.items as SpeechSchema | undefined
  if (v.type === 'array' && items && resolve(items, root).type === 'string' && !resolve(items, root).enum) return { kind: { type: 'list' }, nullable }
  return { kind: { type: 'json' }, nullable }
}

/**
 * Settings whose effect Jezo doesn't read: it records PCM from the microphone
 * (never an audio URL) and keeps only the text, not timestamps or speakers.
 * They're still shown and saved, set apart, since the engine still takes them.
 */
const UNUSED: Partial<Record<Group, string[]>> = {
  config: ['allow_private_urls'],
  options: ['word_timestamps', 'diarization'],
}

/** Fields Jezo fills in itself, or that this model can't use, aren't shown. */
function offered(group: Group, key: string, detail: SpeechModelDetail) {
  if ((group === 'config' || group === 'provider') && key === 'engine') return false
  if (group === 'options' && key === 'provider_params') return false
  const mode = detail.dictation?.mode
  if (group === 'deadlines') return mode === 'streaming'
  if (group !== 'options' || !mode) return true
  const capabilities = detail.effectiveCapabilities ?? detail.capabilities
  const supported = (path: string) => speechCapabilityAt(capabilities, `${mode}.${path}`)?.supported !== false
  const gate: Record<string, string> = {
    language: 'language.runtime_override',
    candidate_languages: 'language.candidate_languages',
    word_timestamps: 'word_timestamps',
    diarization: 'diarization',
    prompt: 'guidance.prompt',
    phrase_hints: 'guidance.phrase_hints',
  }
  return !Object.hasOwn(gate, key) || supported(gate[key])
}

export function schemaOf(detail: SpeechModelDetail, group: Group) {
  return { config: detail.configSchema, options: detail.runtimeSchema, provider: detail.paramsSchema, deadlines: detail.deadlinesSchema }[group]
}

/** Every setting this model offers, in the order its schemas list them. */
export function fieldsOf(detail: SpeechModelDetail): Field[] {
  return GROUPS.flatMap((group) => {
    const root = schemaOf(detail, group)
    return Object.entries(root.properties ?? {})
      .filter(([key]) => offered(group, key, detail))
      .map(([key, node]) => {
        let { kind, nullable } = kindOf(node, root)
        // Timestamp granularities are one global list; the model's declaration narrows it.
        if (group === 'options' && key === 'word_timestamps' && kind.type === 'choice' && detail.dictation) {
          const allowed = speechCapabilityAt(detail.effectiveCapabilities ?? detail.capabilities, `${detail.dictation.mode}.word_timestamps`)?.granularities
          if (Array.isArray(allowed)) kind = { type: 'choice', values: kind.values.filter((v) => allowed.includes(v)) }
        }
        return { group, key, schema: node, kind, nullable, unused: !!UNUSED[group]?.includes(key) }
      })
  })
}

/** The value the engine uses when the user sets none, as its schema declares it. */
export function fallbackOf(field: Field): unknown {
  return field.schema.default
}

export function has(settings: SpeechModelSettings, group: Group, key: string) {
  const values = settings[group]
  return !!values && Object.hasOwn(values, key)
}

export function emptySettings(): SpeechModelSettings {
  return { config: {}, options: {}, provider: {}, deadlines: {} }
}

/** A copy with every group present, so editing never writes into what was loaded. */
export function copy(settings: SpeechModelSettings): SpeechModelSettings {
  return {
    config: { ...settings.config },
    options: { ...settings.options },
    provider: { ...settings.provider },
    deadlines: { ...settings.deadlines },
  }
}

/** What saving sends: only the groups that hold something, since saving replaces them all. */
export function forSaving(settings: SpeechModelSettings): SpeechModelSettings {
  const result: SpeechModelSettings = { config: settings.config, options: settings.options, provider: settings.provider }
  if (settings.deadlines && Object.keys(settings.deadlines).length) result.deadlines = settings.deadlines
  return result
}

/** Equal as data, whatever order the keys were added in. */
export function same(a: SpeechModelSettings, b: SpeechModelSettings) {
  const stable = (value: unknown): string =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`).join(',')}}`
      : JSON.stringify(value)
  return stable(forSaving(copy(a))) === stable(forSaving(copy(b)))
}
