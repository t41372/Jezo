import { useEffect, useState } from 'react'

/**
 * Listens to the microphone while mounted and returns recent loudness levels
 * (0–1), newest last, for a waveform. Stops the microphone on unmount.
 */
export function useMicLevels(count: number) {
  const [levels, setLevels] = useState<number[]>(() => Array(count).fill(0))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let stopped = false
    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let last = 0

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((track) => track.stop())
        stream = s
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        context.createMediaStreamSource(s).connect(analyser)
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
      })
      .catch((e: unknown) => setError(String(e)))

    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((track) => track.stop())
      context?.close()
    }
  }, [])

  return { levels, error }
}
