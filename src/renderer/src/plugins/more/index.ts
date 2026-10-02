import type { Plugin } from '@/app/registry'
import { More } from './More'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'

export const more: Plugin = {
  id: 'more',
  widgets: { more: More },
  pages: [page],
  locales: { 'zh-CN': zhCN, 'zh-TW': zhTW, en },
}
