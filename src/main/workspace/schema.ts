// Checks an item's fields against the JSON Schema in its manifest. The messages
// go to the agent when it writes something wrong, so they name the field.

import { Ajv } from 'ajv'
import { Cron } from 'croner'
import { ruleProblem } from './rrule'
import { parseTime, type Role } from '../../shared/time'
import { parseCatchUp } from '../../shared/catch-up'

/** Returns what's wrong, or an empty list. */
export type Check = (data: unknown) => string[]

const ajv = new Ajv({ allErrors: true, strict: false })

// Time fields name their role as a format (docs/design/time.md): `jezo-time`
// for a plan, like a todo's `scheduled`; `jezo-record` for what happened;
// `jezo-deadline` for a todo's `due`, a day or a time.
const valid = (role: Role) => (text: string) => {
  try {
    parseTime(text, role)
    return true
  } catch {
    return false
  }
}
ajv.addFormat('jezo-time', { type: 'string', validate: valid('plan') })
ajv.addFormat('jezo-record', { type: 'string', validate: valid('record') })
ajv.addFormat('jezo-deadline', { type: 'string', validate: valid('deadline') })

// An automation's schedule, catch-up window and zone (docs/design/automations.md).
const problemOf = (check: (text: string) => void) => (text: string) => {
  try {
    check(text)
    return ''
  } catch (error) {
    return (error as Error).message
  }
}
const formats: Record<string, (text: string) => string> = {
  'jezo-cron': problemOf((text) => {
    if (text.trim().split(/\s+/).length !== 5) throw new Error(`"${text}" isn't a schedule: write five fields, minute hour day month weekday, like 0 8 * * *.`)
    new Cron(text, { paused: true })
  }),
  'jezo-catch-up': problemOf((text) => parseCatchUp({ catch_up: text })),
  // A repeating todo's rule (docs/design/frontend.md, "Repeating todos").
  'jezo-rrule': ruleProblem,
  'jezo-duration': problemOf((text) => {
    const length = Temporal.Duration.from(text)
    if (length.sign < 0) throw new Error(`"${text}" is a length before, not after: write one like P2D.`)
  }),
  'jezo-zone': problemOf((text) => {
    if (text !== 'local') Temporal.Instant.fromEpochMilliseconds(0).toZonedDateTimeISO(text)
  }),
}
for (const [name, problem] of Object.entries(formats)) ajv.addFormat(name, { type: 'string', validate: (text: string) => !problem(text) })

/** Why a time field didn't read, from the time module, so the message says what to write instead. */
function timeProblem(value: unknown, role: Role) {
  try {
    parseTime(String(value), role)
    return ''
  } catch (error) {
    return (error as Error).message
  }
}

export function compileSchema(schema: object): Check {
  const validate = ajv.compile(schema)
  return (data) => {
    if (validate(data)) return []
    return (validate.errors ?? []).map((e) => {
      const field = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : 'the item'
      const format = (e.params as { format?: string }).format
      if (e.keyword === 'format' && format && formats[format]) {
        const value = e.instancePath.slice(1).split('/').reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], data)
        return `${field}: ${formats[format](String(value))}`
      }
      const roles: Record<string, Role> = { 'jezo-time': 'plan', 'jezo-record': 'record', 'jezo-deadline': 'deadline' }
      if (e.keyword === 'format' && format && roles[format]) {
        const value = e.instancePath.slice(1).split('/').reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], data)
        return `${field}: ${timeProblem(value, roles[format])}`
      }
      if (e.keyword === 'required') return `${field === 'the item' ? '' : `${field}: `}missing the field "${(e.params as { missingProperty: string }).missingProperty}"`
      if (e.keyword === 'enum') return `${field} must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`
      return `${field} ${e.message}`
    })
  }
}

type Schema = { properties?: Record<string, Schema>; items?: Schema; additionalProperties?: unknown; patternProperties?: unknown }

/**
 * Fields the data has that its schema doesn't name, each with the fields that
 * are there, like `arms[].results` next to `label, condition, periods, value,
 * basis`. An object whose schema allows other fields isn't looked into.
 */
export function unknownFields(schema: Schema, data: unknown, at = ''): { field: string; known: string[] }[] {
  if (Array.isArray(data)) return schema.items ? data.flatMap((item) => unknownFields(schema.items!, item, `${at}[]`)) : []
  if (!data || typeof data !== 'object' || !schema.properties || schema.additionalProperties !== undefined || schema.patternProperties) return []
  const known = Object.keys(schema.properties)
  return Object.entries(data).flatMap(([key, value]) => {
    const field = at ? `${at}.${key}` : key
    const sub = schema.properties![key]
    return sub ? unknownFields(sub, value, field) : [{ field, known }]
  })
}
