// Writes a workspace filled with the mockup's sample data, for development and
// for the E2E tests: bun scripts/fixture.ts <directory>
// JEZO_LANGUAGE picks its language: zh-TW (the default, which the tests read),
// zh-CN, or en, for the README's pictures in each language.
// The mockup's "today" (NOW in mock.ts) becomes the real today, so the data is
// always current. It refuses to write into a directory that already has files.

import './temporal'
import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateNKeysBetween } from 'fractional-indexing'
import { Converter } from 'opencc-js/t2cn'
import { parse, patch } from '../src/main/workspace/frontmatter'
import { localDate, todoFields, writeLocal } from '../src/renderer/src/data/entities'
import { NOW, notes, todos } from '../src/renderer/src/data/mock'

const dir = process.argv[2]
if (!dir) throw new Error('Usage: bun scripts/fixture.ts <directory>')
await mkdir(dir, { recursive: true })
if ((await readdir(dir)).length) throw new Error(`${dir} isn't empty.`)

/** The sample texts in English, each as a whole. */
const ENGLISH: Record<string, string> = {
  '打給媽': 'Call Mom',
  '晚餐後': 'after dinner',
  '訂 12 月比賽的住宿': 'Book a place to stay for the December race',
  'N3 聽力 1 回': 'One N3 listening set',
  '搭上回家的捷運': 'on the train home',
  '和 Anna 的 1:1': '1:1 with Anna',
  '來自你的行事曆。': 'From your calendar.',
  '午休跑 3 km': 'Lunchtime 3 km run',
  '午休開始': 'when lunch starts',
  '背 15 張單字卡': 'Review 15 flashcards',
  '刷完牙': 'after brushing teeth',
  '這是你最穩的習慣：14 次做到 12 次。': 'Your steadiest habit: done 12 times out of 14.',
  '去健身房，只做 20 分鐘': 'Gym, just 20 minutes',
  '下班走出大樓': 'after walking out of the office',
  '只排 20 分鐘，因為短的比較容易開始。加上換衣服，我抓 30 分。這條規則過去 9 次你做到 7 次。': 'Only 20 minutes, because short is easier to start. With changing, I planned 30. You kept this rule 7 times out of 9.',
  '寫升等 doc 的「Impact」那段': 'Write the “Impact” section of the promo doc',
  '到公司倒完咖啡': 'after getting coffee at work',
  '列出 3 個案例': 'List 3 examples',
  '每個配一句數字': 'One number for each',
  '寄給 Anna': 'Send to Anna',
  '你自己估 45 分，但前 8 次寫這類段落平均用了 68 分，所以排 70 分。今天下午有兩場會，你昨晚說會議多的時候寫不下去，所以放早上。': 'You guessed 45 minutes, but the last 8 sections like this took 68 on average, so I planned 70. There are two meetings this afternoon, and you said last night that you can’t write on meeting-heavy days, so it’s in the morning.',
  '長跑 16 km': 'Long run, 16 km',
  '起床喝完水': 'after the morning glass of water',
  '你長跑常少估 35%，所以排 2 小時 5 分。': 'You tend to underestimate long runs by 35%, so I planned 2 hours 5 minutes.',
  '綁在通勤上，不佔你在家的時間。': 'Tied to the commute, so it doesn’t take time at home.',
  '寫升等 doc 的「Leadership」那段': 'Write the “Leadership” section of the promo doc',
  '晨跑 5 km': 'Morning run, 5 km',
  '整理 N3 文法筆記': 'Tidy up N3 grammar notes',
  '寫升等 doc 的「Scope」那段': 'Write the “Scope” section of the promo doc',
  '回 3 封卡住的信': 'Answer 3 stuck emails',
  '午餐回座位': 'back at my desk after lunch',
  '日文 N3': 'Japanese N3',
  '考試': 'exam',
  '張卡': 'cards',
  '單字卡是你最穩的習慣。聽力可以再多一點。': 'Flashcards are your steadiest habit. Listening could use a bit more.',
  '12 月半馬': 'December half marathon',
  '台北馬': 'Taipei Marathon',
  '去健身房 20 分': 'gym for 20 minutes',
  '週六起床': 'Saturday after getting up',
  '長跑': 'long run',
  '跑 5 km': 'run 5 km',
  '大致照計畫走。唯一卡住的是早上的跑步，10 次只成 3 次。': 'Mostly on plan. The one thing stuck is the morning run: 3 out of 10.',
  '跑完台北馬半馬，不走路。': 'Finish the Taipei half marathon without walking.',
  'Q4 升等 doc': 'Q4 promo doc',
  '送出': 'submit',
  '段': 'sections',
  '寫 doc 70 分': 'write the doc for 70 minutes',
  '週五 20:00': 'Friday 20:00',
  '寫 doc 90 分': 'write the doc for 90 minutes',
  '每段寫完': 'after finishing a section',
  '丟給 Anna 看': 'send it to Anna',
  '進度比計畫慢一點。週五晚上排的時段 4 次都沒用上，我想把它移到週三。': 'A little behind plan. The Friday evening slot went unused 4 times; I’d like to move it to Wednesday.',
  '週三 19:30': 'Wednesday 19:30',
  '寫 doc 60 分': 'write the doc for 60 minutes',
  '週五晚上那條 4 次都沒用上。週三晚上你通常在家，行事曆也空著。': 'The Friday evening rule went unused 4 times. You’re usually home on Wednesday evenings, and the calendar is free.',
  '年底前把升等文件送出去。寫完 13 段，每段 Anna 看過。': 'Submit the promotion doc by the end of the year: 13 sections, each one read by Anna.',
  '家人': 'Family',
  '次': 'calls',
  '上週漏了一次。這週我先幫你留週三晚上。': 'One was missed last week. I’ve kept Wednesday evening free this week.',
  '每週打給媽一次。': 'Call Mom once a week.',
  'Ken 生日': 'Ken’s birthday',
  '那本講習慣的書，書名好像叫 Tiny Habits': 'That book about habits, I think it’s called Tiny Habits',
  '記得回房東訊息，問冷氣什麼時候修': 'Reply to the landlord, ask when the AC gets fixed',
  '想學吉他，至少能彈幾首歌': 'Learn guitar, at least a few songs',
  '我早上腦袋比較清楚，下午開會比較不累': 'My head is clearer in the morning; meetings are easier in the afternoon',
  '週四晚上固定打排球': 'Plays volleyball every Thursday evening',
  '週日不排工作': 'No work on Sundays',
  '加班的日子 → 回家伸展 10 分鐘': 'Days with overtime → stretch for 10 minutes at home',
  '長跑你常少估 35% 的時間': 'You underestimate long runs by about 35%',
  '下午會議多的日子，你寫東西比較難': 'Writing is harder for you on afternoons full of meetings',
}

