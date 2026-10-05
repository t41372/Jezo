/** Fields consumed from native events; unknown protocol fields remain untouched. */
interface TranscriptEvent {
  type: string
  segment_id?: string | null
  text?: string | null
  old_ids?: string[]
  new_ids?: string[]
  [field: string]: unknown
}

/** Live text is replaceable. Only the SDK result is a completed dictation. */
export class SpeechTranscript {
  private order: string[] = []
  private texts = new Map<string, string>()
  private finalText: string | null = null

  get preview() {
    return this.finalText ?? this.order.map((id) => this.texts.get(id) ?? '').join('')
  }

  event(event: TranscriptEvent): boolean {
    if ((event.type === 'partial' || event.type === 'final') && event.segment_id) {
      if (!this.order.includes(event.segment_id)) this.order.push(event.segment_id)
      this.texts.set(event.segment_id, event.text ?? '')
      // Jezo displays whole segments. stable_text is not a character count,
      // nor permission to send an unfinished request to the agent.
      return true
    }
    if (event.type === 'supersede') {
      const old = event.old_ids ?? []
      const position = this.order.indexOf(old[0])
      for (const id of old) {
        const at = this.order.indexOf(id)
        if (at >= 0) this.order.splice(at, 1)
        this.texts.delete(id)
      }
      this.order.splice(Math.max(0, position), 0, ...(event.new_ids ?? []))
      return true
    }
    return false
  }

  complete(text: string) {
    this.finalText = text
  }

  result(error: string | null = null) {
    return {
      text: this.preview,
      error: error ?? (this.finalText === null ? 'Speech ended without a final result' : null),
    }
  }
}
