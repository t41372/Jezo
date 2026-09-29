import type { Plugin } from '@/app/registry'
import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'
import { Notes } from './Notes'
import page from './page.yaml?raw'
import { SortCard } from './SortCard'

/**
 * 隨手記: a place to jot things down without sorting them, and hand them to the
 * agent to sort. It's a first-party plugin, built the way a user's would be: it
 * brings its page, its strings, and its own kind of chat message.
 */
export const notes: Plugin = {
  id: 'notes',
  widgets: { notes: Notes },
  pages: [page],
  locales: { 'zh-TW': zhTW, en },
  messages: { sort: SortCard },
}
