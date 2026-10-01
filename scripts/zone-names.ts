// Writes the city names zones are searched and shown by, for each language the
// app ships (src/renderer/src/locales), from Unicode CLDR's exemplar cities: the
// data ICU itself uses, maintained upstream. Nothing here is a list of ours.
// Run it after adding a language or updating cldr-dates-modern:
//
//   bun run zone-names

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const cldr = join(root, 'node_modules/cldr-dates-modern/main')
const out = join(root, 'src/renderer/src/lib/zone-names')
const available = new Set(readdirSync(cldr))

/** CLDR's folder for an app language: zh-TW is zh-Hant-TW, then zh-Hant. */
function folderFor(language: string) {
  const { language: l, script, region } = new Intl.Locale(language).maximize()
  return [`${l}-${script}-${region}`, `${l}-${script}`, `${l}-${region}`, l].find((name) => available.has(name))
}

type Node = { exemplarCity?: string; long?: unknown; short?: unknown; [key: string]: unknown }

/** The zone tree flattened to "Asia/Tokyo" → "東京". A zone is a node with names; the rest are areas. */
function cities(tree: Record<string, Node>, prefix = ''): [string, string][] {
  return Object.entries(tree).flatMap(([key, node]): [string, string][] => {
    if (typeof node.exemplarCity === 'string') return [[`${prefix}${key}`, node.exemplarCity]]
    if ('long' in node || 'short' in node) return []
    return cities(node as Record<string, Node>, `${prefix}${key}/`)
  })
}

for (const file of readdirSync(join(root, 'src/renderer/src/locales')).filter((f) => f.endsWith('.json'))) {
  const language = file.replace(/\.json$/, '')
  const folder = folderFor(language)
  if (!folder) throw new Error(`CLDR has no dates for ${language}.`)
  const data = JSON.parse(readFileSync(join(cldr, folder, 'timeZoneNames.json'), 'utf8'))
  const names = Object.fromEntries(cities(data.main[folder].dates.timeZoneNames.zone).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(out, `${language}.json`), `${JSON.stringify(names, null, 1)}\n`)
  console.log(`${language}: ${Object.keys(names).length} cities from CLDR ${folder}`)
}
