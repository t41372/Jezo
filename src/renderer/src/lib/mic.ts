import { useEffect, useState } from 'react'
import workletUrl from './pcm-worklet.ts?worker&url'

/**
 * Listens to the microphone while mounted: sends the audio to speech
 * recognition and returns recent loudness levels (0–1), newest last, for a
 * waveform. The microphone stops on unmount; the caller ends the utterance.
 * `ready` is false when speech recognition isn't installed.
 */
export function useDictation(count: number, session?: string | null) {
  const [levels, setLevels] = useState<number[]>(() => Array(count).fill(0))
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(true)

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    // Streaming PCM uses the selected engine's declared rate; Chromium resamples it.
    let context: AudioContext | null = null
    let frame = 0
    let last = 0

    const start = async () => {
      const rate = await window.jezo.speech.sampleRate()
      if (stopped) return
      if (!rate) { setReady(false); return }
      context = new AudioContext({ sampleRate: rate })
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream = media
      if (stopped) return media.getTracks().forEach((track) => track.stop())
      const opening = window.jezo.speech.start(session)
      const source = context.createMediaStreamSource(media)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      await context.audioWorklet.addModule(workletUrl)
      if (stopped) return
      const pcm = new AudioWorkletNode(context, 'pcm16')
      pcm.port.onmessage = (e: MessageEvent<ArrayBuffer>) => window.jezo.speech.audio(e.data)
      source.connect(pcm)
      // Capture while Python opens: the main process queues these first words.
      pcm.connect(context.destination)
      const available = await opening
      if (stopped) return
      setReady(available !== false)
      if (!available) {
        media.getTracks().forEach((track) => track.stop())
        void context.close()
        const status = await window.jezo.speech.status()
        if (status.error) setError(status.error)
        return
      }
      const samples = new Float32Array(analyser.fftSize)
      const tick = (time: number) => {
        frame = requestAnimationFrame(tick)
        if (time - last < 70) return
        last = time
        analyser.getFloatTimeDomainData(samples)
        const rms = Math.sqrt(samples.reduce((sum, x) => sum + x * x, 0) / samples.length)
        setLevels((prev) => [...prev.slice(1), Math.min(1, rms * 6)])
      }
      frame = requestAnimationFrame(tick)
    }
    start().catch((e: unknown) => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close()
      void window.jezo.speech.end()
      setError(String(e))
    })

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context?.close()
    }
  }, [])

  return { levels, error, ready }
}
