// Jezo's agent, with a real model. These need a local model server (LM Studio
// or Ollama) with a model loaded; without one they're skipped, and say why.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, open, test } from './jezo'

const localModel = async () => {
  for (const url of ['http://localhost:1234/v1/models', 'http://localhost:11434/v1/models']) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return true
    } catch {
      // Not running.
    }
  }
  return false
}

test.beforeEach(async () => {
  test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.')
})
test.setTimeout(300_000)

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Waits until the agent has finished in the open conversation. */
async function settled(page: import('@playwright/test').Page) {
  await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })
}

test('the agent does what the user asks, and undo takes it back', async ({ jezo }) => {
  const { page, read } = jezo
  const box = page.locator('main textarea').first()
  await box.fill('把「打給媽」排到明天晚上 20:00')
  await box.press('Enter')
  await settled(page)

  // The time the user named is theirs, not a proposal.
  expect(read('todos/items/t-u2.md').data).toMatchObject({ scheduled: `${tomorrow()}T20:00` })
  expect(read('todos/items/t-u2.md').data.proposed).toBeUndefined()
  await expect(page.locator('main')).toContainText('打給媽')

  // The change is in the history, and undoing it puts the todo back in the backlog.
  await open(page, '更多')
  await page.getByText('修改紀錄').click()
  await page.getByRole('button', { name: '撤銷' }).first().click()
  await expect.poll(() => read('todos/items/t-u2.md').data.scheduled).toBeUndefined()

  expect(jezo.errors).toEqual([])
})

test('the agent sorts notes; undo leaves the ones the user already decided', async ({ jezo }) => {
  const { page, read, items } = jezo
  await open(page, '隨手記')
  await page.getByRole('button', { name: /交給 agent 整理/ }).click()

  // Every note gets a proposal from this session, and the card shows on the page.
  await expect.poll(() => items('notes').every((n) => n.data.state === 'sorting'), { timeout: 240_000 }).toBe(true)
  await expect(page.getByRole('button', { name: '好', exact: true }).first()).toBeVisible()
  const session = (read('notes/items/n-1.md').data.proposal as { session: string }).session
  expect(items('notes').every((n) => (n.data.proposal as { session: string }).session === session)).toBe(true)

  // The user accepts the first row the agent didn't ask about.
  await page.getByRole('button', { name: '好', exact: true }).first().click()
  await expect.poll(() => items('notes').filter((n) => n.data.state === 'sorted').length).toBe(1)
  const decided = items('notes').find((n) => n.data.state === 'sorted')!

  // Undoing the agent's run clears its proposals, but not the note the user decided on.
  await open(page, '更多')
  await page.getByText('修改紀錄').click()
  await page.getByRole('button', { name: '撤銷' }).first().click()
  await expect.poll(() => items('notes').filter((n) => n.data.state === 'new').length).toBe(4)
  expect(read(`notes/items/${decided.file}`).data.state).toBe('sorted')
  await expect(page.getByText(/有 1 個檔案你後來改過/)).toBeVisible()

  expect(jezo.errors).toEqual([])
})

test('a server added by hand is tested, and its model can be picked for the agent', async ({ jezo }) => {
  const { page } = jezo
  const config = () => JSON.parse(readFileSync(join(jezo.root, '../data/config.json'), 'utf8'))
  await open(page, '設定')
  // Until the user picks, Jezo uses a model that works and says so.
  await expect(page.getByText('還沒選，先用這個能用的')).toBeVisible()
  await page.getByRole('button', { name: /模型服務商/ }).click()

  await page.getByRole('button', { name: '新增服務商' }).click()
  await page.getByLabel('名稱').or(page.locator('[role=dialog] input').first()).first().fill('My server')
  await page.locator('[role=dialog] input').nth(1).fill('http://localhost:1234/v1')
  await page.getByRole('button', { name: '新增', exact: true }).click()
  await expect(page.locator('main h2')).toHaveText('My server')
  await expect(page.locator('main header').getByText('可用', { exact: true })).toBeVisible()
  expect(config().models.custom).toEqual([{ id: 'custom-my-server', name: 'My server', baseUrl: 'http://localhost:1234/v1' }])

  await page.getByRole('button', { name: '測試' }).click()
  await expect(page.getByText(/可以用 · [\d.]+ 秒/)).toBeVisible({ timeout: 120_000 })

  // Pick one of its models for the agent.
  await page.getByRole('button', { name: '設定' }).first().click()
  await page.locator('main').getByRole('button', { name: /· LM Studio/ }).click()
  await page.getByRole('option').filter({ hasText: /./ }).and(page.locator('[data-value^="My server"]')).first().click()
  await expect(page.getByText('你選的')).toBeVisible()
  expect(config().models.main.provider).toBe('custom-my-server')

  expect(jezo.errors).toEqual([])
})

