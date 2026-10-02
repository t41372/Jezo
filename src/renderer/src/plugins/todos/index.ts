import type { Plugin } from '@/app/registry'
import { List } from './List'
import { ListDetail } from './ListDetail'
import en from './locales/en.json'
import zhTW from './locales/zh-TW.json'
import page from './page.yaml?raw'

export const todos: Plugin = {
  id: 'todos',
  widgets: { list: List, detail: ListDetail },
  pages: [page],
  locales: { 'zh-TW': zhTW, en },
}
