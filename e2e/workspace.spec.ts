// What the user does in the GUI ends up in the workspace's files, and what
// changes in the files shows up in the GUI (docs/design/backend.md).

import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  // An id changed by hand doesn't make it another note: it keeps its id, with a problem saying so, until the id is put back.
  const atN1 = async () => (await page.evaluate(() => window.jezo.workspace.list())).find((i) => i.path === 'notes/items/n-1.md')
  writeFileSync(n1, readFileSync(n1, 'utf8').replace('id: n-1', 'id: n-99'))
  await expect.poll(async () => (await atN1())?.problems?.join('\n') ?? '').toContain('n-99')
  expect((await atN1())?.id).toBe('n-1')
  writeFileSync(n1, readFileSync(n1, 'utf8').replace('id: n-99', 'id: n-1'))
  await expect.poll(async () => (await atN1())?.problems).toBeUndefined()

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
  await page.getByText('已安裝', { exact: true }).click()
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

test("a goal's progress is counted from its todos, and a rule change is decided on its page", async ({ jezo }) => {
  const { page, root, read } = jezo
  await open(page, '目標')
  await page.locator('main button', { hasText: 'Q4 升等 doc' }).click()
  const progress = page.locator('main .text-\\[40px\\]')
  await expect(progress).toHaveText('4')

  // A todo for the goal gets done (here, in another editor): the goal counts it.
  const leadership = readdirSync(join(root, 'todos/items')).find((f) => readFileSync(join(root, 'todos/items', f), 'utf8').includes('Leadership'))!
  const path = join(root, 'todos/items', leadership)
  writeFileSync(path, readFileSync(path, 'utf8').replace('state: open', 'state: done'))
  await expect(progress).toHaveText('5')

  // The agent's proposed rewrite of the failing rule: accepting it rewrites the rule and clears the proposal.
  await expect(page.getByText('週三 19:30 → 寫 doc 60 分')).toBeVisible()
  await page.getByRole('button', { name: '改成這樣' }).click()
  await expect.poll(() => read('goals/items/g-1.md').data.rule_proposal).toBeUndefined()
  expect((read('goals/items/g-1.md').data.rules as { cue: string }[])[1]).toEqual({ cue: '週三 19:30', action: '寫 doc 60 分' })

  expect(jezo.errors).toEqual([])
})

test('automations are files, and the settings rows edit the built-in ones', async ({ jezo }) => {
  const { page, read } = jezo
  await open(page, '設定')
  // The fixture turned them off; turning the morning plan on writes its file.
  const morning = page.getByRole('switch', { name: '早上排程' })
  await morning.click()
  await expect.poll(() => read('automations/items/a-morning.md').data).toMatchObject({ state: 'on', schedule: '0 8 * * *' })
  await morning.click()
  await expect.poll(() => read('automations/items/a-morning.md').data.state).toBe('off')
  // The body, what the agent is asked, is untouched.
  expect(read('automations/items/a-morning.md').body).toContain('跟用戶一起排今天')
  expect(jezo.errors).toEqual([])
})

test.describe('the automations page', () => {
  // Without a model, running one still starts its conversation, which says no model is set up.
  test.use({ prepare: { model: null } })
  test('lists them in words, and switching, the time, the request, running and deleting all go through their files', async ({ jezo }) => {
    const { page, read } = jezo
    const main = page.locator('main')
    await open(page, '更多')
    await page.getByText('自動化', { exact: true }).click()
    const row = (id: string) => main.locator(`[data-automation="${id}"]`)
    await expect(row('a-morning')).toContainText('每天 08:00')
    await expect(row('a-evening')).toContainText('每天 21:30')
    await expect(row('a-weekly')).toContainText('每週日 20:00')

    // The fixture has them off; the switch writes the file.
    await row('a-weekly').getByRole('switch').click()
    await expect.poll(() => read('automations/items/a-weekly.md').data.state).toBe('on')

    // Its page: a new time keeps the days, and the request is the file's body.
    await row('a-morning').getByRole('button').first().click()
    await main.locator('input[type=time]').fill('07:30')
    await expect.poll(() => read('automations/items/a-morning.md').data.schedule).toBe('30 7 * * *')
    await expect(main).toContainText('每天 07:30')
    const request = main.getByRole('textbox', { name: '要 agent 做的事' })
    await expect(request).toHaveValue(/跟用戶一起排今天/)
    await request.fill('一天開始了。只看今天的行事曆，用一句話說今天最重要的事。')
    await main.getByRole('heading', { name: '早上排程' }).click()
    await expect.poll(() => read('automations/items/a-morning.md').body.trim()).toBe('一天開始了。只看今天的行事曆，用一句話說今天最重要的事。')

    // Running it now starts its conversation, and the page links to it.
    await main.getByRole('button', { name: '現在跑一次' }).click()
    await expect(page.getByRole('button', { name: /早上排程/ }).first()).toBeVisible()
    await open(page, '更多')
    await page.getByText('自動化', { exact: true }).click()
    await row('a-morning').getByRole('button').first().click()
    await expect(main).toContainText('上次：今天')

    // Deleting removes the file; undo puts it back as it was.
    const before = read('automations/items/a-morning.md').data
    await main.getByRole('button', { name: '刪掉' }).click()
    await expect(row('a-morning')).toHaveCount(0)
    await page.getByRole('button', { name: '撤銷' }).click()
    await expect(row('a-morning')).toBeVisible()
    await expect.poll(() => read('automations/items/a-morning.md').body.trim()).toBe('一天開始了。只看今天的行事曆，用一句話說今天最重要的事。')
    expect(read('automations/items/a-morning.md').data).toEqual(before)
    expect(jezo.errors).toEqual([])
  })
})

