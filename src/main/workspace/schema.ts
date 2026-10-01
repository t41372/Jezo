// Checks an item's fields against the JSON Schema in its manifest. The messages
// go to the agent when it writes something wrong, so they name the field.

import { Ajv } from 'ajv'
import { Cron } from 'croner'
import { parseTime, type Role } from '../../shared/time'
import { parseCatchUp } from '../../shared/catch-up'

/** Returns what's wrong, or an empty list. */
export type Check = (data: unknown) => string[]

const ajv = new Ajv({ allErrors: true, strict: false })

// Time fields name their role as a format (docs/design/time.md): `jezo-time`
// for a plan, like a todo's `scheduled`; `jezo-record` for what happened.
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
      if (e.keyword === 'format' && (format === 'jezo-time' || format === 'jezo-record')) {
        const value = e.instancePath.slice(1).split('/').reduce<unknown>((at, key) => (at as Record<string, unknown>)?.[key], data)
        return `${field}: ${timeProblem(value, format === 'jezo-time' ? 'plan' : 'record')}`
      }
      if (e.keyword === 'required') return `${field === 'the item' ? '' : `${field}: `}missing the field "${(e.params as { missingProperty: string }).missingProperty}"`
      if (e.keyword === 'enum') return `${field} must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`
      return `${field} ${e.message}`
    })
  }
}