test.describe('the morning plan', () => {
  test.describe.configure({ timeout: 600_000 })
  // The morning automation, due a minute ago, so it starts as soon as Jezo opens.
  test.use({
    prepare: {
      workspace: (root) => {
        const d = new Date(Date.now() - 60_000)
        const path = join(root, 'automations/items/a-morning.md')
        const text = readFileSync(path, 'utf8')
        writeFileSync(path, text.replace(/^schedule: .*$/m, `schedule: ${d.getMinutes()} ${d.getHours()} * * *`).replace(/^state: off$/m, 'state: on'))
      },
    },
  })

  test('starts on its own, and only proposes', async ({ jezo }) => {
    const { page, items } = jezo
    const before = new Map(items('todos').map((t) => [t.data.id, t.data.state]))
    await expect(page.getByText('早上排程').first()).toBeVisible({ timeout: 60_000 })
    await page.getByText('早上排程').first().click()
    await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 540_000 })

    // It said something or asked something, and it didn't settle anything for the user: nothing it touched became open or done.
    await expect(page.locator('main [data-selectable], main .rounded-full').first()).toBeVisible()
    for (const todo of items('todos')) {
      const was = before.get(todo.data.id)
      if (was === undefined) expect(todo.data.state).toBe('draft')
      else if (was !== todo.data.state) expect(todo.data.state).toBe('draft')
    }
    // It ran once; opening the app again today doesn't plan the day twice.
    const sessions = readdirSync(join(jezo.root, 'sessions'))
    expect(sessions.filter((f) => readFileSync(join(jezo.root, 'sessions', f), 'utf8').includes('"id":"a-morning"'))).toHaveLength(1)
    expect(jezo.errors).toEqual([])
  })
})

test('the agent remembers what the user says, replaces it when it changes, and a deleted memory stays gone', async ({ jezo }) => {
  const { page, items } = jezo
  const guitar = () => items('memory').filter((m) => m.body.includes('吉他'))
  const say = async (text: string) => {
    const box = page.locator('main textarea').first()
    await box.fill(text)
    await box.press('Enter')
    await settled(page)
  }
  await say('記住：我每週三晚上 7 點上吉他課。')
  await expect.poll(() => guitar().map((m) => m.data)).toEqual([expect.objectContaining({ epistemic: 'stated', source: 'user', status: 'active' })])
  expect((guitar()[0].data.evidence as string[])[0]).toMatch(/^sessions\//)

  await say('吉他課改到週四晚上 8 點了。')
  await expect.poll(() => guitar().filter((m) => m.data.status === 'active').length).toBe(1)
  const current = guitar().find((m) => m.data.status === 'active')!
  expect(current.body).toContain('週四')
  expect(guitar().find((m) => m.data.status === 'superseded')?.data.superseded_by).toBe(current.data.id)

  // Deleted in the GUI: a new conversation doesn't know it, and can't read it back from the old one.
  await open(page, '更多')
  await page.getByText('它記住的事').click()
  await page.locator('main').getByText(current.body.trim()).locator('xpath=ancestor::div[.//button][1]').getByRole('button', { name: '刪掉' }).click()
  await expect.poll(() => guitar().some((m) => m.data.status === 'active')).toBe(false)
  await open(page, '聊天')
  await page.getByRole('button', { name: /新對話/ }).click()
  await say('我週四晚上有什麼固定的事？')
  await expect(page.locator('main [data-selectable]').last()).not.toContainText('吉他')
  expect(jezo.errors).toEqual([])
})

test('the agent plans around the calendar, reading days it wasn’t shown', async ({ jezo }) => {
  const { page, items } = jezo
  // Next Wednesday, which the start of the run doesn't show, has volleyball 19:00–21:00.
  const wednesday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 9)
    return d
  })()
  const date = `${wednesday.getFullYear()}-${String(wednesday.getMonth() + 1).padStart(2, '0')}-${String(wednesday.getDate()).padStart(2, '0')}`
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//e2e//EN', 'X-WR-CALNAME:Personal',
    'BEGIN:VEVENT', 'UID:volleyball', 'SUMMARY:排球', `DTSTART:${date.replaceAll('-', '')}T190000`, `DTEND:${date.replaceAll('-', '')}T210000`, 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')
  const { createServer } = await import('node:http')
  const server = createServer((_, res) => res.writeHead(200, { 'content-type': 'text/calendar' }).end(ics))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as import('node:net').AddressInfo).port
  try {
    await page.evaluate((url) => window.jezo.calendar.subscribe(url), `http://127.0.0.1:${port}/personal.ics`)

    const box = page.locator('main textarea').first()
    await box.fill('下週三晚上幫我排 45 分鐘訂 12 月比賽的住宿，要避開我行事曆上的事。')
    await box.press('Enter')
    await settled(page)

    const todo = items('todos').find((t) => String(t.data.title).includes('住宿'))!
    const scheduled = String(todo.data.scheduled)
    expect(scheduled.slice(0, 10)).toBe(date)
    // 45 minutes that don't touch 19:00–21:00, in the evening.
    const [h, m] = scheduled.slice(11).split(':').map(Number)
    const start = h * 60 + m
    expect(start >= 17 * 60).toBe(true)
    expect(start + 45 <= 19 * 60 || start >= 21 * 60).toBe(true)
  } finally {
    server.close()
  }
  expect(jezo.errors).toEqual([])
})
