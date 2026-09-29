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
  Goal,
  HistoryEntry,
  Memory,
  Note,
  Session,
  Skill,
  Todo,
} from './types'

export const NOW = { date: '2026-09-29', hour: 8 + 40 / 60 }
export const THIS_WEEK_MONDAY = '2026-09-28'

export const goals: Goal[] = [
  {
    id: 'g1',
    name: 'Q4 升等 doc',
    hue: 255,
    dueLabel: '11/15 送出 · 還有 7 週',
    progress: { done: 4, total: 13, unit: '段寫完' },
    weekShort: '這週 1 / 2 段',
    weekLong: '這週：寫了 1 段，還有 1 段排著',
    plannedThisWeek: 1,
    agentNote: '進度比計畫慢一點。週五晚上排的時段 4 次都沒用上，我想把它移到週三。',
    rules: [
      { cue: '到公司倒完咖啡', action: '寫 doc 70 分', hits: 5, tries: 8 },
      { cue: '週五 20:00', action: '寫 doc 90 分', hits: 0, tries: 4 },
      { cue: '每段寫完', action: '丟給 Anna 看', hits: 2, tries: 4 },
    ],
    estimates: {
      summary: '常少估 50%',
      lines: [
        { text: '寫一段你通常說 45 分，實際要 70 分左右', basis: { records: 6 } },
        { text: '所以我每段排 70 分' },
      ],
      samples: [
        { estimated: 45, actual: 68 },
        { estimated: 45, actual: 72 },
        { estimated: 40, actual: 70 },
        { estimated: 45, actual: 64 },
        { estimated: 45, actual: 75 },
        { estimated: 45, actual: 69 },
      ],
    },
    report: {
      range: '9/21–9/27',
      lines: [{ text: '完成 3 / 5 次，比上週多 1 次' }, { text: '週五晚上沒寫，你說太累', basis: 'stated' }],
    },
    ruleProposal: { ruleIndex: 1, cue: '週三 19:30', action: '寫 doc 60 分', why: '週五晚上那條 4 次都沒用上。週三晚上你通常在家，行事曆也空著。' },
  },
  {
    id: 'g2',
    name: '12 月半馬',
    hue: 150,
    dueLabel: '12/14 台北馬 · 還有 11 週',
    progress: { done: 142, total: 380, unit: 'km 跑了' },
    weekShort: '這週 12 / 34 km',
    weekLong: '這週：跑了 12 km，還有 22 km 排著',
    plannedThisWeek: 22,
    agentNote: '大致照計畫走。唯一卡住的是早上 6:40 的跑步，10 次只成 3 次。',
    rules: [
      { cue: '下班走出大樓', action: '去健身房 20 分', hits: 7, tries: 9 },
      { cue: '週六起床', action: '長跑', hits: 4, tries: 5 },
      { cue: '早上 6:40 鬧鐘', action: '跑 5 km', hits: 3, tries: 10 },
    ],
    estimates: {
      summary: '常少估 35%',
      lines: [
        { text: '長跑你通常說 1.5 小時，實際要 2 小時左右', basis: { records: 6 } },
        { text: '所以週六 16 km 我排 2 小時 5 分' },
      ],
      samples: [
        { estimated: 90, actual: 122 },
        { estimated: 80, actual: 108 },
        { estimated: 80, actual: 100 },
        { estimated: 90, actual: 128 },
        { estimated: 85, actual: 118 },
        { estimated: 95, actual: 128 },
      ],
    },
    report: {
      range: '9/21–9/27',
      lines: [{ text: '完成 4 / 5 次，比上週多 1 次' }, { text: '週三那次沒跑，你說是加班', basis: 'stated' }],
    },
    ruleProposal: { ruleIndex: 2, cue: '午休開始', action: '跑 3 km', why: '早上 6:40 那條 10 次只成 3 次。午休跑你這週試過一次，比較容易開始。' },
  },
  {
    id: 'g3',
    name: '日文 N3',
    hue: 300,
    dueLabel: '12/7 考試 · 還有 10 週',
    progress: { done: 620, total: 3000, unit: '張卡' },
    weekShort: '這週 45 / 105 張',
    weekLong: '這週：背了 45 張，還有 60 張排著',
    plannedThisWeek: 60,
    agentNote: '單字卡是你最穩的習慣。聽力可以再多一點。',
    rules: [
      { cue: '刷完牙', action: '背 15 張單字卡', hits: 12, tries: 14 },
      { cue: '搭上回家的捷運', action: 'N3 聽力 1 回', hits: 6, tries: 9 },
    ],
    estimates: {
      summary: '很準',
      lines: [{ text: '背卡你估 10 分，實際約 12 分', basis: { records: 6 } }, { text: '我照你說的排' }],
      samples: [
        { estimated: 10, actual: 12 },
        { estimated: 10, actual: 11 },
        { estimated: 10, actual: 13 },
        { estimated: 10, actual: 12 },
        { estimated: 10, actual: 10 },
        { estimated: 10, actual: 14 },
      ],
    },
    report: {
      range: '9/21–9/27',
      lines: [{ text: '完成 11 / 12 天' }, { text: '週四聚餐沒背', basis: 'stated' }],
    },
  },
  {
    id: 'g4',
    name: '家人',
    hue: 20,
    dueLabel: '每週一次',
    progress: { done: 3, total: 4, unit: '週有打給媽' },
    weekShort: '這週 0 / 1 次',
    weekLong: '這週：還沒打',
    plannedThisWeek: 1,
    agentNote: '上週漏了一次。這週我先幫你留週三晚上。',
    rules: [{ cue: '週日晚餐後', action: '打給媽', hits: 3, tries: 4 }],
    estimates: {
      summary: '常聊比較久',
      lines: [{ text: '你估 15 分，通常聊 25 分左右', basis: { records: 4 } }, { text: '所以我排 25 分，後面不塞東西' }],
      samples: [
        { estimated: 15, actual: 25 },
        { estimated: 15, actual: 22 },
        { estimated: 15, actual: 28 },
        { estimated: 15, actual: 24 },
      ],
    },
    report: { range: '9/21–9/27', lines: [{ text: '這週還沒打' }] },
  },
]

