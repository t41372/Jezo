// Times keep their meaning when the device moves to another zone
// (docs/design/time.md). The zone is moved the way the OS moves it: the link
// the app reads the zone from is pointed somewhere else while the app runs.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { expect, open, test } from './jezo'

const zoneLink = join(mkdtempSync(join(tmpdir(), 'jezo-zone-')), 'localtime')
const moveTo = (zone: string) => {
  rmSync(zoneLink, { force: true })
  symlinkSync(`/usr/share/zoneinfo/${zone}`, zoneLink)
}
let before: string | undefined

test.beforeEach(() => moveTo('America/Phoenix'))
test.beforeAll(() => {
  before = process.env.JEZO_LOCALTIME
  process.env.JEZO_LOCALTIME = zoneLink
})
test.afterAll(() => {
  process.env.JEZO_LOCALTIME = before
})

// The day in Phoenix when the test starts. A New York 09:00 falls on it in Phoenix (06:00) and in Tokyo (22:00).
const today = Temporal.Now.plainDateISO('America/Phoenix').toString()

function write(root: string, path: string, data: object, body = '') {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`)
}

test.use({
  prepare: {
    model: null,
    workspace: (root) => {
      write(root, 'todos/items/t-call.md', { id: 't-call', title: '跟紐約的同事通話', state: 'open', estimate: 30, scheduled: `${today}T09:00[America/New_York]` })
      // Planned in Phoenix: fixed to Phoenix, like every time Jezo writes.
      write(root, 'todos/items/t-walk.md', { id: 't-walk', title: '早上散步', state: 'open', estimate: 30, scheduled: `${today}T07:00[America/Phoenix]` })
    },
  },
})

test('every time keeps its zone and shows right wherever the device is, and records carry their offset', async ({ jezo }) => {
  const { page, app, root, read } = jezo
  const drawerTime = page.locator('aside [data-slot-field]')
  const openTodo = async (title: string) => {
    await page.locator('[data-slot=event-calendar-event]').filter({ hasText: title }).first().click()
    await expect(page.locator('aside')).toContainText(title)
  }
  await open(page, '行事曆')

  // In Phoenix, New York's 09:00 is 06:00, and the walk is at 07:00.
  await openTodo('跟紐約的同事通話')
  await expect(drawerTime).toContainText('06:00')
  await page.keyboard.press('Escape')
  await openTodo('早上散步')
  await expect(drawerTime).toContainText('07:00')
  await page.keyboard.press('Escape')

  // The device lands in Tokyo while Jezo runs. Coming back to the window looks at the zone again.
  moveTo('Asia/Tokyo')
  await app.evaluate(({ app }) => app.emit('browser-window-focus'))
  await expect.poll(() => app.evaluate(() => process.env.TZ)).toBe('Asia/Tokyo')
  await expect(page.getByText('現在用Tokyo時間了')).toBeVisible()

  // Both show at the right moment in Tokyo's hours: 09:00 New York is 22:00, 07:00 Phoenix is 23:00.
  await openTodo('跟紐約的同事通話')
  await expect(drawerTime).toContainText('22:00')
  await page.keyboard.press('Escape')
  await openTodo('早上散步')
  await expect(drawerTime).toContainText('23:00')
  await expect(page.locator('aside [data-zone-field]')).toContainText('Phoenix時間 07:00')
  await page.keyboard.press('Escape')

  // Nothing was rewritten by the move.
  expect(read('todos/items/t-call.md').data.scheduled).toBe(`${today}T09:00[America/New_York]`)
  expect(read('todos/items/t-walk.md').data.scheduled).toBe(`${today}T07:00[America/Phoenix]`)

  // Moved to 23:00 from Tokyo, the call stays a New York time: 10:00 there.
  await openTodo('跟紐約的同事通話')
  await drawerTime.click()
  await page.getByLabel('時間').fill('23:00')
  await expect.poll(() => read('todos/items/t-call.md').data.scheduled).toBe(`${today}T10:00[America/New_York]`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // The walk is better at 07:00 here: fixing it to Tokyo keeps the clock, and says what it becomes first.
  await openTodo('早上散步')
  await page.locator('aside [data-zone-field]').click()
  await page.locator('[data-zone-picker] button').filter({ hasText: '這台裝置的時區' }).click()
  await expect(page.locator('[data-zone-result]')).toContainText('07:00')
  expect(read('todos/items/t-walk.md').data.scheduled).toBe(`${today}T07:00[America/Phoenix]`)
  await page.locator('[data-zone-result]').getByRole('button', { name: '確定' }).click()
  await expect.poll(() => read('todos/items/t-walk.md').data.scheduled).toBe(`${today}T07:00[Asia/Tokyo]`)
  await page.keyboard.press('Escape')

  // A new time is fixed to where the device is.
  const tokyoToday = Temporal.Now.plainDateISO('Asia/Tokyo').toString()
  await page.locator('[data-backlog-id="t-u2"]').click()
  await page.locator('aside [data-slot-field]').click()
  await page.getByLabel('時間').fill('08:15')
  await expect.poll(() => read('todos/items/t-u2.md').data.scheduled).toBe(`${tokyoToday}T08:15[Asia/Tokyo]`)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // Done in Tokyo: the record has Tokyo's offset, to the second.
  await openTodo('早上散步')
  await page.locator('aside').getByRole('button', { name: '做完了' }).first().click()
  await expect.poll(() => read('todos/items/t-walk.md').data.completed).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/)
  await page.keyboard.press('Escape')

  // A time written by hand without a zone is a problem, in words that say what to write.
  writeFileSync(join(root, 'todos/items/t-call.md'), readFileSync(join(root, 'todos/items/t-call.md'), 'utf8').replace(/scheduled: .*/, "scheduled: '2026-10-05T09:00'"))
  await open(page, '更多')
  await page.locator('main').getByText('有問題的檔案').click()
  const problem = page.locator('[data-problem="todos/items/t-call.md"]')
  await problem.getByText('1 個問題').click()
  await expect(problem).toContainText('it has no zone')
  await expect(problem).toContainText('[Asia/Taipei]')
  expect(jezo.errors).toEqual([])
})

test.describe('a time keeps what it means', () => {
  test.use({
    prepare: {
      model: null,
      workspace: (root) => {
        // Written by hand, to the second: accepting it must not round it.
        write(root, 'todos/items/t-meet.md', { id: 't-meet', title: '跟紐約開會', state: 'open', estimate: 30, proposed: true, scheduled: `${today}T09:00:45[America/New_York]` })
        write(root, 'todos/items/t-read.md', { id: 't-read', title: '讀合約', state: 'open', estimate: 30, proposed: true, scheduled: `${today}T10:00[America/New_York]` })
      },
    },
  })

  test('accepting a proposed time leaves it as written, and undo after a zone change puts back what the file said', async ({ jezo }) => {
    const { page, app, read } = jezo
    const openTodo = async (title: string) => {
      await page.locator('[data-slot=event-calendar-event]').filter({ hasText: title }).first().click()
      await expect(page.locator('aside')).toContainText(title)
    }
    await open(page, '行事曆')

    await openTodo('跟紐約開會')
    await page.locator('aside').getByRole('button', { name: '就這個時間' }).click()
    await expect.poll(() => read('todos/items/t-meet.md').data.proposed).toBeUndefined()
    expect(read('todos/items/t-meet.md').data.scheduled).toBe(`${today}T09:00:45[America/New_York]`)
    await page.keyboard.press('Escape')

    // Turned down in Phoenix; the device lands in Tokyo; then undo.
    await openTodo('讀合約')
    await page.locator('aside').getByRole('button', { name: '不要' }).click()
    await expect.poll(() => read('todos/items/t-read.md').data.scheduled).toBeUndefined()
    moveTo('Asia/Tokyo')
    await app.evaluate(({ app }) => app.emit('browser-window-focus'))
    await expect.poll(() => app.evaluate(() => process.env.TZ)).toBe('Asia/Tokyo')
    await page.getByRole('button', { name: '撤銷' }).click()
    await expect.poll(() => read('todos/items/t-read.md').data.scheduled).toBe(`${today}T10:00[America/New_York]`)
    expect(read('todos/items/t-read.md').data.proposed).toBe(true)
    expect(jezo.errors).toEqual([])
  })
})

test.describe('planning in another zone', () => {
  test.use({
    prepare: {
      model: null,
      workspace: (root) => {
        write(root, 'todos/items/t-call.md', { id: 't-call', title: '跟紐約的同事通話', state: 'open', estimate: 30, scheduled: `${today}T09:00[America/New_York]` })
      },
    },
  })

  test('with the calendar showing Tokyo, found by its name in the app’s language, the picker reads clocks in Tokyo', async ({ jezo }) => {
    const { page, read } = jezo
    await open(page, '行事曆')
    await page.locator('[data-calendar-zone]').click()
    await page.locator('[data-zone-picker] input').fill('日本')
    await page.locator('[data-zone-picker] button').filter({ hasText: 'Tokyo' }).first().click()
    await expect(page.locator('[data-calendar-zone]')).toHaveAttribute('data-calendar-zone', 'Asia/Tokyo')

    // 09:00 New York is 22:00 in Tokyo; the picker says which zone it reads.
    await page.locator('[data-slot=event-calendar-event]').filter({ hasText: '跟紐約的同事通話' }).first().click()
    const drawerTime = page.locator('aside [data-slot-field]')
    await expect(drawerTime).toContainText('22:00')
    await drawerTime.click()
    await expect(page.getByText('以Tokyo時間填寫')).toBeVisible()
    // 23:00 Tokyo is 10:00 New York, and the call stays a New York time.
    await page.getByLabel('時間').fill('23:00')
    await expect.poll(() => read('todos/items/t-call.md').data.scheduled).toBe(`${today}T10:00[America/New_York]`)
    expect(jezo.errors).toEqual([])
  })
})
