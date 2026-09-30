// Sample data from the design mockup. It stands in for the workspace until the
// backend exists. The week is Monday 2026-09-28 to Sunday 2026-10-04.
//
// The text here is the user's content (their goals, todos, what the agent said
// to them), so it isn't translated. Labels the app derives from it are.

import type {
  CalendarEvent,
  Energy,
  Connection,
  Experiment,
  Memory,
  Note,
  Todo,
} from './types'

export const NOW = { date: '2026-09-29', hour: 8 + 40 / 60 }
export const THIS_WEEK_MONDAY = '2026-09-28'

const day = (offset: number) => {
  const d = new Date(`${THIS_WEEK_MONDAY}T00:00:00`)
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('sv-SE')
}
const at = (h: number, m = 0) => h + m / 60

let n = 0
const todo = (t: Omit<Todo, 'id'> & { id?: string }): Todo => ({ id: `t-x${n++}`, ...t })

export const todos: Todo[] = [
  // Today. The morning session proposed everything except the run, which was already done.
  todo({ id: 't-1', goalId: 'g-2', title: '晨跑 5 km', amount: 5, cue: '起床喝完水', state: 'done', estimateMinutes: 35, slot: { date: day(1), start: at(7) } }),
  todo({
    id: 't-2',
    goalId: 'g-1',
    title: '寫升等 doc 的「Impact」那段',
    cue: '到公司倒完咖啡',
    state: 'draft',
    estimateMinutes: 70,
    slot: { date: day(1), start: at(9, 10) },
    subtasks: [
      { text: '列出 3 個案例', done: false },
      { text: '每個配一句數字', done: false },
      { text: '寄給 Anna', done: false },
    ],
    why: '你自己估 45 分，但前 8 次寫這類段落平均用了 68 分，所以排 70 分。今天下午有兩場會，你昨晚說會議多的時候寫不下去，所以放早上。',
  }),
  todo({ id: 't-3', goalId: 'g-1', title: '和 Anna 的 1:1', state: 'draft', estimateMinutes: 30, slot: { date: day(1), start: at(10, 30) }, fromCalendar: true, why: '來自你的行事曆。' }),
  todo({
    id: 't-6',
    goalId: 'g-2',
    title: '去健身房，只做 20 分鐘', amount: 0,
    cue: '下班走出大樓',
    state: 'draft',
    estimateMinutes: 30,
    slot: { date: day(1), start: at(18, 30) },
    why: '只排 20 分鐘，因為短的比較容易開始。加上換衣服，我抓 30 分。這條規則過去 9 次你做到 7 次。',
  }),
  todo({ id: 't-5', goalId: 'g-3', title: 'N3 聽力 1 回', amount: 0, cue: '搭上回家的捷運', state: 'draft', estimateMinutes: 15, slot: { date: day(1), start: at(19, 10) }, why: '綁在通勤上，不佔你在家的時間。' }),
  todo({ id: 't-7', goalId: 'g-3', title: '背 15 張單字卡', amount: 15, cue: '刷完牙', state: 'draft', estimateMinutes: 12, slot: { date: day(1), start: at(22, 30) }, why: '這是你最穩的習慣：14 次做到 12 次。' }),

  // Yesterday.
  todo({ goalId: 'g-2', title: '晨跑 5 km', amount: 5, cue: '起床喝完水', state: 'done', estimateMinutes: 35, slot: { date: day(0), start: at(7) } }),
  todo({ goalId: 'g-1', title: '寫升等 doc 的「Scope」那段', cue: '到公司倒完咖啡', state: 'done', estimateMinutes: 70, slot: { date: day(0), start: at(9, 10) } }),
  todo({ goalId: 'g-3', title: '背 15 張單字卡', amount: 15, cue: '刷完牙', state: 'done', estimateMinutes: 12, slot: { date: day(0), start: at(22, 30) } }),

  // Later this week, accepted during last week's review.
  todo({ goalId: 'g-1', title: '寫升等 doc 的「Leadership」那段', cue: '到公司倒完咖啡', state: 'open', estimateMinutes: 70, slot: { date: day(2), start: at(9, 10) } }),
  todo({ goalId: 'g-3', title: 'N3 聽力 1 回', amount: 0, cue: '搭上回家的捷運', state: 'open', estimateMinutes: 15, slot: { date: day(2), start: at(19, 10) } }),
  todo({ goalId: 'g-3', title: '背 15 張單字卡', amount: 15, cue: '刷完牙', state: 'open', estimateMinutes: 12, slot: { date: day(2), start: at(22, 30) } }),
  todo({ goalId: 'g-2', title: '去健身房，只做 20 分鐘', amount: 0, cue: '下班走出大樓', state: 'open', estimateMinutes: 30, slot: { date: day(3), start: at(18) } }),
  todo({ goalId: 'g-3', title: '背 15 張單字卡', amount: 15, cue: '刷完牙', state: 'open', estimateMinutes: 12, slot: { date: day(3), start: at(22, 30) } }),
  todo({ goalId: 'g-2', title: '午休跑 3 km', amount: 3, cue: '午休開始', state: 'open', estimateMinutes: 30, slot: { date: day(4), start: at(12, 30) } }),
  todo({ goalId: 'g-3', title: '背 15 張單字卡', amount: 15, cue: '刷完牙', state: 'open', estimateMinutes: 12, slot: { date: day(4), start: at(22, 30) } }),
  todo({ goalId: 'g-2', title: '長跑 16 km', amount: 16, cue: '起床喝完水', state: 'open', estimateMinutes: 125, slot: { date: day(5), start: at(8) }, why: '你長跑常少估 35%，所以排 2 小時 5 分。' }),

  // Backlog: accepted, not scheduled yet.
  todo({ id: 't-u1', goalId: 'g-1', title: '回 3 封卡住的信', cue: '午餐回座位', state: 'open', estimateMinutes: 25, slot: null }),
  todo({ id: 't-u2', goalId: 'g-4', title: '打給媽', cue: '晚餐後', state: 'open', estimateMinutes: 25, slot: null }),
  todo({ id: 't-u3', goalId: 'g-2', title: '訂 12 月比賽的住宿', state: 'open', estimateMinutes: 20, slot: null }),
  todo({ id: 't-u4', goalId: 'g-3', title: '整理 N3 文法筆記', amount: 0, state: 'open', estimateMinutes: 45, slot: null }),
]

