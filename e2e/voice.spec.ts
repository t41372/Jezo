// Holding ⌥X to talk, from the microphone to the agent. Chromium's fake
// microphone plays a sentence macOS speaks; the ⌥X window streams it to
// Standard ASR, which this test installs from 設定 the way a user would.
// Needs macOS on Apple Silicon, uv, and a local model server.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, open, test } from './jezo'

const ready = process.platform === 'darwin' && process.arch === 'arm64' && (() => {
  try {
    execFileSync('uv', ['--version'])
    return true
  } catch {
    return false
  }
})()

/**
 * A spoken sentence as 16 kHz mono WAV, with silence after it so the fake
 * microphone doesn't loop back into it. An empty sentence is silence only.
 */
function spoken(sentence: string) {
  const dir = mkdtempSync(join(tmpdir(), 'jezo-voice-'))
  let said = Buffer.alloc(0)
  if (sentence) {
    execFileSync('say', ['-v', 'Meijia', '-o', join(dir, 'said.aiff'), sentence])
    execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(dir, 'said.aiff'), join(dir, 'said.wav')])
    const wav = readFileSync(join(dir, 'said.wav'))
    said = wav.subarray(wav.indexOf('data') + 8)
  }
  const pcm = Buffer.concat([said, Buffer.alloc(16000 * 2 * 6)])
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(pcm.length, 40)
  const file = join(dir, 'padded.wav')
  writeFileSync(file, Buffer.concat([header, pcm]))
  return file
}

/** What the ⌥X key sends the window when it's held and released. The key itself is the OS's. */
function hotkey(app: ElectronApplication, kind: 'voice-start' | 'voice-end') {
  return app.evaluate(({ BrowserWindow }, kind) => {
    const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick.html'))!
    window.showInactive()
    window.webContents.send('quick:command', kind === 'voice-start' ? { kind, context: '今天' } : { kind })
  }, kind)
}

/** Installs speech recognition from 設定, the way a user would. */
async function install(page: Page) {
  await open(page, '設定')
  await page.getByRole('button', { name: '安裝' }).click()
  await expect(page.getByText(/Qwen3-ASR 0.6B，在這台電腦上跑/)).toBeVisible({ timeout: 540_000 })
}

/** A todo in the backlog whose name a recognizer gets wrong on its own: 鵝鑾鼻 comes out 俄伦鼻. */
function campingTodo(root: string) {
  mkdirSync(join(root, 'todos/items'), { recursive: true })
  writeFileSync(join(root, 'todos/items/t-camp.md'), '---\nid: t-camp\ntitle: 整理鵝鑾鼻露營裝備\nstate: open\nestimate: 40\n---\n')
}

const fakeMicrophone = (file: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  // The audio service's sandbox can't read the file otherwise.
  '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox',
  `--use-file-for-fake-audio-capture=${file}`,
]

test.describe('dictation knows the words in the workspace', () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.describe.configure({ timeout: 600_000 })
  test.use({ prepare: { model: null, workspace: campingTodo, args: fakeMicrophone(ready ? spoken('我要整理鵝鑾鼻露營裝備') : '') } })

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

test.describe('holding ⌥X with nothing said', () => {
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

test.describe('holding ⌥X', () => {
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
    await expect.poll(() => read('todos/items/t-u2.md').data.scheduled, { timeout: 240_000 }).toMatch(/T20:00(\[Asia\/Taipei\])?$/)
  })
})
