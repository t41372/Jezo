// The languages Jezo's interface comes in, and which one a system locale gets.

export const LANGUAGES = ['zh-CN', 'zh-TW', 'en'] as const
export type Language = (typeof LANGUAGES)[number]

/**
 * A locale narrowed to a language Jezo has: Chinese by its script (Traditional
 * for Taiwan, Hong Kong and Macau, or a locale that says Hant; Simplified
 * otherwise), and English for every other language.
 */
export function languageOf(locale: string): Language {
  const tag = locale.toLowerCase()
  if (!tag.startsWith('zh')) return 'en'
  return /hant|-tw|-hk|-mo/.test(tag) ? 'zh-TW' : 'zh-CN'
}
