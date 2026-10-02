// Types the translation keys, so a mistyped key fails the typecheck.
// The Traditional Chinese files are the reference; en.json must have the same keys
// (bun run check:i18n).

import type common from '@/locales/zh-TW.json'
import type calendar from '@/plugins/calendar/locales/zh-TW.json'
import type chat from '@/plugins/chat/locales/zh-TW.json'
import type goals from '@/plugins/goals/locales/zh-TW.json'
import type more from '@/plugins/more/locales/zh-TW.json'
import type notes from '@/plugins/notes/locales/zh-TW.json'
import type settings from '@/plugins/settings/locales/zh-TW.json'
import type today from '@/plugins/today/locales/zh-TW.json'
import type todos from '@/plugins/todos/locales/zh-TW.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common'
    resources: { common: typeof common; chat: typeof chat; today: typeof today; todos: typeof todos; calendar: typeof calendar; goals: typeof goals; more: typeof more; notes: typeof notes; settings: typeof settings }
  }
}
