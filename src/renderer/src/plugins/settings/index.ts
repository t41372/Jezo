import type { Plugin } from '@/app/registry'
import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'
import { Settings } from './Settings'

export const settings: Plugin = {
  id: 'settings',
  widgets: { settings: Settings },
  pages: [page],
  locales: { 'zh-TW': zhTW, en },
}
