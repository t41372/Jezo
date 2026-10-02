import type { Plugin } from '@/app/registry'
import { Goals } from './Goals'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'

export const goals: Plugin = {
  id: 'goals',
  widgets: { goals: Goals },
  pages: [page],
  locales: { 'zh-CN': zhCN, 'zh-TW': zhTW, en },
}
