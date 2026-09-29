// Checks that every language has the same UI strings as Traditional Chinese,
// the reference. Plural forms differ between languages (Chinese has only
// "_other", English has "_one" and "_other"), so they're compared by base key.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dir, '../src/renderer/src')
const REFERENCE = 'zh-TW.json'
const PLURAL = /_(zero|one|two|few|many|other)$/

function keys(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix.replace(PLURAL, '')]
  return Object.entries(value).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k))
}

const dirs = [join(root, 'locales'), ...readdirSync(join(root, 'plugins')).map((p) => join(root, 'plugins', p, 'locales'))]
let problems = 0

for (const dir of dirs) {
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json'))
  } catch {
    continue // A plugin without strings.
  }
  const read = (f: string) => new Set(keys(JSON.parse(readFileSync(join(dir, f), 'utf8'))))
  const reference = read(REFERENCE)
  for (const file of files.filter((f) => f !== REFERENCE)) {
    const other = read(file)
    const where = `${dirname(dir).replace(root + '/', '')}/locales/${file}`
    for (const k of reference) if (!other.has(k)) (problems++, console.error(`${where}: missing "${k}"`))
    for (const k of other) if (!reference.has(k)) (problems++, console.error(`${where}: "${k}" isn't in ${REFERENCE}`))
  }
}

if (problems) process.exit(1)
console.log('Locales match.')
