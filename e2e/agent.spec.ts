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
  // Due a minute ago, so it starts as soon as Jezo opens.
  test.use({
    prepare: {
      data: (dir) => {
        const d = new Date(Date.now() - 60_000)
        const at = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
        writeFileSync(join(dir, 'config.json'), JSON.stringify({ schedule: { morning: at, evening: null } }))
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
    expect(sessions.filter((f) => readFileSync(join(jezo.root, 'sessions', f), 'utf8').includes('"trigger":"morning"'))).toHaveLength(1)
    expect(jezo.errors).toEqual([])
  })
})
