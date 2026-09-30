// What the user does in the GUI ends up in the workspace's files, and what
// changes in the files shows up in the GUI (docs/design/backend.md).

import { rmSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { drag, expect, open, test } from './jezo'
import { writeSortSession } from './sessions'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

test('notes go to files and come back from them', async ({ jezo }) => {
  const { page, root, items, read } = jezo
  await open(page, '隨手記')
  const texts = page.locator('main li p')
  await expect(texts).toHaveCount(5)

  // Jotting one down writes a file with exactly what was typed.
  const box = page.locator('main textarea').first()
  await box.fill('買燈泡')
  await box.press('Enter')
  await expect(texts.filter({ hasText: '買燈泡' })).toHaveCount(1)
  await expect.poll(() => items('notes').find((n) => n.body === '買燈泡\n')?.data).toMatchObject({ source: 'page', state: 'new' })
  const created = items('notes').find((n) => n.body === '買燈泡\n')!

  // Editing it changes the body and nothing else.
  const before = readFileSync(join(root, 'notes/items', created.file), 'utf8')
  await texts.filter({ hasText: '買燈泡' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('兩顆')
  await page.keyboard.press('Enter')
  await expect.poll(() => read(`notes/items/${created.file}`).body).toBe('買燈泡兩顆\n')
  expect(readFileSync(join(root, 'notes/items', created.file), 'utf8')).toBe(before.replace('買燈泡', '買燈泡兩顆'))

  // Deleting removes the file; undo writes it back with the same id.
  const row = page.locator('main li').filter({ hasText: 'Tiny Habits' })
  await row.hover()
  await row.getByRole('button', { name: '刪掉' }).click()
  await expect.poll(() => items('notes').some((n) => n.data.id === 'n-5')).toBe(false)
  await page.getByRole('button', { name: '撤銷' }).click()
  await expect.poll(() => items('notes').find((n) => n.data.id === 'n-5')?.body).toContain('Tiny Habits')
  await expect(texts.filter({ hasText: 'Tiny Habits' })).toHaveCount(1)

  // A change made outside Jezo shows up, and so does a file deleted outside it.
  const n1 = join(root, 'notes/items/n-1.md')
  writeFileSync(n1, readFileSync(n1, 'utf8').replace('記得回房東訊息', '在別的編輯器改的'))
  await expect(texts.filter({ hasText: '在別的編輯器改的' })).toHaveCount(1)
  rmSync(join(root, 'notes/items/n-4.md'))
  await expect(texts.filter({ hasText: 'Ken 生日' })).toHaveCount(0)

  expect(jezo.errors).toEqual([])
})

test('scheduling and reordering on the calendar write the todo files', async ({ jezo }) => {
  const { page, read } = jezo
  await open(page, '行事曆')
  const backlog = page.locator('[data-drop=backlog]')
  const order = () => page.locator('[data-backlog-id]').evaluateAll((els) => els.map((el) => el.getAttribute('data-backlog-id')))
  await expect(page.locator('[data-backlog-id]')).toHaveCount(4)

  // Show 15:00–19:00, then drag 打給媽 from the backlog to today at about 16:00.
  await page.evaluate(() => {
    const v = document.querySelector('[data-slot=event-calendar] [data-slot=scroll-area-viewport]')!
    v.scrollTop = 15 * (v.scrollHeight / 24)
  })
  const at = (minutes: number) =>
    page.evaluate(
      ([m, weekday]) => {
        const cols = [...document.querySelectorAll<HTMLElement>('[data-ec-day][data-ec-bounds-start]')].sort(
          (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
        )
        const el = cols[weekday]
        const r = el.getBoundingClientRect()
        const s = Number(el.dataset.ecBoundsStart)
        const e = Number(el.dataset.ecBoundsEnd)
        return { x: r.left + r.width / 2, y: r.top + ((m - s) * r.height) / (e - s) }
      },
      [minutes, (new Date().getDay() + 6) % 7],
    )
  const card = (await backlog.getByText('打給媽', { exact: true }).boundingBox())!
  const target = await at(16 * 60)
  await drag(page, { x: card.x + 10, y: card.y + 5 }, { x: target.x - 40, y: target.y + 5 })
  await expect.poll(() => read('todos/items/t-u2.md').data.scheduled).toMatch(new RegExp(`^${today()}T1[56]:`))
  await expect(page.locator('[data-backlog-id]')).toHaveCount(3)

  // Drag the draft 和 Anna 的 1:1 off the grid, between the first and second backlog cards.
  await page.evaluate(() => {
    const v = document.querySelector('[data-slot=event-calendar] [data-slot=scroll-area-viewport]')!
    v.scrollTop = 10 * (v.scrollHeight / 24) - 20
  })
  const block = (await page.locator('[data-slot=event-calendar-event]', { hasText: '和 Anna' }).first().boundingBox())!
  const first = (await page.locator('[data-backlog-id]').nth(0).boundingBox())!
  const second = (await page.locator('[data-backlog-id]').nth(1).boundingBox())!
  const [firstId, secondId] = await order()
  await drag(page, { x: block.x + block.width / 2, y: block.y + block.height / 2 }, { x: first.x + first.width / 2, y: (first.y + first.height + second.y) / 2 })

  // It's in the backlog now, between them, and moving it settled the draft.
  await expect.poll(order).toEqual([firstId, 't-3', secondId, expect.any(String)])
  const anna = read('todos/items/t-3.md').data
  expect(anna.scheduled).toBeUndefined()
  expect(anna.state).toBe('open')
  const rank = (id: string) => read(`todos/items/${id}.md`).data.rank as string
  expect(rank(firstId!) < rank('t-3') && rank('t-3') < rank(secondId!)).toBe(true)

  expect(jezo.errors).toEqual([])
})

test.describe('deciding on a proposal', () => {
  test.use({
    prepare: {
      workspace: (root) =>
        writeSortSession(root, [
          { note: 'n-1', as: 'todo', title: '回房東訊息，問冷氣什麼時候修' },
          { note: 'n-2', as: 'goal', title: '學吉他' },
          { note: 'n-4', as: 'ask', title: '「Ken 生日」是要做的事，還是記著就好？' },
        ]),
    },
  })

  test('writes the decision on the note and creates or deletes the todo', async ({ jezo }) => {
    const { page, items, read } = jezo
    await open(page, '隨手記')
    await expect(page.getByRole('button', { name: '好', exact: true })).toHaveCount(2)

    // Accepting the todo creates it, and the note says what it became.
    const landlord = page.locator('li').filter({ hasText: '回房東訊息' }).filter({ has: page.getByRole('button', { name: '好' }) }).first()
    await landlord.getByRole('button', { name: '好' }).click()
    await expect.poll(() => read('notes/items/n-1.md').data.became).toMatchObject({ kind: 'todo' })
    const todoId = (read('notes/items/n-1.md').data.became as { ref: string }).ref
    expect(read(`todos/items/${todoId}.md`).data).toMatchObject({ title: '回房東訊息，問冷氣什麼時候修', state: 'open' })

    // Taking it back deletes the todo and the proposal waits again.
    await page.locator('li').filter({ hasText: '回房東訊息' }).getByRole('button', { name: '撤銷' }).first().click()
    await expect.poll(() => items('todos').some((t) => t.data.id === todoId)).toBe(false)
    expect(read('notes/items/n-1.md').data).toMatchObject({ state: 'sorting', proposal: { as: 'todo' } })
    expect(read('notes/items/n-1.md').data.became).toBeUndefined()

    // Turning one down puts the note back in the list.
    await page.locator('li').filter({ hasText: '學吉他' }).getByRole('button', { name: '不要' }).first().click()
    await expect.poll(() => read('notes/items/n-2.md').data).toMatchObject({ state: 'new', proposal: { decision: 'rejected' } })

    // Answering the question keeps it, so undoing asks it again.
    const ken = page.locator('li').filter({ hasText: 'Ken 生日' }).first()
    await ken.getByRole('button', { name: '先留著' }).click()
    await expect.poll(() => read('notes/items/n-4.md').data).toMatchObject({ state: 'sorted', became: { kind: 'keep' }, proposal: { as: 'keep', decision: 'accepted' } })
    expect((read('notes/items/n-4.md').data.proposal as { question: string }).question).toContain('Ken 生日')
    await page.locator('li').filter({ hasText: 'Ken 生日' }).getByRole('button', { name: '撤銷' }).first().click()
    await expect.poll(() => read('notes/items/n-4.md').data.proposal).toMatchObject({ as: 'ask' })

    // The same card is in the conversation, and shows the decisions made on the page.
    await page.getByRole('button', { name: '在對話裡看' }).click()
    await expect(page.locator('main').getByText('看完了，你看一下卡片。')).toBeVisible()
    await expect(page.locator('main li').filter({ hasText: '學吉他' })).toContainText('放回隨手記了')

    expect(jezo.errors).toEqual([])
  })
})

test('skills come from the workspace, and turning one off writes it to its file', async ({ jezo }) => {
  const { page, read } = jezo
  await open(page, '更多')
  await page.getByText('它用的方法').click()
  const toggle = page.getByRole('switch', { name: '用紀錄估時間' })
  await expect(page.locator('main').getByText('整理隨手記')).toBeVisible()

  await toggle.click()
  await expect.poll(() => read('skills/estimate-from-records/SKILL.md').data['disable-model-invocation']).toBe(true)
  await toggle.click()
  await expect.poll(() => read('skills/estimate-from-records/SKILL.md').data['disable-model-invocation']).toBeUndefined()

  // The skill opens to what it tells the agent.
  await page.locator('main').getByText('用紀錄估時間').click()
  await expect(page.locator('main')).toContainText('人估時間通常偏樂觀')
  await expect(page.locator('main')).toContainText('skills/estimate-from-records/SKILL.md')

  expect(jezo.errors).toEqual([])
})
