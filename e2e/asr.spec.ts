// 設定 → 語音辨識, used the way a person would: the one-click install, a
// second engine installed by its Git address, a model chosen, downloaded and
// configured, a credential kept in the keychain, and an engine uninstalled.
// Real plugins, real model files and real recognition, in the test's own app
// data. Needs macOS on Apple Silicon, uv and the network.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
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

const WHISPER = 'std-faster-whisper @ git+https://github.com/standard-voice/std-faster-whisper.git'
const sentence = 'Please remember to buy milk and eggs tomorrow morning.'

const config = (data: string) => JSON.parse(readFileSync(join(data, 'config.json'), 'utf8'))
const status = (page: Page) => page.evaluate(() => window.jezo.speech.status())

async function speechPage(page: Page) {
  await open(page, '設定')
  await page.getByRole('button', { name: /^語音辨識/ }).click()
  await expect(page.getByRole('heading', { name: '語音辨識', level: 1 })).toBeVisible()
}

/** Picks a model in the list on the left and waits for its details. */
async function pick(page: Page, name: string) {
  // A model with unsaved edits says so after its name.
  await page.locator('nav').last().getByRole('button', { name: new RegExp(`^${name.replace(/[.-]/g, '\\$&')}`) }).click()
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText('讀取中…')).toHaveCount(0, { timeout: 60_000 })
}

/** Opens a collapsed section of a model's settings. */
async function section(page: Page, name: string) {
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click()
}

/** Talks into the chat box with the fake microphone, and returns what lands in it. */
async function dictate(page: Page, live: boolean) {
  await open(page, '聊天')
  const box = page.locator('main textarea').first()
  await page.locator('main').getByRole('button', { name: '用說的' }).click()
  const heard = page.locator('main [aria-live="polite"]')
  if (live) await expect(heard).toContainText(/milk/i, { timeout: 60_000 })
  else {
    // A model that only recognizes the whole recording shows nothing while it listens.
    await page.waitForTimeout(8000)
    await expect(heard).not.toContainText(/milk/i)
  }
  await page.locator('main').getByRole('button', { name: '說完了' }).click()
  await expect(box).toHaveValue(/milk/i, { timeout: 60_000 })
  return box.inputValue()
}

