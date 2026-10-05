import { useCallback, useEffect, useState } from 'react'
import type { SpeechStatus } from '../../../../../shared/bridge'
import type { SpeechArtifactReport, SpeechCommand, SpeechInventory, SpeechModelDetail } from '../../../../../shared/speech'

/** The install and operation state, kept current while mounted. */
export function useSpeechStatus() {
  const [status, setStatus] = useState<SpeechStatus | null>(null)
  useEffect(() => {
    window.jezo.speech.status().then(setStatus)
    return window.jezo.speech.onStatus(setStatus)
  }, [])
  return status
}

/**
 * The installed packages and the models they provide. Read again after every
 * operation ends, since installing, removing and updating change them.
 */
export function useInventory(status: SpeechStatus | null) {
  const [inventory, setInventory] = useState<SpeechInventory | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      window.jezo.speech.inventory().then(
        (value) => (setInventory(value), setError(null)),
        (e) => setError(message(e)),
      ),
    [],
  )
  // Every status event: an operation ending, or new notes from recognition. Reading is cached until something changes.
  useEffect(() => {
    if (status && status.step === null) void load()
  }, [status, load])
  return { inventory, error, reload: load }
}

/** One model's schemas, settings and file reports; null while it loads. */
export function useModelDetail(id: string | null, status: SpeechStatus | null) {
  const [detail, setDetail] = useState<SpeechModelDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const idle = status !== null && status.step === null
  const load = useCallback(() => {
    if (!id) return
    window.jezo.speech.model(id).then(
      (value) => (setDetail(value), setError(null)),
      (e) => setError(message(e)),
    )
  }, [id])
  useEffect(() => {
    setDetail(null)
    setError(null)
  }, [id])
  useEffect(() => {
    if (idle) load()
  }, [idle, load])
  return { detail: detail?.id === id ? detail : null, error, reload: load }
}

/** Runs one operation. The promise settles when it's done; a failure rejects with the reason. */
export function run(command: SpeechCommand) {
  return window.jezo.speech.command(command)
}

/** What a rejected IPC call says, without Electron's "Error invoking remote method" prefix. */
export function message(error: unknown) {
  return String((error as Error)?.message ?? error).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** The report for the mode Jezo records in, which is the one that decides whether dictation works. */
export function usedReport(detail: SpeechModelDetail): SpeechArtifactReport | null {
  const mode = detail.dictation?.mode
  return mode ? (detail.artifacts[mode] ?? null) : null
}

export function bytes(size: number, language: string) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = size
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: value < 10 && unit > 1 ? 1 : 0 }).format(value)} ${units[unit]}`
}

/** A language code as the app's language names it, like "zh" → 中文. */
export function languageName(code: string, language: string) {
  if (code === 'auto') return null
  try {
    return new Intl.DisplayNames([language], { type: 'language' }).of(code) ?? code
  } catch {
    return code
  }
}
