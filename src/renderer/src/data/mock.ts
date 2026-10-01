// Sample data from the design mockup. It stands in for the workspace until the
// backend exists. The week is Monday 2026-09-28 to Sunday 2026-10-04.
//
// The text here is the user's content (their goals, todos, what the agent said
// to them), so it isn't translated. Labels the app derives from it are.

import type {
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
const todo = (t: Omit<Todo, 'id' | 'notes'> & { id?: string; notes?: string }): Todo => ({ id: `t-x${n++}`, notes: '', ...t })

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

/** Things jotted down in 隨手記, one of each kind the agent sorts into. */
export const notes: Note[] = [
  { id: 'n-1', text: '記得回房東訊息，問冷氣什麼時候修', date: day(0), time: at(22, 14), source: 'hotkey', state: 'new' },
  { id: 'n-2', text: '想學吉他，至少能彈幾首歌', date: day(0), time: at(23, 2), source: 'page', state: 'new' },
  { id: 'n-3', text: '我早上腦袋比較清楚，下午開會比較不累', date: day(1), time: at(7, 48), source: 'page', state: 'new' },
  { id: 'n-4', text: 'Ken 生日', date: day(1), time: at(8, 5), source: 'hotkey', state: 'new' },
  { id: 'n-5', text: '那本講習慣的書，書名好像叫 Tiny Habits', date: day(1), time: at(8, 31), source: 'page', state: 'new' },
]




