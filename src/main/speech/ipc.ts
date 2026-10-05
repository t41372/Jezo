// One recording per window owns its startup queue, even when another hold overtakes it.
import { BrowserWindow, ipcMain, systemPreferences, webContents } from 'electron'
import type { SpeechContext } from './context'
import type { Speech } from './speech'

type Utterance = Awaited<ReturnType<Speech['listen']>>
type Result = { text: string; error: string | null }
interface Recording {
  owner: number
  opening: Promise<Utterance>
  utterance: Utterance
  queued: ArrayBuffer[]
  finishing: Promise<Result> | null
}

export interface SpeechSources {
  context(session: string | null, vocabulary: string[]): SpeechContext
}

export function serveSpeech(speech: Speech, sources: SpeechSources) {
  let current: Recording | null = null
  let vocabulary: string[] = []
  let language = 'en'

  ipcMain.handle('speech:status', () => speech.status())
  ipcMain.handle('speech:install', () => speech.install())
  ipcMain.handle('speech:inventory', () => speech.inventory())
  ipcMain.handle('speech:model', (_, id: string) => speech.model(id))
  ipcMain.handle('speech:command', (_, command) => speech.command(command))
  ipcMain.handle('speech:sample-rate', () => speech.sampleRate())
  ipcMain.on('speech:vocabulary', (_, words: string[], lang: string) => {
    vocabulary = words
    language = lang
  })
  speech.onStatus((status) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('speech:status', status)
  })

  function finish(recording: Recording): Promise<Result> {
    recording.finishing ??= (async () => {
      const utterance = recording.utterance ?? (await recording.opening)
      for (const chunk of recording.queued.splice(0)) utterance?.audio(chunk)
      return utterance ? utterance.end() : { text: '', error: speech.status().error }
    })()
    return recording.finishing
  }

  ipcMain.handle('speech:start', async (event, session?: string | null) => {
    const previous = current
    if (previous) {
      void finish(previous)
      if (previous.owner !== event.sender.id) webContents.fromId(previous.owner)?.send('speech:replaced')
    }
    const recording: Recording = {
      owner: event.sender.id,
      opening: Promise.resolve(null),
      utterance: null,
      queued: [],
      finishing: null,
    }
    current = recording
    recording.opening = (async () => {
      if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess('microphone'))) return null
      return speech.listen(
        (text) => {
          // An older hold must not replace text in the same window's newer hold.
          if (current === recording || !current || current.owner !== recording.owner)
            event.sender.send('speech:text', text)
        },
        sources.context(session ?? null, vocabulary),
        language,
      )
    })()
    const utterance = await recording.opening
    if (current === recording && !recording.finishing) {
      recording.utterance = utterance
      for (const chunk of recording.queued.splice(0)) utterance?.audio(chunk)
    }
    return utterance?.sampleRate ?? false
  })
  ipcMain.on('speech:audio', (event, chunk: ArrayBuffer) => {
    const recording = current
    if (!recording || recording.owner !== event.sender.id || recording.finishing) return
    if (recording.utterance) recording.utterance.audio(chunk)
    else recording.queued.push(chunk)
  })
  ipcMain.handle('speech:end', (event) => {
    const recording = current
    if (!recording || recording.owner !== event.sender.id) return { text: '', error: null }
    // Detach before awaiting startup. A new recording owns completely separate state.
    current = null
    return finish(recording)
  })
}
