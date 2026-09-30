// Writes a workspace filled with the mockup's sample data, for development and
// for the E2E tests: bun scripts/fixture.ts <directory>
// The mockup's "today" (NOW in mock.ts) becomes the real today, so the data is
// always current. It refuses to write into a directory that already has files.

import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { generateNKeysBetween } from 'fractional-indexing'
import { patch } from '../src/main/workspace/frontmatter'
import { localDate, todoFields, writeLocal } from '../src/renderer/src/data/entities'
import { NOW, notes, todos } from '../src/renderer/src/data/mock'

const dir = process.argv[2]
if (!dir) throw new Error('Usage: bun scripts/fixture.ts <directory>')
await mkdir(dir, { recursive: true })
if ((await readdir(dir)).length) throw new Error(`${dir} isn't empty.`)

const resources = join(import.meta.dir, '../resources')
const language = process.env.JEZO_LANGUAGE ?? 'zh-TW'
if (language !== 'zh-TW') await cp(join(resources, `workspace.${language}`), dir, { recursive: true })
await cp(join(resources, 'workspace'), dir, { recursive: true, force: false, errorOnExist: false })
await mkdir(join(dir, 'sessions'), { recursive: true })

const DAY = 86_400_000
const offset = Math.round((Date.parse(localDate(new Date())) - Date.parse(NOW.date)) / DAY)
const shift = (date: string) => new Date(Date.parse(date) + offset * DAY).toISOString().slice(0, 10)

const ranks = generateNKeysBetween(null, null, todos.length)
for (const [i, todo] of todos.entries()) {
  const fields = { id: todo.id, title: todo.title, state: todo.state, ...todoFields({ ...todo, slot: todo.slot && { ...todo.slot, date: shift(todo.slot.date) }, rank: ranks[i] }) }
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined))
  await mkdir(join(dir, 'todos/items'), { recursive: true })
  await writeFile(join(dir, 'todos/items', `${todo.id}.md`), patch('', clean))
}
for (const note of notes) {
  const fields = { id: note.id, created: writeLocal(shift(note.date), note.time), source: note.source, state: note.state }
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

console.log(`Wrote ${todos.length} todos, ${goals.length} goals and ${notes.length} notes to ${dir}`)
