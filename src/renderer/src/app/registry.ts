// Every page is made of plugins, built-in pages included (AGENTS.md, principle 7).
// Built-in plugins register here exactly the way a user's plugin will.
//
// The contract is provisional: it's the minimum the current pages need, and it
// gets settled once a second, independent plugin exists (docs/design/frontend.md).

import type { ComponentType } from 'react'
import { parse } from 'yaml'
import i18n, { addPluginStrings } from '@/i18n'

/** A widget receives the `props` its layout node gives it. */
export type Widget = ComponentType<Record<string, unknown>>

/**
 * Draws a message of a kind the plugin brings, in a conversation or anywhere
 * else it's shown. `index` is the message's position in its session.
 */
export type MessageView = ComponentType<{ data: unknown; sessionId: string; index: number }>

/**
 * A page layout. A row or column lays its children out with flexbox; each
 * widget decides its own width or height.
 */
export type LayoutNode =
  | { widget: string; props?: Record<string, unknown> }
  | { row: LayoutNode[] }
  | { column: LayoutNode[] }

export interface Page {
  id: string
  /** The plugin that registered the page. */
  plugin: string
  /** A key in the plugin's strings. A title with no matching key is shown as written. */
  title: string
  /** A Lucide icon name, like "calendar". */
  icon: string
  /** Position in the icon rail, lowest first. */
  order: number
  /** Which end of the icon rail the page sits at. Settings-like pages go at the bottom. */
  rail?: 'top' | 'bottom'
  layout: LayoutNode
}

export interface Plugin {
  id: string
  /** Widgets by name. They're registered as "<plugin id>.<name>". */
  widgets?: Record<string, Widget>
  /** Page definitions, as YAML text. */
  pages?: string[]
  /** UI strings by language, like { "zh-TW": {...}, en: {...} }. They become the plugin's namespace. */
  locales?: Record<string, object>
  /** Views for the plugin's own message types. They're registered as "<plugin id>.<type>". */
  messages?: Record<string, MessageView>
}

const widgets = new Map<string, Widget>()
const messageViews = new Map<string, MessageView>()
const pages = new Map<string, Page>()

export function registerPlugin(plugin: Plugin) {
  if (plugin.locales) addPluginStrings(plugin.id, plugin.locales)
  for (const [name, widget] of Object.entries(plugin.widgets ?? {})) {
    widgets.set(`${plugin.id}.${name}`, widget)
  }
  for (const [type, view] of Object.entries(plugin.messages ?? {})) {
    messageViews.set(`${plugin.id}.${type}`, view)
  }
  for (const text of plugin.pages ?? []) {
    const page = parsePage(text, plugin.id)
    pages.set(page.id, page)
  }
}

export const getWidget = (id: string) => widgets.get(id)
export const getPage = (id: string) => pages.get(id)
export const getMessageView = (id: string) => messageViews.get(id)
export const listPages = () => [...pages.values()].sort((a, b) => a.order - b.order)

/** A page's title in the current language. */
export const pageTitle = (page: Page) => (i18n.t as (key: string, options: object) => string)(page.title, { ns: page.plugin })

function parsePage(text: string, pluginId: string): Page {
  const page = { ...(parse(text) as Partial<Page>), plugin: pluginId }
  const missing = (['id', 'title', 'icon', 'order', 'layout'] as const).filter((key) => page[key] === undefined)
  if (missing.length) {
    throw new Error(`A page in plugin "${pluginId}" is missing ${missing.join(', ')}`)
  }
  return page as Page
}
