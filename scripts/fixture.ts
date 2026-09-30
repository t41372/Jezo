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
console.log(`Wrote ${todos.length} todos and ${notes.length} notes to ${dir}`)
