// Deadlines, apart from when a todo is planned (docs/design/frontend.md,
// "Deadlines"): set in the details and written to the file, grouped by in the
// list, shown on 今天, and set by the agent from what the user says.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { stringify } from 'yaml'
import { expect, localModel, open, test } from './jezo'

const ZONE = 'Asia/Taipei'
const day = (days: number) => Temporal.Now.plainDateISO(ZONE).add({ days }).toString()
const today = day(0)

function write(root: string, id: string, data: object) {
  mkdirSync(join(root, 'todos/items'), { recursive: true })
  writeFileSync(join(root, 'todos/items', `${id}.md`), `---\n${stringify({ id, ...data })}---\n`)
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