test('a file that breaks its format shows in 更多, can go to the agent, and leaves once fixed', async ({ jezo }) => {
  const { page, root } = jezo
  const main = page.locator('main')
  const file = join(root, 'todos/items/t-u3.md')
  const good = readFileSync(file, 'utf8')
  await open(page, '更多')
  await expect(main.getByText('有問題的檔案')).toHaveCount(0)

  // Changed by hand to a state todos don't have.
  writeFileSync(file, good.replace('state: open', 'state: someday'))
  await main.getByText('有問題的檔案').click()
  const row = main.locator('[data-problem="todos/items/t-u3.md"]')
  await expect(row).toContainText('訂 12 月比賽的住宿')
  await row.getByText('1 個問題').click()
  await expect(row).toContainText('state must be one of draft, open, done')

  // One tap puts the request in the chat's box; the user sends it.
  await row.getByRole('button', { name: '請 Jezo 修' }).click()
  await expect(main.locator('textarea').first()).toHaveValue('幫我修好 todos/items/t-u3.md 的問題。')

  writeFileSync(file, good)
  await open(page, '更多')
  await expect(main.getByText('有問題的檔案')).toHaveCount(0)
  expect(jezo.errors).toEqual([])
})

test("a todo's drawer on the calendar sits above everything the calendar draws, and Escape closes it", async ({ jezo }) => {
  const { page } = jezo
  await open(page, '行事曆')
  await page.locator('[data-slot=event-calendar-event]').filter({ hasText: '晨跑' }).first().click()
  const drawer = page.locator('aside')
  await expect(drawer).toContainText('晨跑 5 km')
  // Every point of the drawer belongs to it: the calendar's sticky toolbar and raised chips stay underneath.
  const covered = await page.evaluate(() => {
    // Where the drawer shows: inside main, which clips it, and below the window's drag strip.
    const r = document.querySelector('aside')!.getBoundingClientRect()
    const m = document.querySelector('main')!.getBoundingClientRect()
    const points: [number, number][] = []
    for (let x = r.left + 4; x < Math.min(r.right, m.right); x += 40) for (let y = Math.max(r.top, 44); y < Math.min(r.bottom, m.bottom); y += 40) points.push([x, y])
    return points.filter(([x, y]) => !document.elementFromPoint(x, y)?.closest('aside')).map(([x, y]) => `${x},${y} ${document.elementFromPoint(x, y)?.outerHTML.slice(0, 120)}`)
  })
  expect(covered).toEqual([])
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  expect(jezo.errors).toEqual([])
})

test('a markdown link between two todos shows on both, and opens the other', async ({ jezo }) => {
  const { page, root } = jezo
  // Written in another editor: a standard markdown link from 打給媽 to 回 3 封卡住的信.
  const path = join(root, 'todos/items/t-u2.md')
  writeFileSync(path, `${readFileSync(path, 'utf8')}先[回完信](../../todos/items/t-u1.md)再打。\n`)
  await open(page, '行事曆')
  await page.locator('[data-backlog-id="t-u2"]').click()
  const related = page.locator('section').filter({ hasText: '相關' })
  await expect(related.getByRole('button', { name: /回 3 封卡住的信/ })).toBeVisible()

  // The other todo shows it's linked from here, and the link opens it.
  await related.getByRole('button', { name: /回 3 封卡住的信/ }).click()
  await expect(page.getByRole('textbox', { name: '標題' })).toHaveValue('回 3 封卡住的信')
  await expect(page.locator('section').filter({ hasText: '相關' }).getByRole('button', { name: /打給媽/ })).toBeVisible()
  expect(jezo.errors).toEqual([])
})

test('memories are files; deleting one keeps it deleted, and undo brings it back', async ({ jezo }) => {
  const { page, root, items } = jezo
  await open(page, '更多')
  await page.getByText('它記住的事').click()
  const row = page.locator('main').getByText('週日不排工作').locator('xpath=ancestor::div[.//button][1]')
  await expect(page.locator('main').getByText('週日不排工作')).toBeVisible()
  await expect(page.locator('main').getByText('長跑你常少估 35% 的時間')).toBeVisible()

  await row.getByRole('button', { name: '刪掉' }).click()
  await expect.poll(() => items('memory').some((m) => m.data.id === 'm-2')).toBe(false)
  expect(readFileSync(join(root, 'memory/forgotten.yaml'), 'utf8')).toContain('m-2')

  await page.getByRole('button', { name: '撤銷' }).click()
  await expect.poll(() => items('memory').find((m) => m.data.id === 'm-2')?.body).toContain('週日不排工作')
  expect(readFileSync(join(root, 'memory/forgotten.yaml'), 'utf8')).not.toContain('m-2')
  expect(jezo.errors).toEqual([])
})
