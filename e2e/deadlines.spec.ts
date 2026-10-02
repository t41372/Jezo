// Deadlines, apart from when a todo is planned (docs/design/frontend.md,
// "Deadlines"): set in the details and written to the file, grouped by in the
// list, shown on 今天, and set by the agent from what the user says.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page, TestInfo } from '@playwright/test'
import { stringify } from 'yaml'
import { drag, expect, localModel, open, test } from './jezo'

const ZONE = 'Asia/Taipei'
const day = (days: number) => Temporal.Now.plainDateISO(ZONE).add({ days }).toString()
const today = day(0)

function write(root: string, id: string, data: object) {
  mkdirSync(join(root, 'todos/items'), { recursive: true })
  writeFileSync(join(root, 'todos/items', `${id}.md`), `---\n${stringify({ id, ...data })}---\n`)
}

/** Moves the main process's clock to a moment, then wakes the computer up (as automations.spec.ts does). */
async function wakeAt(app: ElectronApplication, at: Temporal.ZonedDateTime) {
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
  }, at.epochMilliseconds)
}

async function artifact(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

test.describe('in the app', () => {
  test.use({
    prepare: {
      model: null,
      workspace: (root) => {
        // Past its deadline and not done; due today with nothing planned; due Friday-ish, planned after it; due later.
        write(root, 't-late', { title: '交保險理賠單', state: 'open', estimate: 20, due: day(-2) })
        // A day: it's due until today ends, whenever the test runs.
        write(root, 't-today', { title: '繳學費', state: 'open', estimate: 15, due: today })
        write(root, 't-report', { title: '寫季報', state: 'open', estimate: 120, due: day(3), scheduled: `${day(4)}T10:00[${ZONE}]` })
        write(root, 't-later', { title: '換護照', state: 'open', estimate: 60, due: day(20) })
      },
    },
  })

  test('the list groups by deadline, 今天 shows what is due, and the details set and clear it', async ({ jezo }, info) => {
    const { page, read } = jezo
    const row = (id: string) => page.locator(`main [data-todo-row="${id}"]`)

    // 今天: due today and already past, though neither is planned today.
    await open(page, '今天')
    const due = page.locator('main [data-due-today]')
    await expect(due).toContainText('繳學費')
    await expect(due).toContainText('今天截止')
    await expect(due).toContainText('交保險理賠單')
    await expect(due).toContainText('截止日已過')

    // 待辦, by deadline: passed first, then today, the week, later folded, none folded.
    await open(page, '待辦')
    await page.getByRole('button', { name: '依截止日' }).click()
    await expect(page.locator('main [data-group="due-passed"]')).toContainText('交保險理賠單')
    await expect(page.locator('main [data-group="due-today"]')).toContainText('繳學費')
    await expect(page.locator(`main [data-group="due-${day(3)}"]`)).toContainText('寫季報')
    await expect(row('t-later')).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^沒有截止日 · \d+$/ })).toBeVisible()
    await artifact(page, info, 'by-deadline')

    // The details say the plan runs past the deadline; setting a later deadline in the month view writes the day.
    await row('t-report').getByRole('button', { name: /寫季報/ }).click()
    const details = page.locator('aside')
    await expect(details.locator('[data-past-due]')).toBeVisible()
    await details.locator('[data-due-field]').click()
    const target = Temporal.PlainDate.from(day(5))
    await page.locator(`[data-day="${new Date(target.year, target.month - 1, target.day).toLocaleDateString('zh-TW')}"]`).click()
    await expect.poll(() => read('todos/items/t-report.md').data.due).toBe(day(5))
    await expect(details.locator('[data-past-due]')).toHaveCount(0)
    // A time makes it a time in this zone; 不設截止日 takes it off.
    await page.getByLabel('時間（可不填）').fill('15:30')
    await expect.poll(() => read('todos/items/t-report.md').data.due).toBe(`${day(5)}T15:30[${ZONE}]`)
    await page.getByRole('button', { name: '不設截止日' }).click()
    await expect.poll(() => read('todos/items/t-report.md').data.due).toBeUndefined()

    // The choice of grouping is kept.
    await page.reload()
    await open(page, '待辦')
    await expect(page.locator('main [data-group="due-passed"]')).toBeVisible()
    expect(jezo.errors).toEqual([])
  })
})

