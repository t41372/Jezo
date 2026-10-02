// Jezo's agent, with a real model. These need a local model server (LM Studio
// or Ollama) with a model loaded; without one they're skipped, and say why.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, localModel, momentOf, open, test } from './jezo'

test.beforeEach(async () => {
  test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.')
})
test.setTimeout(300_000)

const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** A local date this many days from today. */
const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000)
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

  // The time the user named is theirs, not a proposal. It's fixed to the device's zone, the default for new times.
  expect(read('todos/items/t-u2.md').data).toMatchObject({ scheduled: `${tomorrow()}T20:00[Asia/Taipei]` })
  expect(read('todos/items/t-u2.md').data.proposed).toBeUndefined()
  await expect(page.locator('main')).toContainText('打給媽')

  // The change is in the history, and undoing it puts the todo back in the backlog.
  await open(page, '更多')
  await page.getByText('修改紀錄').click()
  await page.getByRole('button', { name: '撤銷' }).first().click()
  await expect.poll(() => read('todos/items/t-u2.md').data.scheduled).toBeUndefined()

  expect(jezo.errors).toEqual([])
})

test('a turn that changed nothing says so, and one tap asks the agent to act without a typed message', async ({ jezo }) => {
  const { page, read, root } = jezo
  const main = page.locator('main')
  const box = main.locator('textarea').first()
  const unchanged = main.locator('[data-unchanged]')
  const nudge = main.getByRole('button', { name: '請它動手' })
  await box.fill('今天還有什麼事？')
  await box.press('Enter')
  await settled(page)
  await expect(unchanged).toHaveCount(1)
  await expect(unchanged).toContainText('這輪沒有改動')

  // The tap starts a run from a hidden message: no new bubble from the user, and the old button goes away.
  await nudge.click()
  await settled(page)
  await expect(main.locator('[data-chat-message="user"]')).toHaveCount(1)
  const session = readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
  const entries = readFileSync(join(root, 'sessions', session), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  expect(entries.filter((e) => e.customType === 'jezo.nudge').map((e) => e.display)).toEqual([false])
  await expect(nudge).toHaveCount((await unchanged.count()) === 2 ? 1 : 0)

  // A turn that changes a file has no such line under it.
  const before = await unchanged.count()
  await box.fill('把「打給媽」排到明天晚上 20:00')
  await box.press('Enter')
  await settled(page)
  expect(read('todos/items/t-u2.md').data.scheduled).toBe(`${tomorrow()}T20:00[Asia/Taipei]`)
  await expect(unchanged).toHaveCount(before)
  await expect(nudge).toHaveCount(0)
  expect(jezo.errors).toEqual([])
})

test('the "/" menu runs a method by name, and its own actions start a conversation and open the model list', async ({ jezo }) => {
  const { page, root } = jezo
  const main = page.locator('main')
  const box = main.locator('textarea').first()
  const menu = page.locator('[data-slash-menu]')

  // Methods show by their title, found by any part of it; the keyboard picks one.
  await box.fill('/')
  await expect(menu.getByRole('option').filter({ hasText: '某天崩了幫你重排' })).toContainText('/skill:rework-a-bad-day')
  await box.fill('/崩')
  await box.press('Escape')
  await expect(menu).toBeHidden()
  // Typing on opens it again.
  await box.pressSequentially('了')
  await expect(menu.getByRole('option')).toHaveCount(1)
  // Arrows move through the list; Tab or Enter puts the command in the box.
  await box.fill('/skill:')
  await box.press('ArrowDown')
  await box.press('ArrowDown')
  await box.press('ArrowUp')
  const second = (await menu.getByRole('option').nth(1).locator('.font-mono').innerText()).trim()
  await expect(menu.getByRole('option', { selected: true })).toContainText(second)
  await box.press('Tab')
  await expect(box).toHaveValue(`${second} `)
  await box.fill('/skill:rew')
  await box.press('Enter')
  await expect(box).toHaveValue('/skill:rework-a-bad-day ')
  await box.pressSequentially('下午開了三個會，什麼都沒做')
  await box.press('Enter')
  await settled(page)

  // The model read the whole method; the chat shows what the user typed.
  await expect(main.locator('[data-chat-message="user"]')).toHaveText('/skill:rework-a-bad-day 下午開了三個會，什麼都沒做')
  const session = readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
  const user = readFileSync(join(root, 'sessions', session), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.message?.role === 'user')
  expect(JSON.stringify(user.message.content)).toContain('<skill name=\\"rework-a-bad-day\\"')

  // Jezo's own actions: /model opens the model list, /new starts an empty conversation.
  await box.fill('/model')
  await box.press('Enter')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await box.fill('/new')
  await box.press('Enter')
  await expect(main.locator('[data-chat-message]')).toHaveCount(0)
  await expect(box).toHaveValue('')

  // In the ⌥X window the menu opens below the box, and the window grows to show it.
  const quick = jezo.app.windows().find((w) => w.url().includes('/quick.html'))!
  await quick.locator('textarea').fill('/skill:rew')
  await expect(quick.locator('[data-slash-menu]')).toContainText('某天崩了幫你重排')
  await expect.poll(() => quick.evaluate(() => document.querySelector('[data-slash-menu]')!.getBoundingClientRect().bottom <= window.innerHeight)).toBe(true)
  expect(jezo.errors).toEqual([])
})

test('an automation added from its page by asking the agent is listed there in words', async ({ jezo }) => {
  const { page, items } = jezo
  const main = page.locator('main')
  await open(page, '更多')
  await page.getByText('自動化', { exact: true }).click()
  await main.getByRole('button', { name: '新增' }).click()

  // The chat opens with the start of the request in the box.
  const box = main.locator('textarea').first()
  await expect(box).toHaveValue('幫我新增一個自動化：')
  await box.pressSequentially('每週一早上九點，提醒我看一下這週的目標')
  await box.press('Enter')
  await settled(page)

  const added = items('automations').find((a) => !['a-morning', 'a-evening', 'a-weekly'].includes(String(a.data.id)))
  expect(added?.data).toMatchObject({ schedule: '0 9 * * 1', state: 'on' })
  // Only the built-in automations have a trigger; one with `weekly` would be labelled a weekly review.
  expect(added?.data.trigger).toBeUndefined()
  await open(page, '更多')
  await page.getByText('自動化', { exact: true }).click()
  await expect(main.locator(`[data-automation="${added!.data.id}"]`)).toContainText('每週一 09:00')
  expect(jezo.errors).toEqual([])
})

test('the backlog hands its todos to the agent, which proposes times in the coming week', async ({ jezo }) => {
  const { page, items } = jezo
  await open(page, '行事曆')
  const backlogIds = items('todos').filter((t) => t.data.state === 'open' && !t.data.scheduled).map((t) => String(t.data.id))
  await page.getByRole('button', { name: '讓 agent 幫我找時間' }).click()
  await expect(page.getByRole('button', { name: 'agent 在找時間…' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('看 agent 怎麼說')).toBeVisible({ timeout: 240_000 })

  // Times went to the files as proposals, within the next seven days.
  const placed = items('todos').filter((t) => backlogIds.includes(String(t.data.id)) && t.data.scheduled)
  expect(placed.length).toBeGreaterThanOrEqual(2)
  for (const t of placed) {
    expect(t.data.proposed).toBe(true)
    const date = String(t.data.scheduled).slice(0, 10)
    expect(date >= day(0) && date <= day(7), `${t.data.title} at ${t.data.scheduled}`).toBe(true)
  }
  // What it said is a conversation of its own.
  await page.getByText('看 agent 怎麼說').click()
  await expect(page.getByRole('button', { name: /幫待辦找時間/ }).first()).toBeVisible()
  expect(jezo.errors).toEqual([])
})

test('a conversation picked up two hours later plans from the new time', async ({ jezo }) => {
  const { app, page, read, root } = jezo
  const say = async (text: string) => {
    const box = page.locator('main textarea').first()
    await box.fill(text)
    await box.press('Enter')
    await settled(page)
  }
  await say('今天還有什麼事？')

  // Two hours pass while the conversation stays open: the main process's clock moves on.
  const offset = 2 * 3600_000
  await app.evaluate((_, offset) => {
    const Real = Date
    class Later extends Real {
      constructor(...args: unknown[]) {
        if (args.length) super(...(args as [number]))
        else super(Real.now() + offset)
      }
      static now() {
        return Real.now() + offset
      }
    }
    globalThis.Date = Later as DateConstructor
  }, offset)
  const then = new Date(Date.now() + offset)
  await say('一小時後我要打給媽，幫我排進去。')

  // Planned from the time now, not from when the conversation started.
  const scheduled = read('todos/items/t-u2.md').data.scheduled as string
  const minutes = (momentOf(scheduled) - then.getTime()) / 60_000
  expect(minutes, `scheduled ${scheduled}, two hours later it was ${then.toString()}`).toBeGreaterThanOrEqual(45)
  // Later is fine when it moves past a todo in the way; from the old time it would be about an hour early.
  expect(minutes).toBeLessThanOrEqual(120)
  // The time went with the message.
  const session = readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
  const notes = readFileSync(join(root, 'sessions', session), 'utf8').split('\n').filter((l) => l.includes('"jezo.time"'))
  expect(notes).toHaveLength(2)
  expect(jezo.errors).toEqual([])
})

test('a plan changed in the conversation is one plan, and the new version shows at the bottom', async ({ jezo }) => {
  const { page, items } = jezo
  const say = async (text: string) => {
    const box = page.locator('main textarea').first()
    await box.fill(text)
    await box.press('Enter')
    await settled(page)
  }
  const draft = (word: string) => items('todos').filter((t) => t.data.state === 'draft' && String(t.data.title).includes(word))
  const planned = () => ['洗衣服', '買菜', '繳電費', '修腳踏車'].flatMap(draft)
  await say('明天早上幫我排：洗衣服 30 分鐘、買菜 40 分鐘、繳電費 10 分鐘。')
  expect(planned()).toHaveLength(3)

  // Changing it takes moving one, dropping one and adding one.
  await say('買菜改到晚上七點，繳電費拿掉，再加一個修腳踏車 45 分鐘。')
  expect(draft('洗衣服')).toHaveLength(1)
  expect(draft('繳電費')).toHaveLength(0)
  expect(draft('修腳踏車')).toHaveLength(1)
  expect(draft('買菜').map((t) => t.data.scheduled)).toEqual([`${tomorrow()}T19:00[Asia/Taipei]`])
  expect(planned()).toHaveLength(3)

  // The new version is the last card, saying what changed; the first one points down to it.
  const cards = page.locator('main [data-slot=card]').filter({ hasText: '洗衣服' })
  await expect(cards.last()).toContainText('修腳踏車')
  await expect(cards.last()).toContainText('拿掉了')
  await expect(page.locator('main').getByText('已更新，見下方')).toBeVisible()
  expect(jezo.errors).toEqual([])
})

test('the agent runs a command, and undo takes back what it changed', async ({ jezo }) => {
  const { page, root } = jezo
  const box = page.locator('main textarea').first()
  // A folder no plugin owns: notes/ has its own conventions, which a model sometimes followed (items/, frontmatter).
  await box.fill('用 bash 指令在工作區建立 scratch/hello.md，內容就只寫 hi 兩個字母。')
  await box.press('Enter')
  await settled(page)
  const file = join(root, 'scratch/hello.md')
  expect(readFileSync(file, 'utf8').trim()).toBe('hi')
  const session = readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
  expect(readFileSync(join(root, 'sessions', session), 'utf8')).toContain('"name":"bash"')

  await open(page, '更多')
  await page.getByText('修改紀錄').click()
  await page.getByRole('button', { name: '撤銷' }).first().click()
  await expect.poll(() => existsSync(file)).toBe(false)
  expect(jezo.errors).toEqual([])
})

test.describe('a method with a program', () => {
  // A skill that comes with a script, the way CLI skills do. Only the script knows the answer,
  // so the agent has to read the skill and run it.
  test.use({
    prepare: {
      workspace: (root) => {
        const dir = join(root, 'skills/trail-conditions')
        mkdirSync(join(dir, 'scripts'), { recursive: true })
        writeFileSync(
          join(dir, 'SKILL.md'),
          '---\nname: trail-conditions\ndescription: The state of the user\'s running trail, from the park office. Use it when the user asks whether the trail is open or muddy.\n---\nRun `sh skills/trail-conditions/scripts/trail.sh` from the workspace. It prints the trail\'s state and a report number; tell the user both.\n',
        )
        writeFileSync(join(dir, 'scripts/trail.sh'), '#!/bin/sh\necho "Trail: open, muddy after km 3. Report 4172."\n', { mode: 0o755 })
      },
    },
  })

  test('the agent runs the script and reports what it printed', async ({ jezo }) => {
    const { page } = jezo
    const box = page.locator('main textarea').first()
    await box.fill('我明天想去跑步，步道現在能跑嗎？')
    await box.press('Enter')
    await settled(page)
    // What only the script knows reached the user.
    await expect(page.locator('main')).toContainText(/泥濘|泥|muddy/)
    const session = readdirSync(join(jezo.root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
    expect(readFileSync(join(jezo.root, 'sessions', session), 'utf8')).toContain('Report 4172')
    expect(jezo.errors).toEqual([])
  })
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
  // The run shows in the history once it has finished, which can be after its cards appear.
  await open(page, '更多')
  await page.getByText('修改紀錄').click()
  await page.getByRole('button', { name: '撤銷' }).first().click({ timeout: 240_000 })
  await expect.poll(() => items('notes').filter((n) => n.data.state === 'new').length).toBe(4)
  expect(read(`notes/items/${decided.file}`).data.state).toBe('sorted')
  await expect(page.getByText(/有 1 個檔案你後來改過/)).toBeVisible()

  expect(jezo.errors).toEqual([])
})

test.describe('a new install', () => {
  test.use({ prepare: { model: null } })

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

    // The todo already in the backlog is the one scheduled, not a copy of it.
    expect(items('todos').filter((t) => String(t.data.title).includes('住宿')).map((t) => t.data.id)).toEqual(['t-u3'])
    const scheduled = String(items('todos').find((t) => t.data.id === 't-u3')!.data.scheduled)
    expect(scheduled.slice(0, 10)).toBe(date)
    // 45 minutes that don't touch 19:00–21:00, in the evening.
    const [h, m] = scheduled.slice(11, 16).split(':').map(Number)
    const start = h * 60 + m
    expect(start >= 17 * 60).toBe(true)
    expect(start + 45 <= 19 * 60 || start >= 21 * 60).toBe(true)
  } finally {
    server.close()
  }
  expect(jezo.errors).toEqual([])
})

test.describe('installing methods in a conversation', () => {
  let github: Awaited<ReturnType<typeof import('./skill-server').skillServer>>
  test.beforeAll(async () => {
    github = await (await import('./skill-server')).skillServer()
    process.env.JEZO_GITHUB_API = github.base
    process.env.JEZO_GITHUB_CODELOAD = github.base
  })
  test.afterAll(() => {
    github?.close()
    delete process.env.JEZO_GITHUB_API
    delete process.env.JEZO_GITHUB_CODELOAD
  })

  test('the user asks for an install, and undo removes its files', async ({ jezo }) => {
    const { page, root } = jezo
    const { existsSync } = await import('node:fs')
    const { parse: parseYaml } = await import('yaml')
    const address = 'https://github.com/o/r/tree/main/methods/next-step'
    const box = page.locator('main textarea').first()
    await box.fill(`幫我安裝這個 skill：${address}`)
    await box.press('Enter')
    await settled(page)

    expect(existsSync(join(root, 'skills/next-step/SKILL.md'))).toBe(true)
    expect(jezo.read('skills/next-step/SKILL.md').data['disable-model-invocation']).not.toBe(true)
    const origins = () => (parseYaml(readFileSync(join(root, 'skills/installed.yaml'), 'utf8')) as { skills: { name: string; by: string }[] }).skills
    expect(origins().find((s) => s.name === 'next-step')?.by).toBe('agent')
    await open(page, '更多')
    await page.getByText('已安裝', { exact: true }).click()
    await expect(page.locator('main')).toContainText('agent 裝的 · 來自 github.com/o/r')
    await page.getByRole('button', { name: '← 更多' }).click()
    await page.getByText('修改紀錄', { exact: true }).click()
    await page.getByRole('button', { name: '撤銷' }).first().click()
    await expect.poll(() => existsSync(join(root, 'skills/next-step/SKILL.md'))).toBe(false)
    expect(existsSync(join(root, 'skills/next-step/scripts/run.sh'))).toBe(false)
    expect(existsSync(join(root, 'skills/next-step/old.txt'))).toBe(false)
    expect(existsSync(join(root, 'skills/installed.yaml'))).toBe(false)
    // So do files that aren't text.
    expect(existsSync(join(root, 'skills/next-step/picture.bin'))).toBe(false)
    expect(jezo.errors).toEqual([])
  })
})
