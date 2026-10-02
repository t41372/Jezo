import type { Plugin } from '@/app/registry'
import { Backlog } from './Backlog'
import { Calendar } from './Calendar'
import { CalendarDetail } from './CalendarDetail'
import en from './locales/en.json'
import zhCN from './locales/zh-CN.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'

export const calendar: Plugin = {
  id: 'calendar',
  widgets: { backlog: Backlog, grid: Calendar, detail: CalendarDetail },
  pages: [page],
  locales: { 'zh-CN': zhCN, 'zh-TW': zhTW, en },
}
