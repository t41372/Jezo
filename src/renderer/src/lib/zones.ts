import i18n from '@/i18n'

/**
 * City names by language, from Unicode CLDR (`bun run zone-names` writes them
 * for each language the app ships). Where a language has none, the zone's own
 * name is the city.
 */
const CITIES = Object.fromEntries(
  Object.entries(import.meta.glob<Record<string, string>>('./zone-names/*.json', { eager: true, import: 'default' })).map(([path, names]) => [path.replace(/^.*\/(.+)\.json$/, '$1'), names]),
)

/** A zone's city, the way people name it in a language: "America/Los_Angeles" → "洛杉磯", or "Los Angeles". */
export const cityOf = (zone: string, language = i18n.language) => CITIES[language]?.[zone] ?? CITIES.en?.[zone] ?? zone.split('/').pop()!.replace(/_/g, ' ')
