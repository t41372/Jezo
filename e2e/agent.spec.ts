// Jezo's agent, with a real model. These need a local model server (LM Studio
// or Ollama) with a model loaded; without one they're skipped, and say why.

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