test.describe('in another zone and on the calendar', () => {
  test.use({
    prepare: {
      model: null,
      workspace: (root) => {
        write(root, 't-fee', { title: '繳學費', state: 'open', estimate: 15, due: today })
        write(root, 't-call', { title: '回東京客戶', state: 'open', estimate: 20, due: day(2) })
      },
    },
  })

  test('a deadline time can be in another zone, and deadlines are flags on the calendar that open their todo', async ({ jezo }) => {
    const { page, read } = jezo
    await open(page, '待辦')
    await page.locator('main [data-todo-row="t-call"]').getByRole('button', { name: /回東京客戶/ }).click()
    const details = page.locator('aside')
    await details.locator('[data-due-field]').click()
    await page.getByLabel('時間（可不填）').fill('10:00')
    await expect.poll(() => read('todos/items/t-call.md').data.due).toBe(`${day(2)}T10:00[${ZONE}]`)
    // The clock stays; it's read in Tokyo now.
    await page.locator('[data-due-zone]').click()
    await page.getByPlaceholder('找城市或時區').fill('東京')
    await page.locator('[data-slot=popover-content]').getByRole('button', { name: /東京/ }).first().click()
    await expect.poll(() => read('todos/items/t-call.md').data.due).toBe(`${day(2)}T10:00[Asia/Tokyo]`)
    await page.keyboard.press('Escape')
    await expect(details.locator('[data-due-field]')).toContainText('東京時間')

    // Today's deadline is a flag in the all-day row; clicking it opens the todo.
    await open(page, '行事曆')
    const flag = page.locator('[data-slot=event-calendar-event]', { hasText: '截止 · 繳學費' })
    await expect(flag).toBeVisible()
    // It can't be dragged: a deadline is moved in the todo's details, not by its flag.
    const box = (await flag.boundingBox())!
    await drag(page, { x: box.x + 20, y: box.y + box.height / 2 }, { x: box.x + 260, y: box.y + box.height / 2 })
    expect(read('todos/items/t-fee.md').data.due).toBe(today)
    await expect(flag).toBeVisible()
    // The grid ignores the click that ends a drag; this one is a click of its own.
    await page.waitForTimeout(400)
    await flag.click()
    await expect(page.locator('aside')).toContainText('繳學費')
    expect(jezo.errors).toEqual([])
  })
})

