// Canned replies so the chat can be clicked through. Replaced by the real agent.

import type { Message, NoteKind, Todo } from './types'

const canned: Record<string, Message[]> = {
  都加: [{ kind: 'agent', text: '好，已經加進今天了：13:00 回信，晚上 20:30 打給媽。' }],
  只加打給媽: [{ kind: 'agent', text: '好，晚上 20:30 打給媽，後面我不塞東西。' }],
  今天先不要: [{ kind: 'agent', text: '好，都先不排。明早我再問你一次。' }],
  今天不太順: [{ kind: 'agent', text: '沒關係，這種日子本來就會有。先不管原本排了什麼，你現在比較像哪一種？' }, { kind: 'rework' }],
  "Today isn't going well": [{ kind: 'agent', text: '沒關係，這種日子本來就會有。先不管原本排了什麼，你現在比較像哪一種？' }, { kind: 'rework' }],
}

export function replyTo(text: string): Message[] {
  return canned[text] ?? [{ kind: 'agent', text: '好，我想一下。先問你：這件事有時間限制嗎？' }]
}

/** What picking a choice does to the todos. The morning plan asks about u1 and u2. */
export function applyChoice(option: string, todos: Todo[], today: string): Todo[] {
  const schedule = (id: string, start: number) => (t: Todo) => (t.id === id ? { ...t, slot: { date: today, start } } : t)
  if (option === '都加') return todos.map(schedule('u1', 13)).map(schedule('u2', 20.5))
  if (option === '只加打給媽') return todos.map(schedule('u2', 20.5))
  return todos
}

/**
 * Mock: what the agent proposes a note becomes. The real agent reads the notes
 * with the 整理隨手記 skill; this keyword table only stands in for it.
 */
export function sortNote(text: string): { as: NoteKind | 'ask'; title: string } {
  const t = text.trim()
  if (/^我(喜歡|不喜歡|討厭|習慣|通常|比較|容易)|我.{0,12}比較/.test(t)) return { as: 'memory', title: t }
  if (/想(學|要|開始|試)|希望|目標|總有一天|今年|明年/.test(t)) {
    return { as: 'goal', title: t.replace(/^(我)?(想要|想|希望)/, '').replace(/[，,].*$/, '') }
  }
  if (/記得|要|買|訂|打給|回|寫|繳|報名|約|預約|寄|修|查|換|拿|交/.test(t)) {
    return { as: 'todo', title: t.replace(/^(記得|要)/, '') }
  }
  if (/[?？]/.test(t) || t.length <= 8) return { as: 'ask', title: `「${t}」是要做的事，還是記著就好？` }
  return { as: 'keep', title: t }
}

/** Mock: the folded summary of what the agent looked at. */
export const sortSteps = (count: number) => `看了隨手記的 ${count} 則`

/** Mock: what the agent says about its proposal, counted from it. */
export function sortSummary(items: { as: NoteKind | 'ask' }[]): string {
  const count = (as: NoteKind | 'ask') => items.filter((i) => i.as === as).length
  const parts = [
    [count('todo'), '是要做的事'],
    [count('goal'), '像是目標的想法'],
    [count('memory'), '是關於你的事，我想記住'],
    [count('keep'), '先留著當筆記'],
  ]
    .filter(([n]) => n)
    .map(([n, what]) => `${n} 則${what}`)
  const asks = count('ask')
  return `看完了。${parts.join('，')}。${asks ? `有 ${asks} 則我看不懂，問你一下。` : ''}都還沒動，你說好才算。`
}
