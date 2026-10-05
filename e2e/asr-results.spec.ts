// Protocol edge cases in the real app. The installed replay plugin supplies
// controlled SDK events; actual microphone capture, sidecar, IPC and UI run normally.
import { join } from 'node:path'
import { copyFileSync, mkdirSync } from 'node:fs'
import { expect, open, test } from './jezo'
import { fakeMicrophone, spoken } from './speech-audio'

const ready = process.platform === 'darwin' && process.arch === 'arm64'
const model = 'jezo-replay/session'

test.describe('dictation result ownership', { tag: '@speech' }, () => {
  test.skip(!ready, 'Requires macOS, uv and the Standard ASR SDK.')
  test.describe.configure({ timeout: 300_000 })
  test.use({ prepare: { model: null, args: fakeMicrophone(ready ? spoken('') : '') } })

  test('empty finals, late errors and microphone takeover preserve the right text', async ({ jezo }, info) => {
    const { app, page } = jezo
    // Package builders write beside their source; keep that work in this run's app data.
    const plugin = join(jezo.data, 'replay plugin')
    mkdirSync(plugin)
    for (const file of ['pyproject.toml', 'jezo_asr_replay.py'])
      copyFileSync(join(import.meta.dirname, 'fixtures/asr-replay', file), join(plugin, file))
    await page.evaluate((requirement) => window.jezo.speech.command({ kind: 'installPlugin', requirement }), plugin)
    await page.evaluate((model) => window.jezo.speech.command({ kind: 'select', model }), model)
    const quick = app.windows().find((w) => w.url().includes('/quick.html'))!
    const command = (kind: 'voice-start' | 'voice-end') => app.evaluate(({ BrowserWindow }, kind) => {
      const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick.html'))!
      if (kind === 'voice-start') window.showInactive()
      window.webContents.send('quick:command', kind === 'voice-start' ? { kind, context: null } : { kind })
    }, kind)
    const hidden = () => app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick.html'))!.isVisible())
    const outcome = (outcome: 'empty' | 'failure' | 'final') => page.evaluate(({ model, outcome }) => window.jezo.speech.command({
      kind: 'saveModel', model, settings: { config: { outcome }, options: {}, provider: {} }, secrets: {},
    }), { model, outcome })
    const sessionsBefore = await page.evaluate(() => window.jezo.agent.list())

    await open(page, '聊天')
    const box = page.locator('main textarea').first()
    const start = () => page.locator('main').getByRole('button', { name: '用說的' }).click()
    const stop = () => page.locator('main').getByRole('button', { name: '說完了' }).click()
    const preview = page.locator('main [aria-live="polite"]')

    await box.fill('typed: ')
    await start()
    await expect(preview).toContainText('early draft')
    await stop()
    await command('voice-start')
    await expect(quick.getByText('early draft', { exact: true })).toBeVisible()
    await command('voice-end')
    await expect.poll(hidden).toBe(true)
    await expect(box).toHaveValue('typed: ')

    await outcome('failure')
    await start()
    await expect(preview).toContainText('early draft')
    await stop()
    await expect(box).toHaveValue('typed: latest editable draft')
    await command('voice-start')
    await expect(quick.getByText('early draft', { exact: true })).toBeVisible()
    await command('voice-end')
    await expect(quick.locator('textarea')).toHaveValue('latest editable draft')
    await expect(quick.getByText('Replay recognition failed', { exact: true })).toBeVisible()
    await info.attach('failed-draft', { body: await quick.screenshot(), contentType: 'image/png' })

    await outcome('empty')
    await box.fill('typed: ')
    await start()
    await expect(preview).toContainText('early draft')
    await command('voice-start')
    await expect(box).toHaveValue('typed: early draft')
    await expect(page.locator('main').getByRole('button', { name: '用說的' })).toBeVisible()
    await expect(quick.getByText('early draft', { exact: true })).toBeVisible()
    await command('voice-end')
    await expect.poll(hidden).toBe(true)
    await expect(box).toHaveValue('typed: early draft')

    await outcome('final')
    await start()
    await expect(preview).toContainText('early draft')
    await stop()
    await expect(box).toHaveValue('typed: early draft completed dictation')
    expect(await page.evaluate(() => window.jezo.agent.list())).toEqual(sessionsBefore)
    const inventory = await page.evaluate(() => window.jezo.speech.inventory())
    await info.attach('result-ownership', { body: JSON.stringify({ inventory, draft: await box.inputValue(), sessionsBefore }, null, 2), contentType: 'application/json' })
    expect(jezo.errors).toEqual([])
  })
})
