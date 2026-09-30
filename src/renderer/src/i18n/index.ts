// UI translation. Each plugin brings its own strings under its own namespace
// (the plugin id), so a user's plugin can add a language the same way the
// built-in ones do. Strings shared by the shell and shared components live in
// the "common" namespace.

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import zhTW from '@/locales/zh-TW.json'

export const LANGUAGES = ['zh-TW', 'en'] as const
export type Language = (typeof LANGUAGES)[number]
export type LanguageSetting = Language | 'system'

/** Each language by its own name, so anyone can find theirs. */
export const LANGUAGE_NAMES: Record<Language, string> = { 'zh-TW': '繁體中文', en: 'English' }

const LANGUAGE_KEY = 'jezo.language'

/** The OS language, narrowed to one Jezo has. Other languages fall back to English. */
function systemLanguage(): Language {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-TW' : 'en'
}

export function storedLanguage(): LanguageSetting {
  try {
    const v = localStorage.getItem(LANGUAGE_KEY)
    if (v === 'system' || LANGUAGES.includes(v as Language)) return v as LanguageSetting
  } catch {
    // Storage can be unavailable; follow the system.
  }
  return 'system'
}

export function applyLanguage(setting: LanguageSetting) {
  try {
    localStorage.setItem(LANGUAGE_KEY, setting)
  } catch {
    // Not remembering the choice is acceptable.
  }
  const language = setting === 'system' ? systemLanguage() : setting
  document.documentElement.lang = language
  window.jezo.setLanguage(language)
  return i18n.changeLanguage(language)
}

i18n.use(initReactI18next).init({
  lng: storedLanguage() === 'system' ? systemLanguage() : (storedLanguage() as Language),
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common'],
  resources: { 'zh-TW': { common: zhTW }, en: { common: en } },
  interpolation: { escapeValue: false }, // React escapes already.
  returnNull: false,
})
document.documentElement.lang = i18n.language
window.jezo.setLanguage(i18n.language)

/** Adds a plugin's strings, one file per language, under the plugin's id. */
export function addPluginStrings(pluginId: string, locales: Record<string, object>) {
  for (const [language, strings] of Object.entries(locales)) {
    i18n.addResourceBundle(language, pluginId, strings, true, true)
  }
}

export default i18n