/** Where the agent would put backlog items if asked to find time, and why. */
export const suggestedSlots: Record<string, { date: string; start: number; why: string }> = {
  't-u1': { date: day(1), start: at(13), why: '午餐後 13:00 到 Design review 之前有一小時空檔。' },
  't-u2': { date: day(2), start: at(20, 30), why: '週三晚上 19:00 後全空。你們通常聊 25 分，後面我不塞東西。' },
  't-u3': { date: day(4), start: at(20), why: '週五晚上比較鬆，訂房要比價。' },
  't-u4': { date: day(5), start: at(15), why: '週六下午沒排東西，這件需要一整段時間。' },
}

const weeklyEvents: (Omit<CalendarEvent, 'id' | 'date'> & { weekday: number })[] = [
  ...[0, 1, 2, 3, 4].map((weekday) => ({ weekday, title: '站會', start: at(11, 30), hours: 0.25, source: 'Google Calendar' })),
  { weekday: 1, title: 'Design review', start: at(14), hours: 1, source: 'Google Calendar' },
  { weekday: 1, title: 'Weekly sync', start: at(15, 30), hours: 0.5, source: 'Google Calendar' },
  { weekday: 3, title: '排球', start: at(19), hours: 1.5, source: 'Google Calendar' },
  { weekday: 6, title: '家庭聚餐', start: at(18), hours: 2, source: 'Google Calendar' },
]

const oneOffEvents: CalendarEvent[] = [
  { id: 'e-dentist', title: '牙醫', date: day(0), start: at(19), hours: 1, source: 'Google Calendar' },
  { id: 'e-lunch', title: '午餐 · Ken', date: day(2), start: at(12), hours: 1, source: 'Google Calendar' },
  { id: 'e-visit', title: 'Ken 來台北', date: day(3), start: 0, hours: 48, allDay: true, source: 'Google Calendar' },
]

/** Calendar events from last week through two weeks ahead. */
export const events: CalendarEvent[] = [
  ...[-7, 0, 7, 14].flatMap((weekOffset) =>
    weeklyEvents.map(({ weekday, ...e }, i) => ({ ...e, id: `e-${weekOffset}-${i}`, date: day(weekOffset + weekday) })),
  ),
  ...oneOffEvents,
]

export const memories: Memory[] = [
  { id: 'm1', kind: 'stated', text: '加班的日子 → 回家伸展 10 分鐘', date: day(0), via: 'evening' },
  { id: 'm2', kind: 'stated', text: '週日不排工作', date: '2026-09-14' },
  { id: 'm3', kind: 'stated', text: '週四晚上固定打排球', date: '2026-09-02' },
  { id: 'm4', kind: 'inferred', text: '下午會議多的日子，你寫東西比較難', date: day(0), evidence: 5, confidence: 'medium' },
  { id: 'm5', kind: 'inferred', text: '長跑你常少估 35% 的時間', date: day(-2), evidence: 6, confidence: 'high' },
]

/** Things jotted down in 隨手記, one of each kind the agent sorts into. */
export const notes: Note[] = [
  { id: 'n-1', text: '記得回房東訊息，問冷氣什麼時候修', date: day(0), time: at(22, 14), source: 'hotkey', state: 'new' },
  { id: 'n-2', text: '想學吉他，至少能彈幾首歌', date: day(0), time: at(23, 2), source: 'page', state: 'new' },
  { id: 'n-3', text: '我早上腦袋比較清楚，下午開會比較不累', date: day(1), time: at(7, 48), source: 'page', state: 'new' },
  { id: 'n-4', text: 'Ken 生日', date: day(1), time: at(8, 5), source: 'hotkey', state: 'new' },
  { id: 'n-5', text: '那本講習慣的書，書名好像叫 Tiny Habits', date: day(1), time: at(8, 31), source: 'page', state: 'new' },
]

