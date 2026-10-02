// UI translation. Each plugin brings its own strings under its own namespace
// (the plugin id), so a user's plugin can add a language the same way the
// built-in ones do. Strings shared by the shell and shared components live in
// the "common" namespace.

import { enUS, zhCN as dateZhCN, zhTW as dateZhTW, type Locale } from 'date-fns/locale'
import i18n from 'i18next'
import { type Language, LANGUAGES, languageOf } from '../../../shared/language'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import zhCN from '@/locales/zh-CN.json'
import zhTW from '@/locales/zh-TW.json'

export { LANGUAGES, type Language }
export type LanguageSetting = Language | 'system'

export const LANGUAGE_NAMES: Record<Language, string> = { 'zh-CN': '简体中文', 'zh-TW': '繁體中文', en: 'English' }

const LANGUAGE_KEY = 'jezo.language'

/** The OS language, narrowed to one Jezo has. */
const systemLanguage = () => languageOf(navigator.language)

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
  resources: { 'zh-CN': { common: zhCN }, 'zh-TW': { common: zhTW }, en: { common: en } },
  interpolation: { escapeValue: false }, // React escapes already.
  returnNull: false,
})
document.documentElement.lang = i18n.language
window.jezo.setLanguage(i18n.language)

/** date-fns's words for the app's language, for the date pickers and the calendar. */
export const dateLocale = (): Locale => ({ 'zh-CN': dateZhCN, 'zh-TW': dateZhTW })[i18n.language] ?? enUS

/** Adds a plugin's strings, one file per language, under the plugin's id. */
export function addPluginStrings(pluginId: string, locales: Record<string, object>) {
  for (const [language, strings] of Object.entries(locales)) {
    i18n.addResourceBundle(language, pluginId, strings, true, true)
  }
}

export default i18n
