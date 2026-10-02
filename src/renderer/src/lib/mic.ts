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
    // 16 kHz is what the engines take; Chromium resamples the microphone to it.
    const context = new AudioContext({ sampleRate: 16000 })
    let frame = 0
    let last = 0

    const start = async () => {
      const [media, available] = await Promise.all([navigator.mediaDevices.getUserMedia({ audio: true }), window.jezo.speech.start(session)])
      if (stopped) return media.getTracks().forEach((track) => track.stop())
      stream = media
      setReady(available)
      const source = context.createMediaStreamSource(media)
      const analyser = context.createAnalyser()
      analyser.fftSize = 512
      source.connect(analyser)
      if (available) {
        await context.audioWorklet.addModule(workletUrl)
        if (stopped) return
        const pcm = new AudioWorkletNode(context, 'pcm16')
        pcm.port.onmessage = (e: MessageEvent<ArrayBuffer>) => window.jezo.speech.audio(e.data)
        source.connect(pcm)
        // A node that isn't connected on to the output isn't run. It outputs silence.
        pcm.connect(context.destination)
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
    start().catch((e: unknown) => setError(String(e)))

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      void context.close()
    }
  }, [])

  return { levels, error, ready }
}
