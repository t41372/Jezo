import type { Plugin } from '@/app/registry'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'
import { Sessions } from './Sessions'
import { Thread } from './Thread'

export const chat: Plugin = {
  id: 'chat',
  widgets: { sessions: Sessions, thread: Thread },
  pages: [page],
  locales: { 'zh-CN': zhCN, 'zh-TW': zhTW, en },
}
