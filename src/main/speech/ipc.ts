// Hold-to-talk between the windows and the speech server. One utterance at a time.

import { BrowserWindow, ipcMain, systemPreferences, webContents } from 'electron'
import type { SpeechContext } from './context'
import type { Speech } from './speech'

type Utterance = Awaited<ReturnType<Speech['listen']>>

export interface SpeechSources {
  /** What the user is likely to say into this conversation, or into a new one. */
  context(session: string | null, vocabulary: string[]): SpeechContext
}

export function serveSpeech(speech: Speech, sources: SpeechSources) {
  let current: Utterance = null
  // The app's page names and language, from the main window, which has them.
  let vocabulary: string[] = []
  let language = 'en'

  ipcMain.handle('speech:status', () => speech.status())
  ipcMain.handle('speech:install', () => speech.install())
  ipcMain.on('speech:vocabulary', (_, words: string[], lang: string) => {
    vocabulary = words
    language = lang
  })
  speech.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('speech:status', status)
  })

  // Starting can wait on the server, or on an update before it starts. Audio that
  // arrives meanwhile is kept for the utterance, and letting go meanwhile ends it once it's open.
  let starting: Promise<Utterance> | null = null
  /** The opening that letting go took over, which ends it itself. */
  let claimed: Promise<Utterance> | null = null
  let early: ArrayBuffer[] = []
  /**
   * The window the utterance is for. Its audio and its letting go are the only
   * ones that count; another window starting one tells it to stop, so two
   * microphones never feed one utterance.
   */
  let owner: number | null = null

  ipcMain.handle('speech:start', async (event, session?: string | null) => {
    // A new utterance ends one still open, and the window it was for stops listening.
    void current?.end()
    current = null
    if (owner !== null && owner !== event.sender.id) webContents.fromId(owner)?.send('speech:replaced')
    owner = event.sender.id
    // The main window asks here; the ⌥X window has asked already, before it shows.
    if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone'))) return false
    early = []
    const opening = speech.listen((text) => event.sender.send('speech:text', text), sources.context(session ?? null, vocabulary), language)
    starting = opening
    const utterance = await opening
    if (starting !== opening) {
      // Let go already, or overtaken by a newer hold, whose utterance is the one that counts.
      if (claimed !== opening) void utterance?.end()
      return utterance !== null
    }
    starting = null
    for (const chunk of early.splice(0)) utterance?.audio(chunk)
    current = utterance
    return utterance !== null
  })
  ipcMain.on('speech:audio', (event, chunk: ArrayBuffer) => {
    if (event.sender.id !== owner) return
    if (current) current.audio(chunk)
    else if (starting) early.push(chunk)
  })
  ipcMain.handle('speech:end', async (event) => {
    // A window whose utterance another one took over has nothing left to end.
    if (event.sender.id !== owner) return ''
    owner = null
    const pending = starting
    starting = null
    claimed = pending
    const utterance = current ?? (pending && (await pending))
    current = null
    if (utterance && pending) for (const chunk of early.splice(0)) utterance.audio(chunk)
    return utterance ? utterance.end() : ''
  })
}
