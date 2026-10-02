// 待辦, the list of every todo (docs/design/frontend.md, "The todo list"):
// what was planned earlier and isn't done, today, the backlog, later, and what's
// done or dropped, with what the user does to them written to the files and kept
// in 修改紀錄 where the design says so.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { stringify } from 'yaml'
import { drag, expect, open, test } from './jezo'

const ZONE = 'Asia/Taipei'
const day = (days: number) => Temporal.Now.plainDateISO(ZONE).add({ days }).toString()
const today = day(0)

function write(root: string, id: string, data: object, body = '') {
  mkdirSync(join(root, 'todos/items'), { recursive: true })
  writeFileSync(join(root, 'todos/items', `${id}.md`), `---\n${stringify({ id, ...data })}---\n${body}`)
}

test.use({
  prepare: {
    model: null,
    workspace: (root) => {
      // Back after a while: three things planned on days that have passed, never done.
      write(root, 't-old1', { title: '回房東的信', state: 'open', estimate: 15, goal: 'g-4', scheduled: `${day(-5)}T09:00[${ZONE}]` }, '冷氣的事，順便問押金。\n')
      write(root, 't-old2', { title: '繳電話費', state: 'open', estimate: 10, scheduled: `${day(-3)}T20:00[${ZONE}]` })
      write(root, 't-old3', { title: '整理書桌', state: 'open', estimate: 20, scheduled: `${day(-1)}T18:00[${ZONE}]` })
      // Further out than the coming week.
      write(root, 't-far', { title: '訂年底的機票', state: 'open', estimate: 30, scheduled: `${day(12)}T10:00[${ZONE}]` })
    },
  },
})