const resources = join(import.meta.dir, '../resources')
const language = process.env.JEZO_LANGUAGE ?? 'zh-TW'
if (language !== 'zh-TW') await cp(join(resources, `workspace.${language}`), dir, { recursive: true })
await cp(join(resources, 'workspace'), dir, { recursive: true, force: false, errorOnExist: false })
await mkdir(join(dir, 'sessions'), { recursive: true })

/** A local clock in the fixture's zone, as the moment a record is written as. */
const moment = (clock: string) => Temporal.PlainDateTime.from(clock).toZonedDateTime(zone).toString({ smallestUnit: 'second', timeZoneName: 'never' })
const DAY = 86_400_000
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
const offset = Math.round((Date.parse(localDate(zone)) - Date.parse(NOW.date)) / DAY)
const shift = (date: string) => new Date(Date.parse(date) + offset * DAY).toISOString().slice(0, 10)

const ranks = generateNKeysBetween(null, null, todos.length)
for (const [i, todo] of todos.entries()) {
  const fields = { id: todo.id, title: todo.title, state: todo.state, ...todoFields({ ...todo, slot: todo.slot && { ...todo.slot, date: shift(todo.slot.date) }, rank: ranks[i] }, { zone, device: zone }) }
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined))
  await mkdir(join(dir, 'todos/items'), { recursive: true })
  await writeFile(join(dir, 'todos/items', `${todo.id}.md`), patch('', clean))
}
for (const note of notes) {
  const fields = { id: note.id, created: moment(writeLocal(shift(note.date), note.time)), source: note.source, state: note.state }
  await mkdir(join(dir, 'notes/items'), { recursive: true })
  await writeFile(join(dir, 'notes/items', `${note.id}.md`), patch(`${note.text}\n`, fields))
}
// The mockup's goals, as their files would say them. Progress isn't written; the app counts it from the todos.
const goals = [
  {
    fields: {
      id: 'g-1', name: 'Q4 升等 doc', hue: 255, state: 'active', due: '2026-11-15', due_note: '送出',
      measure: { unit: '段', total: 13, start: 3 },
      rules: [
        { cue: '到公司倒完咖啡', action: '寫 doc 70 分' },
        { cue: '週五 20:00', action: '寫 doc 90 分' },
        { cue: '每段寫完', action: '丟給 Anna 看' },
      ],
      note: '進度比計畫慢一點。週五晚上排的時段 4 次都沒用上，我想把它移到週三。',
      rule_proposal: { rule: 1, cue: '週三 19:30', action: '寫 doc 60 分', why: '週五晚上那條 4 次都沒用上。週三晚上你通常在家，行事曆也空著。' },
    },
    body: '年底前把升等文件送出去。寫完 13 段，每段 Anna 看過。\n',
  },
  {
    fields: {
      id: 'g-2', name: '12 月半馬', hue: 150, state: 'active', due: '2026-12-14', due_note: '台北馬',
      measure: { unit: 'km', total: 380, start: 132 },
      rules: [
        { cue: '下班走出大樓', action: '去健身房 20 分' },
        { cue: '週六起床', action: '長跑' },
        { cue: '起床喝完水', action: '跑 5 km' },
      ],
      note: '大致照計畫走。唯一卡住的是早上的跑步，10 次只成 3 次。',
    },
    body: '跑完台北馬半馬，不走路。\n',
  },
  {
    fields: {
      id: 'g-3', name: '日文 N3', hue: 300, state: 'active', due: '2026-12-07', due_note: '考試',
      measure: { unit: '張卡', total: 3000, start: 590 },
      rules: [
        { cue: '刷完牙', action: '背 15 張單字卡' },
        { cue: '搭上回家的捷運', action: 'N3 聽力 1 回' },
      ],
      note: '單字卡是你最穩的習慣。聽力可以再多一點。',
    },
    body: '',
  },
  {
    fields: {
      id: 'g-4', name: '家人', hue: 20, state: 'active',
      measure: { unit: '次', total: 4 },
      rules: [{ cue: '晚餐後', action: '打給媽' }],
      note: '上週漏了一次。這週我先幫你留週三晚上。',
    },
    body: '每週打給媽一次。\n',
  },
]
await mkdir(join(dir, 'goals/items'), { recursive: true })
for (const goal of goals) await writeFile(join(dir, 'goals/items', `${goal.fields.id}.md`), patch(goal.body, goal.fields))

