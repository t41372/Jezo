// What dictation is told to expect (GitHub #1, docs/design/backend.md,
// "Speech"): the words this user is likely to say that a recognizer gets wrong
// on its own, like "Jezo", the app's page names, their goals and todos, and
// what was just said in the conversation. Standard ASR carries it as the
// portable `prompt` (free text the engine reads as background) and
// `phrase_hints` (terms to favor), each only when the engine declares it.

import type { Item } from '../../shared/workspace'

/** What an engine takes, from its declared capabilities (`streaming.guidance`). */
export interface Guidance {
  /** `maxTokens` counted the way the standard counts them (see `units`); null when it has no limit. */
  prompt?: { maxTokens: number | null }
  phraseHints?: { maxTerms: number | null; maxChars: number | null; maxWords?: number | null }
}

export interface SpeechContext {
  /** The last things said in the conversation, oldest first. */
  recent: string[]
  /** Names and titles, most likely to matter first. */
  terms: string[]
}

/**
 * How much context to send, in the standard's units. Measured on Qwen3-ASR
 * 0.6B (2026-10-01): a 47-character term list fixed "GZO" → "Jezo" and
 * "俄伦鼻" → "鹅銮鼻"; past a few hundred characters recognition got no better
 * and some of those fixes came undone, while each extra thousand tokens cost
 * about 0.05 s per decode.
 */
const BUDGET = 400
/** No one line of the conversation takes more than this. */
const LINE = 150

/** The guidance an engine declares for streaming, from `GET /v1/capabilities/<model>`. */
export function guidanceOf(capabilities: unknown, mode: 'batch' | 'streaming' = 'streaming'): Guidance {
  type Node = { supported?: boolean; constraints?: Record<string, number | null> }
  const guidance = (
    capabilities as Partial<Record<'batch' | 'streaming', { guidance?: { prompt?: Node; phrase_hints?: Node } }>> | null
  )?.[mode]?.guidance
  const out: Guidance = {}
  if (guidance?.prompt?.supported) out.prompt = { maxTokens: guidance.prompt.constraints?.max_tokens ?? null }
  if (guidance?.phrase_hints?.supported) {
    out.phraseHints = {
      maxTerms: guidance.phrase_hints.constraints?.max_terms ?? null,
      maxChars: guidance.phrase_hints.constraints?.max_chars_per_term ?? null,
      maxWords: guidance.phrase_hints.constraints?.max_words_per_term ?? null,
    }
  }
  return out
}

/**
 * Text measured the way Standard ASR gates `prompt.max_tokens` (protocol.md,
 * "prompt.max_tokens"; `_count_tokens` in its gating.py): the whitespace-
 * separated words, plus one for every character of a script written without
 * spaces (Chinese, Japanese, Korean, Thai and the like). "我要整理" is one word
 * and four characters: five.
 */
export function units(text: string) {
  const spaceless =
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}\p{Script=Yi}]/gu
  return text.split(/\s+/).filter(Boolean).length + (text.match(spaceless)?.length ?? 0)
}

/** The first `max` units of a line, cut at a character. */
function clip(text: string, max: number) {
  if (units(text) <= max) return text
  const chars = [...text]
  let lo = 0
  let hi = chars.length
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (units(chars.slice(0, mid).join('')) <= max) lo = mid
    else hi = mid - 1
  }
  return chars.slice(0, lo).join('').trimEnd()
}

/**
 * Where the words come from, most likely to matter first: the app's own name
 * and pages, the page the user is on, the conversation, then their goals,
 * today's todos, the backlog, and the coming week.
 */
export function gather(input: {
  items: Item[]
  /** The conversation dictation goes into, as the user and the agent said it. */
  conversation: string[]
  /** The app's page names in the app's language. */
  vocabulary: string[]
  /** The page the main window shows, when the ⌥X window was opened over it. */
  page?: string | null
  today: string
  /** Each todo's date, from its time read in the device's zone. */
  dateOf: (scheduled: unknown) => string | null
}): SpeechContext {
  const { items, today, dateOf } = input
  const open = items.filter((i) => i.kind === 'todo' && (i.data.state === 'open' || i.data.state === 'draft'))
  const title = (i: Item) => String(i.data.title ?? i.data.name ?? '').trim()
  const week = new Date(Date.parse(today) + 7 * 86_400_000).toISOString().slice(0, 10)
  const on = (from: string, to: string) =>
    open.filter((i) => {
      const date = dateOf(i.data.scheduled)
      return date !== null && date >= from && date <= to
    })
  const terms = [
    'Jezo',
    ...(input.page ? [input.page] : []),
    ...input.vocabulary,
    ...items.filter((i) => i.kind === 'goal' && i.data.state !== 'done').map(title),
    ...on(today, today).map(title),
    ...open
      .filter((i) => !i.data.scheduled)
      .sort((a, b) => String(a.data.rank ?? '~').localeCompare(String(b.data.rank ?? '~')))
      .map(title),
    ...on(today, week).map(title),
  ]
  return {
    recent: input.conversation
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(-2),
    terms: [...new Set(terms.filter(Boolean))],
  }
}

/**
 * The config frame's `options` for this context and engine. The terms go in
 * `phrase_hints` when the engine takes them, and the conversation in `prompt`;
 * an engine with only `prompt` gets both there. Everything sent together stays
 * within one budget, because an engine may read both into one buffer
 * (faster-whisper's holds about 223 tokens, and it cuts the rest without
 * saying). Nothing the engine doesn't declare is sent, because the reference
 * server refuses a session that asks for it.
 */
export function options(
  context: SpeechContext,
  guidance: Guidance,
  language: string,
): { prompt?: string; phrase_hints?: string[] } | undefined {
  const out: { prompt?: string; phrase_hints?: string[] } = {}
  const budget = Math.min(BUDGET, guidance.prompt?.maxTokens ?? BUDGET)
  let used = 0
  if (guidance.phraseHints) {
    const { maxTerms, maxChars, maxWords } = guidance.phraseHints
    const hints: string[] = []
    for (const term of context.terms) {
      if (!term.trim() || (maxChars !== null && [...term].length > maxChars)) continue
      if (maxWords != null && term.trim().split(/\s+/).length > maxWords) continue
      if (maxTerms !== null && hints.length >= maxTerms) break
      // The conversation, if it fits, gets what's left.
      if (used + units(term) > budget / 2) continue
      hints.push(term)
      used += units(term)
    }
    if (hints.length) out.phrase_hints = hints
  }
  if (guidance.prompt) {
    // Chinese and Japanese list with 、; the rest with a comma.
    const separator = /^(zh|ja)/.test(language) ? '、' : ', '
    const lines = context.recent.map((line) => clip(line, LINE))
    const start = used
    used += lines.reduce((sum, line) => sum + units(line), 0)
    // Terms sent as hints aren't repeated here.
    const rest = out.phrase_hints ? [] : context.terms
    // The conversation gives way before the app's own name does.
    while (lines.length && used + units(rest[0] ?? '') > budget) used -= units(lines.shift()!)
    const terms: string[] = []
    for (const term of rest) {
      const cost = units(term) + (terms.length ? 1 : 0)
      if (used + cost > budget) continue
      terms.push(term)
      used += cost
    }
    const prompt = [...lines, terms.join(separator)].filter(Boolean).join('\n')
    // Counted whole, as the server will count it: a prompt over the engine's limit loses the whole utterance.
    if (prompt && start + units(prompt) <= budget) out.prompt = prompt
  }
  return out.prompt || out.phrase_hints ? out : undefined
}