async function artifact(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

/** The newest toast's 撤銷. */
const undoToast = (page: Page) => page.locator('[data-sonner-toast]').first().getByRole('button', { name: '撤銷' })

test('the list groups every todo by time, and what was planned earlier is folded, quiet, and easy to deal with', async ({ jezo }, info) => {
  const { page, read } = jezo
  await open(page, '待辦')
  const list = page.locator('main')
  const row = (id: string) => list.locator(`[data-todo-row="${id}"]`)

  // Today's todos are there, and so is the backlog; what wasn't done in time is one folded line.
  await expect(list.locator('[data-group="today"]')).toContainText('寫升等 doc 的「Impact」那段')
  await expect(list.locator('[data-group="backlog"]')).toContainText('打給媽')
  const past = list.getByRole('button', { name: '之前排的，還沒做 · 3' })
  await expect(past).toBeVisible()
  await expect(row('t-old1')).toHaveCount(0)
  // Nothing is drawn in red or called late.
  await expect(list).not.toContainText(/逾期|過期|遲了/)
  await expect(list.getByRole('button', { name: /更之後 · 1/ })).toBeVisible()
  await artifact(page, info, 'list')

  // One of them, today at the same clock time: the file says so, and it moves to 今天.
  await past.click()
  await row('t-old3').getByRole('button', { name: '排到今天' }).click()
  await expect.poll(() => read('todos/items/t-old3.md').data.scheduled).toBe(`${today}T18:00[${ZONE}]`)
  await expect(list.locator('[data-group="today"]')).toContainText('整理書桌')
  await expect(list.getByRole('button', { name: '之前排的，還沒做 · 2' })).toBeVisible()

  // The rest at once, back to the backlog: one change in 修改紀錄, and its toast takes it back.
  await list.locator('[data-group="past"]').getByRole('button', { name: '放回待排' }).first().click()
  await expect.poll(() => [read('todos/items/t-old1.md').data.scheduled, read('todos/items/t-old2.md').data.scheduled]).toEqual([undefined, undefined])
  await expect(list.locator('[data-group="backlog"]')).toContainText('回房東的信')
  await expect.poll(async () => (await page.evaluate(() => window.jezo.history.list()))[0]?.summary).toBe('把 2 件放回待排')
  await undoToast(page).click()
  await expect.poll(() => [read('todos/items/t-old1.md').data.scheduled, read('todos/items/t-old2.md').data.scheduled]).toEqual([`${day(-5)}T09:00[${ZONE}]`, `${day(-3)}T20:00[${ZONE}]`])

  // 不做了 keeps the file and its notes, under 不做了, and it comes back with one click.
  await list.getByRole('button', { name: '之前排的，還沒做 · 2' }).click()
  await row('t-old1').getByRole('button', { name: '不做了' }).click()
  await expect.poll(() => read('todos/items/t-old1.md').data.state).toBe('dropped')
  const dropped = read('todos/items/t-old1.md')
  expect(dropped.data.dropped).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+08:00$/)
  expect(dropped.body).toContain('順便問押金')
  await list.getByRole('button', { name: /做完了、不做了/ }).click()
  await expect(row('t-old1')).toContainText('不做了')
  await row('t-old1').getByRole('button', { name: '還是要做' }).click()
  await expect.poll(() => read('todos/items/t-old1.md').data).toMatchObject({ state: 'open' })
  expect(read('todos/items/t-old1.md').data.dropped).toBeUndefined()

  // Finding: a search reaches into the folded groups.
  await list.getByRole('textbox', { name: '找待辦' }).fill('機票')
  await expect(row('t-far')).toBeVisible()
  await expect(list.locator('[data-todo-row]')).toHaveCount(1)
  await list.getByRole('textbox', { name: '找待辦' }).fill('')
  // And a goal narrows it to that goal's todos.
  await list.getByRole('button', { name: '家人', exact: true }).click()
  await expect(row('t-old2')).toHaveCount(0)
  for (const id of await list.locator('[data-todo-row]:visible').evaluateAll((els) => els.map((el) => el.getAttribute('data-todo-row')!))) {
    expect(read(`todos/items/${id}.md`).data.goal).toBe('g-4')
  }
  await list.getByRole('button', { name: '家人', exact: true }).click()

  // Adding: it's a todo without a time, in 沒排時間.
  await list.getByRole('textbox', { name: '加一件待辦，按 Enter' }).fill('買貓砂')
  await list.getByRole('textbox', { name: '加一件待辦，按 Enter' }).press('Enter')
  await expect(list.locator('[data-group="backlog"]')).toContainText('買貓砂')
  const added = () => jezo.items('todos').find((t) => t.data.title === '買貓砂')
  await expect.poll(() => added()?.data.scheduled ?? 'none').toBe('none')
  const id = String(added()!.data.id)

  // Its goal is changed in its details.
  await row(id).getByRole('button', { name: /買貓砂/ }).click()
  const details = page.locator('aside')
  await details.getByRole('button', { name: /^目標/ }).click()
  await page.getByRole('button', { name: '家人', exact: true }).last().click()
  await expect.poll(() => read(`todos/items/${id}.md`).data.goal).toBe('g-4')

  // Deleting removes the file as a change in 修改紀錄; the toast brings it back.
  await details.getByRole('button', { name: '刪除' }).click()
  await expect.poll(() => jezo.items('todos').some((t) => t.data.id === id)).toBe(false)
  await undoToast(page).click()
  await expect.poll(() => jezo.items('todos').find((t) => t.data.id === id)?.data.goal).toBe('g-4')
  await expect(list.locator('[data-group="backlog"]')).toContainText('買貓砂')

  // Dragging reorders 沒排時間, and the order is the files' ranks.
  const backlogRows = list.locator('[data-group="backlog"] [data-list-backlog-id]')
  const order = () => backlogRows.evaluateAll((els) => els.map((el) => el.getAttribute('data-list-backlog-id')!))
  const [first, second] = await order()
  const from = (await backlogRows.nth(1).boundingBox())!
  const to = (await backlogRows.nth(0).boundingBox())!
  await drag(page, { x: from.x + 60, y: from.y + from.height / 2 }, { x: to.x + 60, y: to.y + 4 })
  await expect.poll(async () => (await order()).slice(0, 2)).toEqual([second, first])
  const rank = (id: string) => String(read(`todos/items/${id}.md`).data.rank)
  await expect.poll(() => rank(second) < rank(first)).toBe(true)

  await artifact(page, info, 'list-after')
  expect(jezo.errors).toEqual([])
})