// The mockup's memories. Inferences carry the todos they rest on.
const memories = [
  { id: 'm-1', epistemic: 'stated', about: 'preference', recorded: moment(`${shift(NOW.date)}T21:40`), text: '加班的日子 → 回家伸展 10 分鐘' },
  { id: 'm-2', epistemic: 'stated', about: 'preference', recorded: moment('2026-09-14T20:10'), text: '週日不排工作' },
  { id: 'm-3', epistemic: 'stated', about: 'fact', recorded: moment('2026-09-02T19:30'), text: '週四晚上固定打排球' },
  { id: 'm-4', epistemic: 'inferred', about: 'pattern', recorded: moment(`${shift(NOW.date)}T08:00`), confidence: 'medium', evidence: ['todos/items/t-x7.md', 'todos/items/t-2.md'], text: '下午會議多的日子，你寫東西比較難' },
  { id: 'm-5', epistemic: 'inferred', about: 'pattern', recorded: moment(`${shift(NOW.date)}T08:00`), confidence: 'high', evidence: ['todos/items/t-x16.md'], text: '長跑你常少估 35% 的時間' },
]
await mkdir(join(dir, 'memory/items'), { recursive: true })
for (const { text, ...fields } of memories) {
  await writeFile(join(dir, 'memory/items', `${fields.id}.md`), patch(`${text}\n`, { ...fields, status: 'active', source: fields.epistemic === 'inferred' ? 'agent' : 'user' }))
}

// In another language, every sample text is written in it: Simplified by OpenCC, English from the list below.
if (language !== 'zh-TW') {
  const simplified = Converter({ from: 'twp', to: 'cn' })
  const say = (text: string) => (language === 'zh-CN' ? simplified(text).replaceAll('行事历', '日历').replaceAll('升等 doc 的', '晋升文档的').replaceAll('升等 doc', '晋升文档').replaceAll('升等文件', '晋升文档').replaceAll('单字卡', '单词卡').replaceAll('捷运', '地铁') : (ENGLISH[text.trim()] ?? text))
  const translate = (value: unknown): unknown =>
    typeof value === 'string' ? say(value) : Array.isArray(value) ? value.map(translate) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, translate(v)])) : value
  for (const kind of ['todos', 'goals', 'notes', 'memory']) {
    for (const file of await readdir(join(dir, kind, 'items'))) {
      const path = join(dir, kind, 'items', file)
      const { data, body } = parse(await readFile(path, 'utf8'))
      await writeFile(path, patch('', translate(data) as Record<string, unknown>, body.trim() ? `${say(body.trim())}\n` : ''))
    }
  }
}

console.log(`Wrote ${todos.length} todos, ${goals.length} goals, ${notes.length} notes and ${memories.length} memories to ${dir}`)

