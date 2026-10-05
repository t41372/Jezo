// Holding ⌥X to talk, from the microphone to the agent. Chromium's fake
// microphone plays a sentence macOS speaks; the ⌥X window streams it to
// Standard ASR. Setup goes through the public IPC; e2e/asr.spec.ts covers 設定.
// Needs macOS on Apple Silicon, uv, and a local model server.

import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, open, test } from './jezo'
import { fakeMicrophone, spoken } from './speech-audio'

const ready =
  process.platform === 'darwin' &&
  process.arch === 'arm64' &&
  (() => {
    try {
      execFileSync('uv', ['--version'])
      return true
    } catch {
      return false
    }
  })()

/** What the ⌥X key sends the window when it's held and released. The key itself is the OS's. */
function hotkey(app: ElectronApplication, kind: 'voice-start' | 'voice-end') {
  return app.evaluate(({ BrowserWindow }, kind) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick.html'))!
    window.showInactive()
    window.webContents.send('quick:command', kind === 'voice-start' ? { kind, context: '今天' } : { kind })
  }, kind)
}

/** The one-click install, through the same IPC call 設定 makes. */
async function install(page: Page) {
  await page.evaluate(() => window.jezo.speech.install())
  const status = await page.evaluate(() => window.jezo.speech.status())
  expect(status.installed).toBe(true)
  expect(status.step).toBeNull()
  expect(status.error).toBeNull()
}

/** A todo in the backlog whose name a recognizer gets wrong on its own: 鵝鑾鼻 comes out 俄伦鼻. */
function campingTodo(root: string) {
  mkdirSync(join(root, 'todos/items'), { recursive: true })
  writeFileSync(
    join(root, 'todos/items/t-camp.md'),
    '---\nid: t-camp\ntitle: 整理鵝鑾鼻露營裝備\nstate: open\nestimate: 40\n---\n',
  )
}

test.describe('dictation knows the words in the workspace', { tag: '@speech' }, () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 600_000 })
  test.use({
    prepare: {
      model: null,
      workspace: campingTodo,
      args: fakeMicrophone(ready ? spoken('我要整理鵝鑾鼻露營裝備') : ''),
    },
  })

  test("a todo's name comes out the way it's written in the todo", async ({ jezo }) => {
    const { app, page } = jezo
    await install(page)
    const quick = app.windows().find((w) => w.url().includes('/quick.html'))!
    await hotkey(app, 'voice-start')
    await expect(quick.getByText(/露營/)).toBeVisible({ timeout: 30_000 })
    await quick.waitForTimeout(1500)
    // Without the todo's name to go on, the model writes 俄伦鼻.
    await expect(quick.getByText(/鵝鑾鼻露營裝備/)).toBeVisible()
    expect(jezo.errors).toEqual([])
  })
})

test.describe('holding ⌥X with nothing said', { tag: '@speech' }, () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 600_000 })
  test.use({ prepare: { model: null, workspace: campingTodo, args: fakeMicrophone(ready ? spoken('') : '') } })

  test('hears nothing, rather than the words it was told to expect', async ({ jezo }) => {
    const { app, page } = jezo
    await install(page)
    const quick = app.windows().find((w) => w.url().includes('/quick.html'))!
    await hotkey(app, 'voice-start')
    await expect(quick.getByText('在聽…')).toBeVisible({ timeout: 30_000 })
    // Long enough for several passes over the silence. Handed back, the context would show the todo's name.
    await quick.waitForTimeout(6000)
    await expect(quick.locator('body')).not.toContainText('鵝鑾鼻')
    await hotkey(app, 'voice-end')
    await quick.waitForTimeout(1500)
    await expect(quick.locator('body')).not.toContainText('鵝鑾鼻')
    expect(jezo.errors).toEqual([])
  })
})

/** The engine commit an install in this app data was made from, from what pip recorded. */
function engineCommit(data: string) {
  const lib = join(data, 'speech/venv/lib')
  try {
    for (const python of readdirSync(lib)) {
      const site = join(lib, python, 'site-packages')
      const info = readdirSync(site).find((name) => name.startsWith('std_mlx_audio-') && name.endsWith('.dist-info'))
      if (info)
        return JSON.parse(readFileSync(join(site, info, 'direct_url.json'), 'utf8')).vcs_info.commit_id as string
    }
  } catch {
    // Not there yet.
  }
  return null
}

const OLD_ENGINE = '6b1044586c263ecee550124a7567504385d49e24'

