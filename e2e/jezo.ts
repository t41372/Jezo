// Starts Jezo the way a user would, but with a workspace and app data of its
// own: the mockup's sample data, dated to today (scripts/fixture.ts).

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, test as base, type ElectronApplication, type Page } from '@playwright/test'
import { parse } from '../src/main/workspace/frontmatter'

const repo = join(import.meta.dirname, '..')
const electronPath = createRequire(join(repo, 'package.json'))('electron') as string

export interface Jezo {
  app: ElectronApplication
  page: Page
  /** The test's workspace. */
  root: string
  /** An item file's frontmatter and body, read from disk. */
  read(path: string): { data: Record<string, unknown>; body: string }
  /** Every item in a plugin's directory, read from disk. */
  items(dir: string): { file: string; data: Record<string, unknown>; body: string }[]
  /** Errors the page reported. A test ends by expecting none. */
  errors: string[]
}

// Playwright takes a function option for a fixture, so the hook is wrapped in an object.
export const test = base.extend<{ jezo: Jezo; prepare: { workspace(root: string): void } }>({
  /** Changes the workspace before the app opens it. */
  prepare: [{ workspace: () => {} }, { option: true }],
  jezo: async ({ prepare }, use, info) => {
    const dir = mkdtempSync(join(tmpdir(), 'jezo-e2e-'))
    const root = join(dir, 'workspace')
    execFileSync('bun', ['scripts/fixture.ts', root], { cwd: repo })
    prepare.workspace(root)
    const app = await electron.launch({
      executablePath: electronPath,
      args: [join(repo, 'out/main/index.js')],
      env: { ...process.env, JEZO_WORKSPACE: root, JEZO_USER_DATA: join(dir, 'data') },
    })
    // The ⌥X window is created too; the main window is the one showing index.html.
    let page = app.windows().find((w) => w.url().includes('/index.html'))
    while (!page) {
      await app.waitForEvent('window')
      page = app.windows().find((w) => w.url().includes('/index.html'))
    }
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    await page.evaluate(() => {
      localStorage.setItem('jezo.language', 'zh-TW')
      localStorage.setItem('jezo.theme', 'light')
    })
    await page.reload()
    await page.locator('nav button').first().waitFor()

    const read = (path: string) => parse(readFileSync(join(root, path), 'utf8'))
    const items = (plugin: string) =>
      readdirSync(join(root, plugin, 'items'))
        .filter((file) => file.endsWith('.md'))
        .map((file) => ({ file, ...read(`${plugin}/items/${file}`) }))
    await use({ app, page, root, read, items, errors })

    // The workspace as the test left it is part of the result.
    await info.attach('workspace', { body: root })
    await app.close()
  },
})

export { expect } from '@playwright/test'

/** Goes to a page by its rail label. */
export const open = (page: Page, label: string) => page.locator('nav button', { hasText: label }).first().click()

/** Drags with the mouse in small steps, the way a hand does, so drag libraries see a real gesture. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 16; i++) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16)
    await page.waitForTimeout(16)
  }
  await page.waitForTimeout(150)
  await page.mouse.up()
}
