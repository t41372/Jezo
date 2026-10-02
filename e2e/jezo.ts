// Starts Jezo the way a user would, but with a workspace and app data of its
// own: the mockup's sample data, dated to today (scripts/fixture.ts).

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
  /** The app's own data, including pi settings and encrypted keychain records. */
  data: string
  /** Restarts the real app with the same workspace and app data. */
  restart(): Promise<void>
  /** An item file's frontmatter and body, read from disk. */
  read(path: string): { data: Record<string, unknown>; body: string }
  /** Every item in a plugin's directory, read from disk. */
  items(dir: string): { file: string; data: Record<string, unknown>; body: string }[]
  /** Errors the page reported. A test ends by expecting none. */
  errors: string[]
}

// Playwright takes a function option for a fixture, so the hook is wrapped in an object.
interface Prepare {
  /** Changes the workspace before the app opens it. */
  workspace?(root: string): void
  /** Changes the app's data (config.json and the like) before the app starts. */
  data?(dir: string): void
  /** Extra Chromium switches, like a fake microphone. */
  args?: string[]
  /** null leaves the agent's model unpicked, as on a new install. */
  model?: null
}

/**
 * The agent's model in every test, picked in the test's own config.json. Unpicked,
 * Jezo would use whatever LM Studio has loaded, so a test's model would change
 * with what the developer is using (e2e/setup.ts loads this one).
 */
export const TEST_MODEL = process.env.JEZO_TEST_MODEL ?? 'qwen3.6-35b-a3b-splash'

export const test = base.extend<{ jezo: Jezo; prepare: Prepare }>({
  prepare: [{}, { option: true }],
  jezo: async ({ prepare }, use, info) => {
    const dir = mkdtempSync(join(tmpdir(), 'jezo-e2e-'))
    const root = join(dir, 'workspace')
    execFileSync('bun', ['scripts/fixture.ts', root], { cwd: repo })
    // Automations are off unless a test turns one on, so nothing starts on its own mid-test.
    for (const file of readdirSync(join(root, 'automations/items'))) {
      const path = join(root, 'automations/items', file)
      writeFileSync(path, readFileSync(path, 'utf8').replace(/^state: on$/m, 'state: off'))
    }
    prepare.workspace?.(root)
    mkdirSync(join(dir, 'data'), { recursive: true })
    if (prepare.model !== null) {
      writeFileSync(join(dir, 'data/config.json'), JSON.stringify({ models: { main: { provider: 'lmstudio', id: TEST_MODEL } } }))
      info.annotations.push({ type: 'model', description: `lmstudio/${TEST_MODEL}` })
    }
    prepare.data?.(join(dir, 'data'))
    const launchOptions = {
      executablePath: electronPath,
      args: [join(repo, 'out/main/index.js'), ...(prepare.args ?? [])],
      // In the background, so the tests don't take the keyboard from whoever is using the computer.
      env: { ...process.env, JEZO_WORKSPACE: root, JEZO_USER_DATA: join(dir, 'data'), JEZO_IN_BACKGROUND: '1' },
    }
    let app = await electron.launch(launchOptions)
    // The ⌥X window is created too; the main window is the one showing index.html.
    let page = app.windows().find((w) => w.url().includes('/index.html'))
    while (!page) {
      await app.waitForEvent('window')
      page = app.windows().find((w) => w.url().includes('/index.html'))
    }
    await fixSize(app)
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
        .flatMap((file) => {
          // The app may remove a file between listing and reading it.
          try {
            return [{ file, ...read(`${plugin}/items/${file}`) }]
          } catch {
            return []
          }
        })
    const jezo: Jezo = { app, page, root, data: join(dir, 'data'), read, items, errors, restart: async () => {
      await app.close()
      app = await electron.launch(launchOptions)
      let next = app.windows().find((w) => w.url().includes('/index.html'))
      while (!next) {
        await app.waitForEvent('window')
        next = app.windows().find((w) => w.url().includes('/index.html'))
      }
      await fixSize(app)
      next.on('pageerror', (e) => errors.push(String(e)))
      next.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
      // A crash can lose what the window had stored, so the language and theme are set again.
      if (await next.evaluate(() => localStorage.getItem('jezo.language') !== 'zh-TW')) {
        await next.evaluate(() => {
          localStorage.setItem('jezo.language', 'zh-TW')
          localStorage.setItem('jezo.theme', 'light')
        })
        await next.reload()
      }
      await next.locator('nav button').first().waitFor()
      jezo.app = app
      jezo.page = next
    } }
    await use(jezo)

    // The workspace as the test left it is part of the result.
    await info.attach('workspace', { body: root })
    await info.attach('app-data', { body: join(dir, 'data') })
    await app.close()
  },
})

export { expect } from '@playwright/test'

/** Whether a local model server (LM Studio or Ollama) answers. Tests with the agent skip without one. */
export async function localModel() {
  for (const url of ['http://localhost:1234/v1/models', 'http://localhost:11434/v1/models']) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true
    } catch {
      // Not running.
    }
  }
  return false
}

/** Goes to a page by its rail label. */
/**
 * The main window laid out at the size it opens at on a usual screen, 1320 × 840.
 * CI's Macs have a 1024 × 768 screen, which macOS won't put a bigger window on,
 * and the calendar's columns and drawer then land elsewhere than the tests
 * expect; there the page is zoomed out until it's that size inside the window.
 */
async function fixSize(app: ElectronApplication) {
  await app.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/index.html'))
    if (!window) return
    window.setContentSize(1320, 840)
    // A hidden window reports the size it was given; what it's drawn at is held to the screen.
    const area = screen.getPrimaryDisplay().workAreaSize
    const [width, height] = window.getContentSize()
    window.webContents.setZoomFactor(Math.min(1, width / 1320, height / 840, area.width / 1320, (area.height - 28) / 840))
  })
}

export const open = (page: Page, label: string) => page.locator('nav button', { hasText: label }).first().click()

/** When a time from a todo's file happens, in milliseconds; a local time is read in Taipei, the tests' zone. */
export const momentOf = (time: string) =>
  (time.includes('[') || /[+-]\d{2}:\d{2}$|Z$/.test(time) ? Temporal.ZonedDateTime.from(time.includes('[') ? time : `${time}[UTC]`, { offset: 'use' }) : Temporal.PlainDateTime.from(time).toZonedDateTime('Asia/Taipei')).epochMilliseconds

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