export const experiments: Experiment[] = [
  {
    id: 'x1',
    title: '早上先做最難的事',
    weeks: 4,
    finished: true,
    arms: [
      { label: '照平常排的兩週', value: '58%', metric: '升等 doc 有寫的天數' },
      { label: '先做最難的兩週', value: '74%', metric: '升等 doc 有寫的天數', highlight: true },
    ],
    conclusion: '看起來可能有用。不過「先做難的」那兩週剛好少了 3 場會議，差距有一部分可能是因為這個。',
  },
  { id: 'x2', title: '單字卡：睡前背 vs 早上背', weeks: 4, week: 2, finished: false },
]

export const connections: Connection[] = [
  { id: 'c1', name: 'Google Calendar', connected: true, detail: '可讀可寫 · 2 分鐘前同步' },
  { id: 'c2', name: 'Strava', connected: true, detail: '跑步紀錄會自動算成「做了」' },
  { id: 'c3', name: 'Anki', connected: true, detail: '背卡紀錄會自動算成「做了」' },
  { id: 'c4', name: 'Apple 行事曆', connected: false, access: { reads: '行事曆上的事件：標題、時間、地點', writes: '你確認過的待辦時段，放在獨立的「Jezo」行事曆' } },
  { id: 'c5', name: 'Outlook', connected: false, access: { reads: '行事曆上的事件：標題、時間、地點', writes: '你確認過的待辦時段，放在獨立的「Jezo」行事曆' } },
  { id: 'c6', name: 'Gmail', connected: false, detail: '讓它知道哪些信卡住了', access: { reads: '信件的標題、寄件人和日期，用來找出你還沒回的信。不讀內文。' } },
]

/** One change in a reworked day. `change` is applied to the todo when the user accepts. */
export interface ReworkItem {
  todoId: string
  title: string
  note: string
  change: Partial<Todo>
}

/** What the agent would do with today, depending on how the user is doing. */
export const reworkPlans: Record<Energy, { keep: ReworkItem[]; move: ReworkItem[]; drop: ReworkItem[] }> = {
  low: {
    keep: [{ todoId: 't-7', title: '背 5 張單字卡', note: '原本 15 張', change: { title: '背 5 張單字卡', estimateMinutes: 5 } }],
    move: [
      { todoId: 't-2', title: '寫升等 doc 的「Impact」那段', note: '→ 明天 09:10 咖啡後', change: { slot: { date: day(2), start: at(9, 10) } } },
      { todoId: 't-6', title: '去健身房，只做 20 分鐘', note: '→ 週四 18:30', change: { slot: { date: day(3), start: at(18, 30) } } },
      { todoId: 't-5', title: 'N3 聽力 1 回', note: '→ 明天通勤', change: { slot: { date: day(2), start: at(19, 10) } } },
    ],
    drop: [{ todoId: 't-u1', title: '回 3 封卡住的信', note: '不排，明天早上再問你', change: { slot: null } }],
  },
  some: {
    keep: [
      { todoId: 't-2', title: '升等 doc：只寫 3 個重點', note: '15 分，原本 70 分', change: { title: '升等 doc：只寫 3 個重點', estimateMinutes: 15 } },
      { todoId: 't-7', title: '背 15 張單字卡', note: '照原本', change: {} },
    ],
    move: [
      { todoId: 't-6', title: '去健身房，只做 20 分鐘', note: '→ 週四 18:30', change: { slot: { date: day(3), start: at(18, 30) } } },
      { todoId: 't-5', title: 'N3 聽力 1 回', note: '→ 明天通勤', change: { slot: { date: day(2), start: at(19, 10) } } },
    ],
    drop: [{ todoId: 't-u1', title: '回 3 封卡住的信', note: '不排', change: { slot: null } }],
  },
  plenty: {
    keep: [
      { todoId: 't-2', title: '寫升等 doc 的「Impact」那段', note: '縮成 45 分', change: { estimateMinutes: 45 } },
      { todoId: 't-5', title: 'N3 聽力 1 回', note: '19:10 通勤', change: {} },
      { todoId: 't-7', title: '背 15 張單字卡', note: '22:30', change: {} },
    ],
    move: [{ todoId: 't-6', title: '去健身房，只做 20 分鐘', note: '→ 週四 18:30，今天來不及', change: { slot: { date: day(3), start: at(18, 30) } } }],
    drop: [{ todoId: 't-u1', title: '回 3 封卡住的信', note: '不排', change: { slot: null } }],
  },
}

