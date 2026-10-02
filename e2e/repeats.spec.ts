// Repeating todos (docs/design/frontend.md, "Repeating todos"): a series made
// from a todo's details, its next time written once the last one's day has
// passed whether or not it was done, one time ahead and none for the dates
// missed while away, one counted from when the last was done, a deadline on
// each time, and stopping. The clock is moved the way automations.spec.ts
// moves it, and the files are the record.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { stringify } from 'yaml'
import { expect, localModel, open, test } from './jezo'

const ZONE = 'Asia/Taipei'
const today = Temporal.Now.plainDateISO(ZONE)
const at = (date: Temporal.PlainDate, hour = 12) => date.toZonedDateTime({ timeZone: ZONE, plainTime: { hour } })
const code = (date: Temporal.PlainDate) => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'][date.dayOfWeek - 1]

function write(root: string, dir: string, id: string, data: object, body = '') {
  mkdirSync(join(root, dir, 'items'), { recursive: true })
  writeFileSync(join(root, dir, 'items', `${id}.md`), `---\n${stringify({ id, ...data })}---\n${body}`)
}

async function wakeAt(app: ElectronApplication, when: Temporal.ZonedDateTime) {
  await app.evaluate(({ powerMonitor }, target) => {
    const g = globalThis as unknown as { RealDate?: DateConstructor; Date: DateConstructor }
    const Real = (g.RealDate ??= g.Date)
    const offset = target - Real.now()
    class Moved extends Real {
      constructor(...args: unknown[]) {
        if (args.length) super(...(args as [number]))
        else super(Real.now() + offset)
      }
      static now() {
        return Real.now() + offset
      }
    }
    g.Date = Moved as DateConstructor
    powerMonitor.emit('resume')
  }, when.epochMilliseconds)
}