const day = (offset: number) => {
  const d = new Date(`${THIS_WEEK_MONDAY}T00:00:00`)
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('sv-SE')
}
const at = (h: number, m = 0) => h + m / 60

let n = 0
const todo = (t: Omit<Todo, 'id'> & { id?: string }): Todo => ({ id: `todo-${n++}`, ...t })

export const todos: Todo[] = [
  // Today. The morning session proposed everything except the run, which was already done.
  todo({ id: 't1', goalId: 'g2', title: '晨跑 5 km', cue: '起床喝完水', state: 'done', estimateMinutes: 35, slot: { date: day(1), start: at(7) } }),
  todo({
    id: 't2',
    goalId: 'g1',
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
  todo({ id: 't3', goalId: 'g1', title: '和 Anna 的 1:1', state: 'draft', estimateMinutes: 30, slot: { date: day(1), start: at(10, 30) }, fromCalendar: true, why: '來自你的行事曆。' }),
  todo({
    id: 't6',
    goalId: 'g2',
    title: '去健身房，只做 20 分鐘',
    cue: '下班走出大樓',
    state: 'draft',
    estimateMinutes: 30,
    slot: { date: day(1), start: at(18, 30) },
    why: '只排 20 分鐘，因為短的比較容易開始。加上換衣服，我抓 30 分。這條規則過去 9 次你做到 7 次。',
  }),
  todo({ id: 't5', goalId: 'g3', title: 'N3 聽力 1 回', cue: '搭上回家的捷運', state: 'draft', estimateMinutes: 15, slot: { date: day(1), start: at(19, 10) }, why: '綁在通勤上，不佔你在家的時間。' }),
  todo({ id: 't7', goalId: 'g3', title: '背 15 張單字卡', cue: '刷完牙', state: 'draft', estimateMinutes: 12, slot: { date: day(1), start: at(22, 30) }, why: '這是你最穩的習慣：14 次做到 12 次。' }),

  // Yesterday.
  todo({ goalId: 'g2', title: '晨跑 5 km', cue: '起床喝完水', state: 'done', estimateMinutes: 35, slot: { date: day(0), start: at(7) } }),
  todo({ goalId: 'g1', title: '寫升等 doc 的「Scope」那段', cue: '到公司倒完咖啡', state: 'done', estimateMinutes: 70, slot: { date: day(0), start: at(9, 10) } }),
  todo({ goalId: 'g3', title: '背 15 張單字卡', cue: '刷完牙', state: 'done', estimateMinutes: 12, slot: { date: day(0), start: at(22, 30) } }),

  // Later this week, accepted during last week's review.
  todo({ goalId: 'g1', title: '寫升等 doc 的「Leadership」那段', cue: '到公司倒完咖啡', state: 'open', estimateMinutes: 70, slot: { date: day(2), start: at(9, 10) } }),
  todo({ goalId: 'g3', title: 'N3 聽力 1 回', cue: '搭上回家的捷運', state: 'open', estimateMinutes: 15, slot: { date: day(2), start: at(19, 10) } }),
  todo({ goalId: 'g3', title: '背 15 張單字卡', cue: '刷完牙', state: 'open', estimateMinutes: 12, slot: { date: day(2), start: at(22, 30) } }),
  todo({ goalId: 'g2', title: '去健身房，只做 20 分鐘', cue: '下班走出大樓', state: 'open', estimateMinutes: 30, slot: { date: day(3), start: at(18) } }),
  todo({ goalId: 'g3', title: '背 15 張單字卡', cue: '刷完牙', state: 'open', estimateMinutes: 12, slot: { date: day(3), start: at(22, 30) } }),
  todo({ goalId: 'g2', title: '午休跑 3 km', cue: '午休開始', state: 'open', estimateMinutes: 30, slot: { date: day(4), start: at(12, 30) } }),
  todo({ goalId: 'g3', title: '背 15 張單字卡', cue: '刷完牙', state: 'open', estimateMinutes: 12, slot: { date: day(4), start: at(22, 30) } }),
  todo({ goalId: 'g2', title: '長跑 16 km', cue: '起床喝完水', state: 'open', estimateMinutes: 125, slot: { date: day(5), start: at(8) }, why: '你長跑常少估 35%，所以排 2 小時 5 分。' }),

  // Backlog: accepted, not scheduled yet.
  todo({ id: 'u1', goalId: 'g1', title: '回 3 封卡住的信', cue: '午餐回座位', state: 'open', estimateMinutes: 25, slot: null }),
  todo({ id: 'u2', goalId: 'g4', title: '打給媽', cue: '晚餐後', state: 'open', estimateMinutes: 25, slot: null }),
  todo({ id: 'u3', goalId: 'g2', title: '訂 12 月比賽的住宿', state: 'open', estimateMinutes: 20, slot: null }),
  todo({ id: 'u4', goalId: 'g3', title: '整理 N3 文法筆記', state: 'open', estimateMinutes: 45, slot: null }),
]

/** Where the agent would put backlog items if asked to find time, and why. */
export const suggestedSlots: Record<string, { date: string; start: number; why: string }> = {
  u1: { date: day(1), start: at(13), why: '午餐後 13:00 到 Design review 之前有一小時空檔。' },
  u2: { date: day(2), start: at(20, 30), why: '週三晚上 19:00 後全空。你們通常聊 25 分，後面我不塞東西。' },
  u3: { date: day(4), start: at(20), why: '週五晚上比較鬆，訂房要比價。' },
  u4: { date: day(5), start: at(15), why: '週六下午沒排東西，這件需要一整段時間。' },
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

export const sessions: Session[] = [
  {
    id: 's1',
    trigger: 'morning',
    date: day(1),
    time: at(8, 2),
    messages: [
      { kind: 'steps', summary: '看了你的行事曆和昨晚的紀錄', lines: ['讀 calendar 9/29', '讀 memory：昨晚 check-in', '讀 goals/*', '寫 todo/2026-09-29.md · 已驗證'] },
      { kind: 'agent', text: '早安。今天下午 2 點到 4 點有兩場會，你昨晚說會議多的時候很難寫東西，所以我把寫 doc 放到早上咖啡之後。你看這樣可以嗎？' },
      { kind: 'plan', title: '今天的安排', todoIds: ['t2', 't3', 't6', 't5', 't7'] },
      { kind: 'agent', text: '另外有兩件我不確定要不要排：回那 3 封卡住的信，還有打給媽。要加哪個？' },
      { kind: 'choices', options: ['都加', '只加打給媽', '今天先不要'] },
    ],
  },
  {
    id: 's2',
    title: '這週哪天晚上空？',
    trigger: 'hotkey',
    date: day(1),
    time: at(15, 20),
    messages: [
      { kind: 'user', text: '這週還有哪天晚上是空的？' },
      { kind: 'steps', summary: '看了你的行事曆', lines: ['讀 calendar 9/29–10/5'] },
      { kind: 'agent', text: '週三和週五。週四 19:00 有排球，週一被牙醫佔了。要不要把「打給媽」放到週三？' },
    ],
  },
  {
    id: 's3',
    trigger: 'evening',
    date: day(0),
    time: at(21, 34),
    messages: [
      { kind: 'agent', text: '今天排了 5 件，做了 4 件。健身房那件沒去，是什麼卡住了？' },
      { kind: 'user', text: '加班' },
      { kind: 'agent', text: '了解，加班不是你的問題，我不會記成「沒自律」。要不要給加班的日子留一個更小的版本？例如回家伸展 10 分鐘，也算數。' },
      { kind: 'user', text: '好' },
      { kind: 'memory', text: '記住了：加班的日子 → 回家伸展 10 分鐘' },
      { kind: 'agent', text: '最後一題：明天早上你最想先顧好哪一件？' },
      { kind: 'user', text: '升等 doc' },
      {
        kind: 'memory-preview',
        stated: ['9/28 沒去健身房，原因：加班（你說的）', '加班的日子 → 回家伸展 10 分鐘'],
        skipped: [{ text: '週三晚上普遍比較難', why: '只有 1 次，不夠下結論' }],
        plan: ['明天早上先排升等 doc'],
        saved: true,
      },
      { kind: 'agent', text: '好，明早會先排它。晚安。' },
    ],
  },
  {
    id: 's4',
    trigger: 'weekly',
    date: day(-2),
    time: at(20),
    messages: [
      { kind: 'agent', text: '這週 4 個目標裡，半馬跑了 31 km（計畫 34），單字卡 11 / 12 天，升等 doc 寫了 1 段，打給媽 0 次。' },
      { kind: 'agent', text: '早上 6:40 的跑步這週又只成 1 次。我覺得是時段不對，不是你的問題。下週要不要試試午休跑？' },
    ],
  },
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
  { id: 'n1', text: '記得回房東訊息，問冷氣什麼時候修', date: day(0), time: at(22, 14), source: 'hotkey', state: 'new' },
  { id: 'n2', text: '想學吉他，至少能彈幾首歌', date: day(0), time: at(23, 2), source: 'page', state: 'new' },
  { id: 'n3', text: '我早上腦袋比較清楚，下午開會比較不累', date: day(1), time: at(7, 48), source: 'page', state: 'new' },
  { id: 'n4', text: 'Ken 生日', date: day(1), time: at(8, 5), source: 'hotkey', state: 'new' },
  { id: 'n5', text: '那本講習慣的書，書名好像叫 Tiny Habits', date: day(1), time: at(8, 31), source: 'page', state: 'new' },
]

const skill = (title: string, rules: string[], scope = '所有目標') => `---
name: ${title}
scope: ${scope}
---

${rules.map((r) => `- ${r}`).join('\n')}
`

const estimateRules = [
  '排時間用你過去實際花的時間，不用你估的',
  '樣本少於 3 次時，使用你的估計',
  '差太多的時候，在「為什麼這樣排」裡說明',
]

export const skills: Skill[] = [
  {
    id: 'k1',
    title: '把目標拆成「什麼時候做什麼」',
    description: '例如「下班走出大樓 → 去健身房」，比「這週運動 3 次」容易開始',
    enabled: true,
    instructions: skill('把目標拆成「什麼時候做什麼」', [
      '每條待辦都寫成「情境 → 動作」',
      '情境用時間、地點，或前一個動作',
      '一條規則連續 5 次沒做到，提議改寫，不要自己改',
    ]),
  },
  {
    id: 'k2',
    title: '用你的紀錄估時間',
    description: '你常少估，它會照你過去實際花的時間排',
    enabled: true,
    instructions: skill('用你的紀錄估時間', estimateRules),
    proposal: {
      why: '長跑估時常漏掉換衣服和通勤，而且 3 次的樣本太少，估出來會跳。',
      evidence: ['9/12 長跑', '9/19 長跑', '9/26 長跑'],
      diff: [
        { kind: 'context', text: '- 排時間用你過去實際花的時間，不用你估的' },
        { kind: 'remove', text: '- 樣本少於 3 次時，使用你的估計' },
        { kind: 'add', text: '- 樣本少於 5 次時，使用你的估計' },
        { kind: 'add', text: '- 換衣服、通勤另計，不算在任務本身' },
        { kind: 'context', text: '- 差太多的時候，在「為什麼這樣排」裡說明' },
      ],
      after: skill('用你的紀錄估時間', [
        '排時間用你過去實際花的時間，不用你估的',
        '樣本少於 5 次時，使用你的估計',
        '換衣服、通勤另計，不算在任務本身',
        '差太多的時候，在「為什麼這樣排」裡說明',
      ]),
    },
  },
  {
    id: 'k3',
    title: '追進度、寫週報',
    description: '只算真的做了的，排了不算',
    enabled: true,
    instructions: skill('追進度、寫週報', ['只算有證據的完成：連接的紀錄，或你按了「做完了」', '排了但沒做的另外列，不算進度', '週報寫給你看，不寫給老闆看']),
  },
  {
    id: 'k4',
    title: '某天崩了幫你重排',
    description: '先問你狀態，再給比較小的版本',
    enabled: true,
    instructions: skill('某天崩了幫你重排', ['先問狀態，不問原因', '給縮小版，不是全部取消', '重排記成「重排」，不記成「沒做」']),
  },
  {
    id: 'k5',
    title: '把習慣綁在固定的事情後面',
    description: '時間、地點，或前一個動作',
    enabled: true,
    instructions: skill('把習慣綁在固定的事情後面', ['新習慣綁在一個每天都會發生的動作後面', '一次只綁一個', '綁不住就換線索，不是加鬧鐘']),
  },
  {
    id: 'k6',
    title: '小實驗',
    description: '想知道某個做法對你有沒有用，它幫你排 A/B 週',
    enabled: true,
    instructions: skill('小實驗', ['A 週和 B 週輪流排，至少各兩週', '結果附上可能的干擾，例如會議數不同', '結論由你決定要不要照做']),
  },
  {
    id: 'k7',
    title: '整理隨手記',
    description: '把你丟進隨手記的東西分成待辦、目標想法、要記住的事，看不懂的先問你',
    enabled: true,
    instructions: skill(
      '整理隨手記',
      [
        '每一則分成：待辦、目標想法、要記住的事、先留著；看不懂就問，不要猜',
        '待辦寫成草稿，標題用動詞開頭，原文放進「為什麼」',
        '目標想法不直接建目標，留給用戶跟你聊過再說',
        '要記住的事是用戶自己說的，記成 stated，不要加推論',
        '同一件事寫了好幾次，合成一則，並告訴用戶',
      ],
      '隨手記',
    ),
  },
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

export const history: HistoryEntry[] = [
  {
    id: 'h1',
    date: day(1),
    time: at(8, 2),
    source: 'morning',
    summary: '排了今天 5 件',
    files: [
      {
        path: 'todo/2026-09-29/impact-段落.md',
        lines: [
          { kind: 'add', text: 'state: draft' },
          { kind: 'add', text: 'cue: 到公司倒完咖啡' },
          { kind: 'add', text: 'estimate: 70  # 你估 45，前 8 次平均 68' },
        ],
      },
      { path: 'todo/2026-09-29/健身房.md', lines: [{ kind: 'add', text: 'state: draft' }, { kind: 'add', text: 'cue: 下班走出大樓' }] },
    ],
  },
  {
    id: 'h2',
    date: day(0),
    time: at(21, 34),
    source: 'evening',
    summary: '記住了：加班的日子 → 回家伸展 10 分鐘',
    files: [
      {
        path: 'memory/2026-09-28-加班.md',
        lines: [
          { kind: 'add', text: 'kind: stated' },
          { kind: 'add', text: 'source: 晚上 check-in' },
          { kind: 'add', text: 'text: 加班的日子 → 回家伸展 10 分鐘' },
        ],
      },
      {
        path: 'memory/2026-09-28-推論.md',
        lines: [
          { kind: 'remove', text: 'kind: inferred' },
          { kind: 'remove', text: 'text: 週三晚上普遍比較難' },
        ],
        note: '檢查擋下了這條推論：沒有附證據。',
      },
    ],
  },
  {
    id: 'h3',
    date: day(0),
    time: at(15, 13),
    source: 'hotkey',
    summary: '把寫 doc 挪到今天早上',
    check: { level: 'warn', retries: 2 },
    files: [
      {
        path: 'todo/2026-09-29/impact-段落.md',
        lines: [
          { kind: 'remove', text: 'slot: 2026-09-29 14:00' },
          { kind: 'add', text: 'slot: 2026-09-29 09:10' },
        ],
      },
    ],
  },
  { id: 'h4', date: day(0), time: at(15, 12), source: 'hotkey', summary: '它說「挪好了」，但其實沒改到', check: { level: 'error', kind: 'claimed-without-change' } },
  { id: 'h5', date: day(0), time: at(9, 40), source: 'you', summary: '刪掉「午餐後散步」這條' },
  {
    id: 'h6',
    date: day(-2),
    time: at(20),
    source: 'weekly',
    summary: '寫了 4 個目標的週報',
    files: [
      { path: 'goals/q4-升等/reports/2026-09-27.md', lines: [{ kind: 'add', text: '完成 3 / 5 次，比上週多 1 次' }] },
      { path: 'goals/半馬/reports/2026-09-27.md', lines: [{ kind: 'add', text: '完成 4 / 5 次，比上週多 1 次' }] },
    ],
  },
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
    keep: [{ todoId: 't7', title: '背 5 張單字卡', note: '原本 15 張', change: { title: '背 5 張單字卡', estimateMinutes: 5 } }],
    move: [
      { todoId: 't2', title: '寫升等 doc 的「Impact」那段', note: '→ 明天 09:10 咖啡後', change: { slot: { date: day(2), start: at(9, 10) } } },
      { todoId: 't6', title: '去健身房，只做 20 分鐘', note: '→ 週四 18:30', change: { slot: { date: day(3), start: at(18, 30) } } },
      { todoId: 't5', title: 'N3 聽力 1 回', note: '→ 明天通勤', change: { slot: { date: day(2), start: at(19, 10) } } },
    ],
    drop: [{ todoId: 'u1', title: '回 3 封卡住的信', note: '不排，明天早上再問你', change: { slot: null } }],
  },
  some: {
    keep: [
      { todoId: 't2', title: '升等 doc：只寫 3 個重點', note: '15 分，原本 70 分', change: { title: '升等 doc：只寫 3 個重點', estimateMinutes: 15 } },
      { todoId: 't7', title: '背 15 張單字卡', note: '照原本', change: {} },
    ],
    move: [
      { todoId: 't6', title: '去健身房，只做 20 分鐘', note: '→ 週四 18:30', change: { slot: { date: day(3), start: at(18, 30) } } },
      { todoId: 't5', title: 'N3 聽力 1 回', note: '→ 明天通勤', change: { slot: { date: day(2), start: at(19, 10) } } },
    ],
    drop: [{ todoId: 'u1', title: '回 3 封卡住的信', note: '不排', change: { slot: null } }],
  },
  plenty: {
    keep: [
      { todoId: 't2', title: '寫升等 doc 的「Impact」那段', note: '縮成 45 分', change: { estimateMinutes: 45 } },
      { todoId: 't5', title: 'N3 聽力 1 回', note: '19:10 通勤', change: {} },
      { todoId: 't7', title: '背 15 張單字卡', note: '22:30', change: {} },
    ],
    move: [{ todoId: 't6', title: '去健身房，只做 20 分鐘', note: '→ 週四 18:30，今天來不及', change: { slot: { date: day(3), start: at(18, 30) } } }],
    drop: [{ todoId: 'u1', title: '回 3 封卡住的信', note: '不排', change: { slot: null } }],
  },
}

