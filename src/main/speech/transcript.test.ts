import { describe, expect, test } from 'bun:test'
import { SpeechTranscript } from './transcript'

// Failures to prevent at the SDK/JavaScript boundary:
// - indexing Unicode by the old Python code-point count;
// - retaining withdrawn stable text, or moving replacements to the end;
// - appending a closed restatement instead of replacing its segment;
// - resurrecting partials when the SDK's final result is empty;
// - treating an early process exit or a terminal error as successful dictation.
describe('Standard ASR transcript ownership', () => {
  test('keeps Unicode intact and replaces stable segments in reading order', () => {
    const transcript = new SpeechTranscript()
    transcript.event({ type: 'partial', segment_id: 'a', text: '👩‍💻𠮷野家 hello', stable_text: '👩‍💻𠮷野家 ' })
    transcript.event({ type: 'final', segment_id: 'b', text: ' tail', stable_text: ' tail' })
    transcript.event({ type: 'supersede', old_ids: ['a'], new_ids: ['c', 'd'] })
    expect(transcript.preview).toBe(' tail')
    transcript.event({ type: 'partial', segment_id: 'd', text: 'ใหม่', stable_text: '' })
    transcript.event({ type: 'final', segment_id: 'c', text: '👩‍💻新 ', stable_text: '👩‍💻新 ' })
    expect(transcript.preview).toBe('👩‍💻新 ใหม่ tail')
    transcript.event({ type: 'final', segment_id: 'c', text: '👩‍💻新！', stable_text: '👩‍💻新！', finality: 'closed' })
    expect(transcript.preview).toBe('👩‍💻新！ใหม่ tail')
  })

  test('an empty native result clears abandoned partials', () => {
    const transcript = new SpeechTranscript()
    transcript.event({ type: 'partial', segment_id: 'a', text: 'do not send', stable_text: 'do not ' })
    transcript.complete('')
    expect(transcript.preview).toBe('')
    expect(transcript.result()).toEqual({ text: '', error: null })
  })

  test('native final text is authoritative even when its spacing differs', () => {
    const transcript = new SpeechTranscript()
    transcript.event({ type: 'final', segment_id: 'a', text: 'hello' })
    transcript.event({ type: 'final', segment_id: 'b', text: 'world' })
    transcript.complete('hello world')
    expect(transcript.result()).toEqual({ text: 'hello world', error: null })
  })

  test('keeps a failed draft for editing but never calls it a successful result', () => {
    const transcript = new SpeechTranscript()
    transcript.event({ type: 'partial', segment_id: 'a', text: 'draft' })
    expect(transcript.result('engine_error')).toEqual({ text: 'draft', error: 'engine_error' })
    expect(transcript.result().error).toBeTruthy()
  })
})
