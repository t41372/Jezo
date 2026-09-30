// Runs on the audio thread. Turns the microphone's samples into 16-bit PCM and
// hands them over in 50 ms chunks. The AudioContext runs at 16 kHz, so Chromium
// has already resampled (docs/design/backend.md, "Speech").

declare class AudioWorkletProcessor {
  readonly port: MessagePort
}
declare function registerProcessor(name: string, processor: new () => AudioWorkletProcessor): void

const CHUNK = 800

class Pcm16 extends AudioWorkletProcessor {
  private buffer = new Int16Array(CHUNK)
  private filled = 0

  process(inputs: Float32Array[][]) {
    const channel = inputs[0]?.[0]
    if (!channel) return true
    for (const sample of channel) {
      // Clip, then round (never truncate), as the protocol's quantization asks.
      const x = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : 0
      this.buffer[this.filled++] = Math.round(x * 32767)
      if (this.filled === CHUNK) {
        this.port.postMessage(this.buffer.buffer, [this.buffer.buffer])
        this.buffer = new Int16Array(CHUNK)
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('pcm16', Pcm16)