async function artifact(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

test.use({
  prepare: {
    model: null,
    workspace: (root) => {
      write(root, 'todos', 't-trash', { title: '倒垃圾', state: 'open', estimate: 10, scheduled: `${today}T20:00[${ZONE}]` }, '分類：紙類、塑膠。\n')
      write(root, 'todos', 't-plants', { title: '澆花', state: 'open', estimate: 5, scheduled: `${today}T08:00[${ZONE}]` })
      // A monthly bill set up as a file: due on its day, each month.
      write(root, 'repeats', 'r-rent', { title: '繳房租', state: 'on', rule: `FREQ=MONTHLY;BYMONTHDAY=${today.day}`, start: today.toString(), estimate: 10, last: today.toString() })
      write(root, 'todos', 't-rent-now', { title: '繳房租', state: 'open', estimate: 10, due: today.toString(), series: 'r-rent', occurrence: today.toString() })
    },
  },
})

test('a series from the details writes its next time once the last one’s day has passed, one ahead, none for missed dates, and stops', async ({ jezo }, info) => {
  const { app, page, items, read } = jezo
  const series = () => items('repeats')
  const timesOf = (id: string) => items('todos').filter((t) => t.data.series === id).map((t) => String(t.data.occurrence)).sort()

  // Every week on today's weekday, from the details.
  await open(page, '待辦')
  await page.locator('main [data-todo-row="t-trash"]').getByRole('button', { name: /倒垃圾/ }).click()
  const details = page.locator('aside')
  await details.locator('[data-repeat-field]').click()
  await page.locator('[data-slot=popover-content]').getByRole('button').nth(1).click()
  await expect.poll(() => series().find((s) => s.data.title === '倒垃圾')?.data.rule).toBe(`FREQ=WEEKLY;BYDAY=${code(today)}`)
  const trash = series().find((s) => s.data.title === '倒垃圾')!
  const id = String(trash.data.id)
  expect(trash.data).toMatchObject({ state: 'on', start: `${today}T20:00[${ZONE}]`, last: today.toString() })
  expect(trash.body).toContain('分類')
  expect(read('todos/items/t-trash.md').data).toMatchObject({ series: id, occurrence: today.toString() })
  await expect(details.locator('[data-repeat-field]')).toContainText('每週')
  // Today's time is the one ahead: nothing more yet.
  expect(timesOf(id)).toEqual([today.toString()])

  // Tomorrow: today's is past, not done, and next week's is written anyway, at 20:00, with the notes.
  const week = today.add({ days: 7 })
  await wakeAt(app, at(today.add({ days: 1 })))
  await expect.poll(() => timesOf(id)).toEqual([today.toString(), week.toString()])
  const next = read(`todos/items/t-${id.slice(2)}-${week.toString().replaceAll('-', '')}.md`)
  expect(next.data).toMatchObject({ state: 'open', scheduled: `${week}T20:00[${ZONE}]`, title: '倒垃圾' })
  expect(next.body).toContain('分類')
  expect(read('todos/items/t-trash.md').data.state).toBe('open')

  // Away for weeks: the next is the first date from now on, not each date missed.
  const back = today.add({ days: 40 })
  await wakeAt(app, at(back))
  const first = today.add({ days: Math.ceil(40 / 7) * 7 })
  await expect.poll(() => timesOf(id)).toEqual([today.toString(), week.toString(), first.toString()])

  // The monthly bill: each time due on its day, next month's written once this one's day is past.
  const month = today.add({ months: 1 })
  expect(timesOf('r-rent')).toContain(month.toString())
  const rent = items('todos').find((t) => t.data.series === 'r-rent' && t.data.occurrence === month.toString())!
  expect(rent.data.due).toBe(month.toString())

  // 不再重複: the series ends, its times stay, and no more are written.
  await page.locator('main [data-todo-row="t-trash"]').getByRole('button', { name: /倒垃圾/ }).click()
  await details.locator('[data-repeat-field]').click()
  await page.getByRole('button', { name: '不再重複' }).click()
  await expect.poll(() => series().find((s) => s.data.id === id)?.data.state).toBe('ended')
  await wakeAt(app, at(back.add({ days: 14 })))
  await page.waitForTimeout(1500)
  expect(timesOf(id)).toEqual([today.toString(), week.toString(), first.toString()])
  await artifact(page, info, 'repeats')
  expect(jezo.errors).toEqual([])
})

test('a series counted from when it was done writes the next once the last is done', async ({ jezo }) => {
  const { page, items, read } = jezo
  await open(page, '待辦')
  await page.locator('main [data-todo-row="t-plants"]').getByRole('button', { name: /澆花/ }).click()
  await page.locator('aside [data-repeat-field]').click()
  await page.getByLabel('天').fill('3')
  await page.locator('[data-repeat-after-done]').click()
  await expect.poll(() => items('repeats').find((s) => s.data.title === '澆花')?.data).toMatchObject({ rule: 'FREQ=DAILY;INTERVAL=3', from: 'done' })
  const id = String(items('repeats').find((s) => s.data.title === '澆花')!.data.id)
  // Not done: nothing more.
  await page.waitForTimeout(1000)
  expect(items('todos').filter((t) => t.data.series === id)).toHaveLength(1)

  // Done today: the next is three days from today, at the same clock.
  await page.locator('main [data-todo-row="t-plants"]').getByRole('checkbox').click()
  await expect.poll(() => read('todos/items/t-plants.md').data.state).toBe('done')
  const next = today.add({ days: 3 })
  await expect.poll(() => items('todos').filter((t) => t.data.series === id).map((t) => String(t.data.occurrence)).sort()).toEqual([today.toString(), next.toString()])
  expect(items('todos').find((t) => t.data.occurrence === next.toString() && t.data.series === id)!.data.scheduled).toBe(`${next}T08:00[${ZONE}]`)
  expect(readdirSync(join(jezo.root, 'repeats/items'))).toContain(`${id}.md`)

  // Done in the file by hand, as the agent or another editor would, with no time it was done: counted from the day the app sees it.
  const later = next.add({ days: 2 })
  await wakeAt(jezo.app, at(later))
  const path = join(jezo.root, 'todos/items', `t-${id.slice(2)}-${next.toString().replaceAll('-', '')}.md`)
  writeFileSync(path, readFileSync(path, 'utf8').replace(/^state: open$/m, 'state: done'))
  await expect.poll(() => items('todos').filter((t) => t.data.series === id).map((t) => String(t.data.occurrence)).sort()).toEqual([today.toString(), next.toString(), later.add({ days: 3 }).toString()])
  expect(jezo.errors).toEqual([])
})

test.describe('with the agent', () => {
  test.setTimeout(300_000)
  test.use({ prepare: {} })
  test.beforeEach(async () => {
    test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.')
  })

  test('a repeating todo the user asks for is a draft series, which starts once its first time is accepted', async ({ jezo }, info) => {
    const { page, items } = jezo
    const box = page.locator('main textarea').first()
    await box.fill('每週一早上九點提醒我倒垃圾，幫我加一個重複的待辦。')
    await box.press('Enter')
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })
    await artifact(page, info, 'agent-repeat')

    const series = items('repeats').find((s) => /垃圾/.test(String(s.data.title)))
    expect(series?.data).toMatchObject({ state: 'draft' })
    expect(String(series!.data.rule)).toMatch(/FREQ=WEEKLY/)
    expect(String(series!.data.rule)).toMatch(/BYDAY=MO\b/)
    const first = items('todos').find((t) => t.data.series === series!.data.id)!
    expect(first.data.state).toBe('draft')
    expect(Temporal.PlainDate.from(String(first.data.occurrence)).dayOfWeek).toBe(1)

    // Accepting the plan starts the series.
    await page.getByRole('button', { name: '好，就這樣', exact: true }).click()
    await expect.poll(() => items('repeats').find((s) => s.data.id === series!.data.id)?.data.state).toBe('on')
    expect(jezo.errors).toEqual([])
  })
})
