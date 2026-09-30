// Holding ⌥X to talk, from the microphone to the agent. Chromium's fake
// microphone plays a sentence macOS speaks; the ⌥X window streams it to
// Standard ASR, which this test installs from 設定 the way a user would.
// Needs macOS on Apple Silicon, uv, and a local model server.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, open, test } from './jezo'

const ready = process.platform === 'darwin' && process.arch === 'arm64' && (() => {
  try {
    execFileSync('uv', ['--version'])
    return true
  } catch {
    return false
  }
})()

/** A spoken sentence as 16 kHz mono WAV, with silence after it so the fake microphone doesn't loop back into it. */
function spoken(sentence: string) {
  const dir = mkdtempSync(join(tmpdir(), 'jezo-voice-'))
  execFileSync('say', ['-v', 'Meijia', '-o', join(dir, 'said.aiff'), sentence])
  execFileSync('afconvert', ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', join(dir, 'said.aiff'), join(dir, 'said.wav')])
  const wav = readFileSync(join(dir, 'said.wav'))
  const data = wav.indexOf('data')
  const pcm = Buffer.concat([wav.subarray(data + 8), Buffer.alloc(16000 * 2 * 6)])
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

test.describe('holding ⌥X', () => {
  test.skip(!ready, 'Needs macOS on Apple Silicon and uv.')
  test.setTimeout(600_000)
  test.use({
    prepare: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        // The audio service's sandbox can't read the file otherwise.
        '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox',
        `--use-file-for-fake-audio-capture=${ready ? spoken('幫我把打給媽排到明天晚上八點') : ''}`,
      ],
    },
  })

  test('turns what was said into a request the agent acts on', async ({ jezo }) => {
    const { app, page, read } = jezo
    await open(page, '設定')
    await page.getByRole('button', { name: '安裝' }).click()
    await expect(page.getByText(/Qwen3-ASR 0.6B，在這台電腦上跑/)).toBeVisible({ timeout: 540_000 })

    const quick = app.windows().find((w) => w.url().includes('/quick.html'))!
    // What the ⌥X key sends the window when it's held and released. The key itself is the OS's.
    const hotkey = (kind: 'voice-start' | 'voice-end') =>
      app.evaluate(({ BrowserWindow }, kind) => {
        const window = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/quick.html'))!
        window.showInactive()
        window.webContents.send('quick:command', kind === 'voice-start' ? { kind, context: '今天' } : { kind })
      }, kind)

    await hotkey('voice-start')
    // The words appear while they're said, in Traditional Chinese.
    await expect(quick.getByText(/打給媽/)).toBeVisible({ timeout: 30_000 })
    await quick.waitForTimeout(1500)
    await hotkey('voice-end')

    await expect(quick.locator('input')).toHaveValue(/打給媽.*明天晚上八點/, { timeout: 30_000 })
    await expect.poll(() => read('todos/items/t-u2.md').data.scheduled, { timeout: 240_000 }).toMatch(/T20:00$/)
  })
})
