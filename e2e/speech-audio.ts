import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A spoken sentence as 16 kHz mono WAV, with silence after it so the fake
 * microphone doesn't loop back into it. An empty sentence is silence only.
 */
export function spoken(sentence: string, voice = 'Meijia') {
  const dir = mkdtempSync(join(tmpdir(), 'jezo-voice-'))
  let said = Buffer.alloc(0)
  if (sentence) {
    execFileSync('say', ['-v', voice, '-o', join(dir, 'said.aiff'), sentence])
    execFileSync('afconvert', [
      '-f',
      'WAVE',
      '-d',
      'LEI16@16000',
      '-c',
      '1',
      join(dir, 'said.aiff'),
      join(dir, 'said.wav'),
    ])
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

export const fakeMicrophone = (file: string) => [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  // The audio service's sandbox can't read the file otherwise.
  '--disable-features=AudioServiceOutOfProcess,AudioServiceSandbox',
  `--use-file-for-fake-audio-capture=${file}`,
]