test.describe('reminders', () => {
  // Deadlines Jezo has known about for a while, so their reminders are due when their time comes.
  const long = Temporal.Now.instant().subtract({ hours: 24 * 30 }).epochMilliseconds
  test.use({
    prepare: {
      model: null,
      workspace: (root) => {
        write(root, 't-rent', { title: '繳房租', state: 'open', estimate: 10, due: day(2) })
        write(root, 't-form', { title: '交申請表', state: 'open', estimate: 20, due: `${day(2)}T08:00[${ZONE}]` })
        write(root, 't-tax', { title: '報稅', state: 'open', estimate: 60, due: day(3) })
        write(root, 't-visa', { title: '簽證文件', state: 'open', estimate: 30, due: day(3) })
        write(root, 't-gift', { title: '買生日禮物', state: 'open', estimate: 30, due: day(5) })
        write(root, 't-done', { title: '已經交了', state: 'done', estimate: 10, due: day(2), completed: `${today}T09:00:00+08:00` })
      },
      data: (dir) => {
        const seen = (due: string) => ({ due, seen: long })
        writeFileSync(join(dir, 'reminders.json'), JSON.stringify({
          't-rent': seen(day(2)), 't-form': seen(`${day(2)}T08:00[${ZONE}]`), 't-tax': seen(day(3)), 't-visa': seen(day(3)), 't-gift': seen(day(5)), 't-done': seen(day(2)),
        }))
      },
    },
  })

  test('come once, the evening before, said from when they come, several in one, and not for what is done', async ({ jezo }) => {
    const { app, data } = jezo
    const said = () => JSON.parse(readFileSync(join(data, 'reminders.json'), 'utf8')) as Record<string, { sent?: number; said?: string }>
    const at = (days: number, hour: number, minute = 0) => Temporal.PlainDate.from(day(days)).toZonedDateTime({ timeZone: ZONE, plainTime: { hour, minute } })

    // Tomorrow at 19:00: the day deadline the day after is reminded (its time was 18:00); the 08:00 one waits for 21:00, not 05:00.
    await wakeAt(app, at(1, 19))
    await expect.poll(() => said()['t-rent']?.said).toBe('明天截止：繳房租')
    expect(said()['t-form']?.sent).toBeUndefined()
    expect(said()['t-done']?.sent).toBeUndefined()
    await wakeAt(app, at(1, 21, 5))
    await expect.poll(() => said()['t-form']?.said).toBe('明天 08:00 截止：交申請表')
    // Once only.
    const sent = said()['t-rent'].sent
    await wakeAt(app, at(1, 21, 30))
    await new Promise((r) => setTimeout(r, 1500))
    expect(said()['t-rent'].sent).toBe(sent)

    // Asleep through two reminder times: one notification names both.
    await wakeAt(app, at(2, 20))
    await expect.poll(() => said()['t-tax']?.said).toBe('2 件快截止了：報稅、簽證文件')
    expect(said()['t-visa']?.said).toBe('2 件快截止了：報稅、簽證文件')

    // Woken on the day itself, it says today.
    await wakeAt(app, at(5, 10))
    await expect.poll(() => said()['t-gift']?.said).toBe('今天截止：買生日禮物')
    expect(jezo.errors).toEqual([])
  })
})

test.describe('with the agent', () => {
  test.setTimeout(300_000)
  test.beforeEach(async () => {
    test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.')
  })

  test('a deadline the user says is written as one, and the work is planned before it', async ({ jezo }, info) => {
    const { page, items } = jezo
    const friday = Temporal.PlainDate.from(today).add({ days: ((5 - Temporal.PlainDate.from(today).dayOfWeek + 7) % 7) || 7 })
    const box = page.locator('main textarea').first()
    await box.fill(`季報 ${friday.month}/${friday.day} 前要交，大概要寫三個小時，幫我排時間寫。`)
    await box.press('Enter')
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })
    await artifact(page, info, 'agent-deadline')

    const report = items('todos').filter((t) => /季報/.test(String(t.data.title)))
    expect(report.length).toBeGreaterThan(0)
    // The deadline is the day the user said, or a time on it.
    expect(report.some((t) => String(t.data.due ?? '').startsWith(friday.toString()))).toBe(true)
    // Revising the plan keeps the deadline, though the model isn't asked to give it again.
    const before = report.filter((t) => String(t.data.due ?? '').startsWith(friday.toString())).map((t) => String(t.data.id))
    await box.fill('改成只排一段就好，時間你決定。')
    await box.press('Enter')
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })
    const after = items('todos').filter((t) => /季報/.test(String(t.data.title)))
    expect(after.length).toBeGreaterThan(0)
    for (const t of after.filter((t) => before.includes(String(t.data.id)))) expect(String(t.data.due ?? '')).toMatch(new RegExp(`^${friday}`))

    // Every block of the work starts before the deadline's day ends.
    const end = friday.add({ days: 1 }).toZonedDateTime({ timeZone: ZONE }).epochMilliseconds
    for (const t of after.filter((t) => typeof t.data.scheduled === 'string')) {
      const at = Temporal.ZonedDateTime.from(String(t.data.scheduled)).epochMilliseconds + Number(t.data.estimate) * 60_000
      expect(at, `${t.data.title} at ${t.data.scheduled}`).toBeLessThanOrEqual(end)
    }
    expect(jezo.errors).toEqual([])
  })
})
