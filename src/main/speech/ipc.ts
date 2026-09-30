// Hold-to-talk between the ⌥X window and the speech server. One utterance at a time.

import { BrowserWindow, ipcMain } from 'electron'
import type { Speech } from './speech'

export function serveSpeech(speech: Speech) {
  let current: Awaited<ReturnType<Speech['listen']>> = null

  ipcMain.handle('speech:status', () => speech.status())
  ipcMain.handle('speech:install', () => speech.install())
  speech.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('speech:status', status)
  })

  ipcMain.handle('speech:start', async (event) => {
    // A new utterance ends one still open.
    void current?.end()
    current = await speech.listen((text) => event.sender.send('speech:text', text))
    return current !== null
  })
  ipcMain.on('speech:audio', (_, chunk: ArrayBuffer) => current?.audio(chunk))
  ipcMain.handle('speech:end', async () => {
    const utterance = current
    current = null
    return utterance ? utterance.end() : ''
  })
}
