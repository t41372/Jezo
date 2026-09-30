// Checks an item's fields against the JSON Schema in its manifest. The messages
// go to the agent when it writes something wrong, so they name the field.

import { Ajv } from 'ajv'

/** Returns what's wrong, or an empty list. */
export type Check = (data: unknown) => string[]

const ajv = new Ajv({ allErrors: true, strict: false })

export function compileSchema(schema: object): Check {
  const validate = ajv.compile(schema)
  return (data) => {
    if (validate(data)) return []
    return (validate.errors ?? []).map((e) => {
      const field = e.instancePath ? e.instancePath.slice(1).replace(/\//g, '.') : 'the item'
      if (e.keyword === 'required') return `${field === 'the item' ? '' : `${field}: `}missing the field "${(e.params as { missingProperty: string }).missingProperty}"`
      if (e.keyword === 'enum') return `${field} must be one of ${(e.params as { allowedValues: unknown[] }).allowedValues.join(', ')}`
      return `${field} ${e.message}`
    })
  }
}