test.describe('speech recognition in 設定', { tag: '@speech' }, () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 1_200_000 })
  test.use({ prepare: { model: null, args: fakeMicrophone(ready ? spoken(sentence, 'Samantha') : '') } })

  test('install, add an engine, choose and configure a model, keep a key, and uninstall', async ({ jezo }, info) => {
    const { page, data } = jezo
    await open(page, '設定')
    const row = page.getByRole('button', { name: /^語音辨識/ })

    // One click installs the suggested engine and model, and ⌥X uses it.
    await page.getByRole('button', { name: '安裝', exact: true }).click()
    await expect(row).toContainText('qwen3-asr-0.6b · mlx-audio', { timeout: 900_000 })
    await row.click()
    await expect(page.getByText('使用中', { exact: true })).toBeVisible({ timeout: 60_000 })
    await info.attach('installed', { body: await page.screenshot(), contentType: 'image/png' })

    // A second engine, by its Git address: its models show up under it.
    await page.getByRole('button', { name: '安裝引擎' }).click()
    await page.getByRole('textbox', { name: '套件' }).fill(WHISPER)
    await page.getByRole('dialog').getByRole('button', { name: '安裝', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 900_000 })
    await pick(page, 'tiny')
    await expect(page.getByText('std-faster-whisper · faster-whisper/tiny')).toBeVisible()
    // Looking at a model doesn't change the one ⌥X uses.
    expect((await status(page)).model).toBe('mlx-audio/qwen3-asr-0.6b')

    // An edit isn't lost by leaving the page; it waits, marked, until saved or reverted.
    await section(page, '模型載入')
    await page.getByRole('textbox', { name: '運算裝置' }).fill('cpu')
    await expect(page.getByText('有未儲存的變更')).toBeVisible()
    await open(page, '今天')
    await speechPage(page)
    await expect(page.locator('nav').last().getByRole('button', { name: /^tiny/ })).toContainText('未儲存')
    await pick(page, 'tiny')
    await section(page, '模型載入')
    await expect(page.getByRole('textbox', { name: '運算裝置' })).toHaveValue('cpu')
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText('有未儲存的變更')).toHaveCount(0, { timeout: 60_000 })
    expect(config(data).speech.models['faster-whisper/tiny'].config).toEqual({ device: 'cpu' })

    // A key goes to the keychain, never to config.json or back to the window.
    const marker = 'hf_e2e_marker_7f3a'
    await page.getByRole('textbox', { name: 'Hugging Face Token' }).fill(marker)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText('已儲存於鑰匙圈')).toBeVisible({ timeout: 60_000 })
    expect(readFileSync(join(data, 'config.json'), 'utf8')).not.toContain(marker)
    expect(readFileSync(join(data, 'keys.json'), 'utf8')).not.toContain(marker)
    const detail = await page.evaluate(() => window.jezo.speech.model('faster-whisper/tiny'))
    expect(JSON.stringify(detail)).not.toContain(marker)
    expect(detail.secrets).toEqual(['config:hf_token'])

    // A new key with a setting the engine refuses: nothing is saved, and the old key stays.
    await page.getByRole('button', { name: '更換' }).click()
    await page.getByRole('textbox', { name: 'Hugging Face Token' }).fill('hf_e2e_replacement')
    await page.getByRole('textbox', { name: 'Num Workers' }).fill('0')
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText(/儲存失敗/)).toBeVisible({ timeout: 60_000 })
    expect(config(data).speech.models['faster-whisper/tiny'].config).toEqual({ device: 'cpu' })
    expect((await page.evaluate(() => window.jezo.speech.model('faster-whisper/tiny'))).secrets).toEqual(['config:hf_token'])
    await info.attach('refused', { body: await page.screenshot(), contentType: 'image/png' })
    // Reverting drops both edits; removing the key and saving removes it.
    await page.getByRole('button', { name: '捨棄變更' }).click()
    await expect(page.getByRole('textbox', { name: 'Num Workers' })).toHaveValue('')
    await page.getByRole('button', { name: '移除 Hugging Face Token' }).click()
    await expect(page.getByText('儲存後移除')).toBeVisible()
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText('儲存後移除')).toHaveCount(0, { timeout: 60_000 })
    expect((await page.evaluate(() => window.jezo.speech.model('faster-whisper/tiny'))).secrets).toEqual([])

    // Chosen, it's what ⌥X uses, and it stays chosen after a restart.
    await page.getByRole('button', { name: /使用此模型|下載並使用/ }).click()
    await expect(page.getByText('使用中', { exact: true })).toBeVisible({ timeout: 600_000 })
    expect((await status(page)).model).toBe('faster-whisper/tiny')
    await jezo.restart()
    await open(jezo.page, '設定')
    await expect(jezo.page.getByRole('button', { name: /^語音辨識/ })).toContainText('tiny · faster-whisper', { timeout: 60_000 })
    const said = await dictate(jezo.page, true)
    info.annotations.push({ type: 'faster-whisper tiny heard', description: said })

    // Uninstalling the engine ⌥X uses: its models leave, ⌥X has no model, the other engine stays.
    await speechPage(jezo.page)
    await jezo.page.getByRole('button', { name: 'std-faster-whisper 選項' }).click()
    await jezo.page.getByRole('menuitem', { name: '解除安裝' }).click()
    await expect(jezo.page.getByRole('dialog')).toContainText('目前使用中的模型也屬於此引擎')
    await jezo.page.getByRole('dialog').getByRole('button', { name: '解除安裝' }).click()
    await expect(jezo.page.getByRole('dialog')).toHaveCount(0, { timeout: 300_000 })
    await expect(jezo.page.locator('nav').last().getByRole('button', { name: 'tiny', exact: true })).toHaveCount(0)
    await expect(jezo.page.locator('nav').last().getByRole('button', { name: 'qwen3-asr-0.6b', exact: true })).toBeVisible()
    expect((await status(jezo.page)).model).toBeNull()
    // Its files stay where they were: Jezo doesn't guess who else uses them.
    const location = detail.artifacts.streaming?.requirements[0]?.location
    expect(location && existsSync(location)).toBe(true)
    await open(jezo.page, '設定')
    await expect(jezo.page.getByRole('button', { name: /^語音辨識/ })).toContainText('尚未選擇模型')
    await info.attach('uninstalled', { body: await jezo.page.screenshot(), contentType: 'image/png' })
    expect(jezo.errors).toEqual([])
  })

  test('a whole-recording model in a new folder downloads before it is used', async ({ jezo }, info) => {
    const { page, data } = jezo
    await page.evaluate(() => window.jezo.speech.install())
    await speechPage(page)
    await pick(page, 'moonshine-tiny')
    await expect(page.getByText('批次辨識', { exact: true })).toBeVisible()

    // A folder with a space, where nothing has been downloaded yet.
    const folder = join(data, 'model files')
    await section(page, '模型載入')
    await page.getByRole('textbox', { name: '下載目錄' }).fill(folder)
    await page.getByRole('button', { name: '儲存', exact: true }).click()
    await expect(page.getByText('有未儲存的變更')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.getByText(/尚未下載/)).toBeVisible({ timeout: 60_000 })
    expect((await status(page)).model).toBe('mlx-audio/qwen3-asr-0.6b')

    await page.getByRole('button', { name: '下載並使用' }).click()
    await expect(page.getByText('使用中', { exact: true })).toBeVisible({ timeout: 600_000 })
    await expect(page.getByText(/^已下載/)).toBeVisible({ timeout: 60_000 })
    await page.getByText('檔案位置與版本').click()
    await expect(page.getByText(folder, { exact: false }).first()).toBeVisible()
    await info.attach('downloaded', { body: await page.screenshot(), contentType: 'image/png' })

    const said = await dictate(page, false)
    info.annotations.push({ type: 'moonshine-tiny heard', description: said })
    expect(jezo.errors).toEqual([])
  })

  test('nullable numbers keep explicit values through saving, navigation, restart and reset', async ({ jezo }, info) => {
    await jezo.page.evaluate(() => window.jezo.speech.install())
    const model = 'mlx-audio/qwen3-asr-0.6b'
    const choice = async (name: string, value: '空值' | '使用預設值') => {
      await jezo.page.getByRole('button', { name: `${name}的數值選項`, exact: true }).click()
      await jezo.page.getByRole('menuitem', { name: value, exact: true }).click()
    }
    const save = async () => {
      await jezo.page.getByRole('button', { name: '儲存', exact: true }).click()
      await expect(jezo.page.getByText('有未儲存的變更')).toHaveCount(0, { timeout: 60_000 })
    }
    const settings = () => config(jezo.data).speech.models[model]
    await speechPage(jezo.page)
    await pick(jezo.page, 'qwen3-asr-0.6b')
    await section(jezo.page, '模型載入')
    const windowInput = () => jezo.page.getByRole('textbox', { name: 'Max Window S', exact: true })
    // An invalid value in another field must survive selecting null here.
    const interval = () => jezo.page.getByRole('textbox', { name: 'Redecode Interval S', exact: true })
    await interval().fill('unfinished')
    await windowInput().fill('unfinished')
    await choice('Max Window S', '空值')
    await expect(windowInput()).toHaveAttribute('placeholder', '空值')
    await expect(windowInput()).toHaveAttribute('aria-invalid', 'false')
    await expect(interval()).toHaveValue('unfinished')
    await expect(jezo.page.getByRole('button', { name: '儲存', exact: true })).toBeDisabled()
    await interval().fill('')
    await section(jezo.page, '串流時限')
    await choice('結束逾時（秒）', '空值')
    // Null is an explicit override even when the class schema also defaults to null.
    await choice('閒置逾時（秒）', '空值')
    await save()
    expect(settings()).toEqual({ config: { max_window_s: null }, options: {}, provider: {}, deadlines: { done_timeout: null, max_idle: null } })
    await info.attach('explicit-null', { body: await jezo.page.screenshot(), contentType: 'image/png' })

    await jezo.restart()
    await speechPage(jezo.page)
    await pick(jezo.page, 'qwen3-asr-0.6b')
    await section(jezo.page, '模型載入')
    await expect(windowInput()).toHaveAttribute('placeholder', '空值')
    await windowInput().fill('30')
    await section(jezo.page, '串流時限')
    await jezo.page.getByRole('textbox', { name: '結束逾時（秒）', exact: true }).fill('300')
    await choice('閒置逾時（秒）', '使用預設值')
    await save()
    expect(settings()).toEqual({ config: { max_window_s: 30 }, options: {}, provider: {}, deadlines: { done_timeout: 300 } })
    await open(jezo.page, '今天')
    await speechPage(jezo.page)
    await pick(jezo.page, 'qwen3-asr-0.6b')
    await section(jezo.page, '模型載入')
    await expect(windowInput()).toHaveValue('30')
    await choice('Max Window S', '使用預設值')
    await section(jezo.page, '串流時限')
    await jezo.page.getByRole('button', { name: '結束逾時（秒）：恢復預設值', exact: true }).click()
    await save()
    expect(settings()).toEqual({ config: {}, options: {}, provider: {} })
    const said = await dictate(jezo.page, true)
    await info.attach('nullable-settings-round-trip', { body: JSON.stringify({ settings: settings(), said }, null, 2), contentType: 'application/json' })
    expect(jezo.errors).toEqual([])
  })
})
