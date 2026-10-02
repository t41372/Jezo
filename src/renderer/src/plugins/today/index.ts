import type { Plugin } from '@/app/registry'
import { Agenda } from './Agenda'
import { TodayDetail } from './TodayDetail'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'

export const today: Plugin = {
  id: 'today',
  widgets: { agenda: Agenda, detail: TodayDetail },
  pages: [page],
  locales: { 'zh-CN': zhCN, 'zh-TW': zhTW, en },
}