test.describe('an install from before this Jezo', { tag: '@speech' }, () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 600_000 })
  test.use({
    prepare: {
      model: null,
      // What 設定 installed when Jezo named an older engine commit, the way it installs.
      data: (dir) => {
        const venv = join(dir, 'speech/venv')
        execFileSync('uv', ['venv', '--python', '3.12', venv])
        const core =
          'standard-asr[server] @ git+https://github.com/standard-voice/standard_asr.git@1b2cf3fa5860c075e5160eb60b26b708a7c8bfea'
        writeFileSync(join(dir, 'speech/overrides.txt'), `${core}\n`)
        // From the speech folder, as Jezo does: uv cuts an --overrides path at a space.
        execFileSync(
          'uv',
          [
            'pip',
            'install',
            '--python',
            join(venv, 'bin/python'),
            '--overrides',
            'overrides.txt',
            core,
            `std-mlx-audio @ git+https://github.com/standard-voice/std-mlx-audio.git@${OLD_ENGINE}`,
          ],
          { cwd: join(dir, 'speech') },
        )
      },
    },
  })

  test('keeps the installed version until the owner updates core and engine together', async ({ jezo }, info) => {
    const { page, data } = jezo
    expect(engineCommit(data)).toBe(OLD_ENGINE)
    await page.evaluate(() => window.jezo.speech.command({ kind: 'refresh' }))
    expect(engineCommit(data)).toBe(OLD_ENGINE)
    const before = await page.evaluate(() => window.jezo.speech.inventory())
    expect(before.runtime).toEqual({ stableText: false, sessionCapabilityChecks: false })
    await page.evaluate(() => window.jezo.speech.command({ kind: 'checkUpdates' }))
    const update = await page.evaluate(async () => (await window.jezo.speech.inventory()).updates.find((item) => item.name === 'std-mlx-audio'))
    expect(update?.error).toBeNull()
    expect(update?.requirement).toBeTruthy()
    expect(update?.latest).toMatch(/^[0-9a-f]{40}$/)
    await page.evaluate(() => window.jezo.speech.command({ kind: 'updatePackages', names: ['standard-asr', 'std-mlx-audio'] }))
    await expect.poll(() => engineCommit(data), { timeout: 300_000 }).toBe(update!.latest)
    const after = await page.evaluate(() => window.jezo.speech.inventory())
    expect(after.runtime).toEqual({ stableText: true, sessionCapabilityChecks: true })
    expect(after.models.filter((model) => model.error)).toEqual([])
    await jezo.restart()
    expect((await jezo.page.evaluate(() => window.jezo.speech.inventory())).runtime).toEqual(after.runtime)
    await info.attach('manual-contract-upgrade', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' })
    expect(jezo.errors).toEqual([])
  })
})

test.describe('holding ⌥X', { tag: '@speech' }, () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 600_000 })
  test.use({
    prepare: { args: fakeMicrophone(ready ? spoken('幫我把打給媽排到明天晚上八點') : '') },
  })

  test('turns what was said into a request the agent acts on', async ({ jezo }) => {
    const { app, page, read } = jezo
    await install(page)
    const quick = app.windows().find((w) => w.url().includes('/quick.html'))!
    await hotkey(app, 'voice-start')
    // The words appear while they're said, in Traditional Chinese.
    await expect(quick.getByText(/打給媽/)).toBeVisible({ timeout: 30_000 })
    await quick.waitForTimeout(1500)
    await hotkey(app, 'voice-end')

    // What was said is sent as the question, and shows as one.
    await expect(quick.locator('[data-selectable]').first()).toHaveText(/打給媽.*明天晚上八點/, { timeout: 30_000 })
    await expect
      .poll(() => read('todos/items/t-u2.md').data.scheduled, { timeout: 240_000 })
      .toMatch(/T20:00(\[Asia\/Taipei\])?$/)
  })
})

test.describe('dictating in the chat box', { tag: '@speech' }, () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 600_000 })
  const long =
    '我今天想把升等文件的影響那一段寫完，然後下午去健身房，晚上再打電話給媽媽，問她週末要不要一起吃飯，順便把露營的東西整理好。'
  test.use({ prepare: { model: null, args: fakeMicrophone(ready ? spoken(long) : '') } })

  test('what is heard grows the box with it, and stays inside it', async ({ jezo }, info) => {
    const { page } = jezo
    await install(page)
    await open(page, '聊天')
    const box = page.locator('main textarea').first()
    const card = box.locator('xpath=ancestor::div[contains(@class, "rounded-[26px]")]')
    const before = (await card.boundingBox())!.height
    await page.locator('main').getByRole('button', { name: '用說的' }).click()
    const heard = page.locator('main [aria-live="polite"]')
    await expect(heard).toContainText('健身房', { timeout: 60_000 })
    await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(before + 20)
    // Everything heard is drawn inside the box: nothing hangs below its edge.
    const inner = (await heard.boundingBox())!
    const outer = (await card.boundingBox())!
    expect(inner.y + inner.height).toBeLessThanOrEqual(outer.y + outer.height + 1)
    await info.attach('dictating', { body: await page.screenshot(), contentType: 'image/png' })
    expect(jezo.errors).toEqual([])
  })
})
