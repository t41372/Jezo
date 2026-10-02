// Automations when the computer was asleep or off (docs/design/automations.md).
// The main process's clock is moved the way the two-hours test moves it, and
// waking up is the real resume handler; the history is the workspace's own file.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication } from '@playwright/test'
import { stringify } from 'yaml'
import { expect, localModel, test } from './jezo'

const ZONE = 'Asia/Taipei'
const today = Temporal.Now.plainDateISO(ZONE)
/** A Thursday two weeks or so from now, for the coming-back-after-two-weeks case. */
const thursday = today.add({ days: ((4 - today.dayOfWeek + 7) % 7) + 14 })

function automation(root: string, id: string, fields: object, body = '回一句「好」就好，不用做別的事，也不用看任何檔案。') {
  mkdirSync(join(root, 'automations/items'), { recursive: true })
  writeFileSync(join(root, 'automations/items', `${id}.md`), `---\n${stringify({ id, state: 'on', ...fields })}---\n${body}\n`)
}

/** Watching since a moment, as if Jezo had been seeing this automation since then. */
function watching(root: string, id: string, since: Temporal.ZonedDateTime) {
  mkdirSync(join(root, 'automations/history'), { recursive: true })
  writeFileSync(join(root, 'automations/history', `${id}.jsonl`), `${JSON.stringify({ type: 'watching', at: since.toString({ timeZoneName: 'never' }), zone: ZONE })}\n`)
}

/** Moves the main process's clock to a moment, then wakes the computer up. */
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

type Event = { type: string; slot?: string; slots?: string[]; reason?: string; late?: boolean; outcome?: string }
const history = (root: string, id: string): Event[] => {
  try {
    return readFileSync(join(root, 'automations/history', `${id}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  } catch {
    return []
  }
}

test.beforeEach(async () => {
  test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.')
})
test.describe.configure({ timeout: 300_000 })

test.describe('missed while asleep', () => {
  const at8 = (date: Temporal.PlainDate) => date.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-test', { name: '測試排程', schedule: '0 8 * * *', catch_up: 'until 18:00' })
        // Watching since yesterday 07:00: yesterday's 08:00 and today's both went by while asleep.
        watching(root, 'a-test', at8(today.subtract({ days: 1 })).subtract({ hours: 1 }))
      },
    },
  })

  test('runs once when it wakes at 15:00, told how late; not again; and not at all after 18:00', async ({ jezo }) => {
    const { app, root } = jezo
    const slot = `${today}T08:00`
    await wakeAt(app, at8(today).add({ hours: 7 }))
    await expect.poll(() => history(root, 'a-test').filter((e) => e.type === 'ended').length, { timeout: 240_000 }).toBe(1)
    const events = history(root, 'a-test')
    expect(events.find((e) => e.type === 'claimed')).toMatchObject({ slot, late: true })
    // Yesterday's went by too: recorded, not run. (As replaced, or as expired if the launch's own check saw it first.)
    expect(events.filter((e) => e.type === 'skipped').flatMap((e) => e.slots)).toContain(`${today.subtract({ days: 1 })}T08:00`)

    // What the run was told, before its request.
    const session = readFileSync(join(root, 'sessions', readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!), 'utf8')
    expect(session).toContain('It started 7 hours late; it could start until 18:00.')
    expect(session).toContain("Not run: 1 earlier time")

    // Waking again doesn't run the same time twice.
    await wakeAt(app, at8(today).add({ hours: 7, minutes: 30 }))
    await new Promise((r) => setTimeout(r, 3000))
    expect(history(root, 'a-test').filter((e) => e.type === 'claimed')).toHaveLength(1)

    // Tomorrow at 19:00, its window closed at 18:00: recorded as skipped, not run.
    await wakeAt(app, at8(today.add({ days: 1 })).add({ hours: 11 }))
    await expect.poll(() => history(root, 'a-test').filter((e) => e.type === 'skipped' && e.reason === 'expired').flatMap((e) => e.slots)).toContain(`${today.add({ days: 1 })}T08:00`)
    expect(history(root, 'a-test').filter((e) => e.type === 'claimed')).toHaveLength(1)

    // Its page says the window in words and what happened to each time; the window is changed there.
    const { page } = jezo
    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('自動化', { exact: true }).click()
    await page.locator('[data-automation="a-test"]').click()
    await expect(page.locator('[data-catch-up]')).toHaveText('若 08:00 錯過，當天 18:00 前補跑一次')
    const lines = page.locator('[data-automation-history] li')
    await expect(lines.filter({ hasText: '晚了補跑 · 跑完了' })).toHaveCount(1)
    await expect(lines.filter({ hasText: '過了補跑的時間，沒跑' }).first()).toBeVisible()
    await page.locator('[data-catch-up]').click()
    await page.getByRole('button', { name: '錯過了就不補跑' }).click()
    await expect.poll(() => readFileSync(join(root, 'automations/items/a-test.md'), 'utf8')).toContain('catch_up: no')

    // Retried from its conversation the next evening, it's still the run for that day's 08:00,
    // without how late the first try was.
    await page.getByRole('button', { name: /^上次：/ }).click()
    await page.getByRole('button', { name: '重新回答' }).last().click()
    const retried = () => readFileSync(join(root, 'sessions', readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!), 'utf8')
    await expect.poll(retried, { timeout: 60_000 }).toContain('This is a retry, sent now.')
    expect(retried()).toContain(`This run: 測試排程 for ${today.toLocaleString('en-US', { weekday: 'short' })} ${today}, due at 08:00. This is a retry`)
    await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })
    expect(jezo.errors).toEqual([])
  })
})

test.describe('back after two weeks', () => {
  const since = today.subtract({ days: 1 }).toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 7 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-plan', { name: '排今天', schedule: '0 8 * * *', catch_up: 'until 18:00' })
        automation(root, 'a-night', { name: '晚上', schedule: '30 21 * * *', catch_up: 'until end of day' })
        automation(root, 'a-review', { name: '回顧', schedule: '0 20 * * 0', catch_up: 'for 24 hours' })
        for (const id of ['a-plan', 'a-night', 'a-review']) watching(root, id, since)
      },
    },
  })

  test('on a Thursday afternoon only today’s plan runs, once; the rest were missed and say so', async ({ jezo }) => {
    const { app, root } = jezo
    await wakeAt(app, thursday.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 15 } }))
    await expect.poll(() => history(root, 'a-plan').filter((e) => e.type === 'ended').length, { timeout: 240_000 }).toBe(1)
    expect(history(root, 'a-plan').filter((e) => e.type === 'claimed')).toHaveLength(1)
    // The evening and the review had their last times close; they're recorded, and nothing ran.
    for (const id of ['a-night', 'a-review']) {
      const events = history(root, id)
      expect(events.filter((e) => e.type === 'claimed')).toHaveLength(0)
      expect(events.some((e) => e.type === 'skipped' && e.reason === 'expired')).toBe(true)
    }
    expect(jezo.errors).toEqual([])
  })
})

test.describe('the morning plan, woken at 15:00', () => {
  const at = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 15 } })
  test.use({
    prepare: {
      workspace: (root) => {
        // The real morning plan, its own request and window, on as a user would have it.
        const path = join(root, 'automations/items/a-morning.md')
        writeFileSync(path, readFileSync(path, 'utf8').replace(/^state: off$/m, 'state: on'))
        watching(root, 'a-morning', today.subtract({ days: 1 }).toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 21 } }))
      },
    },
  })

  test('plans only the hours left, and puts nothing before now', async ({ jezo }, info) => {
    const { app, root, items } = jezo
    const before = new Map(items('todos').map((t) => [String(t.data.id), JSON.stringify(t.data)]))
    await wakeAt(app, at)
    await expect.poll(() => history(root, 'a-morning').filter((e) => e.type === 'ended').length, { timeout: 240_000 }).toBe(1)
    const session = readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
    await info.attach('pi-session', { body: readFileSync(join(root, 'sessions', session)), contentType: 'application/jsonl' })

    // What the run wrote: new todos and changed ones. It planned something, all of it later than 15:00 today.
    const written = items('todos').filter((t) => before.get(String(t.data.id)) !== JSON.stringify(t.data))
    const times = written.map((t) => t.data.scheduled).filter((s): s is string => typeof s === 'string')
    expect(times.length).toBeGreaterThan(0)
    for (const time of times) {
      const when = Temporal.ZonedDateTime.from(time.includes('[') ? time : `${time}[${ZONE}]`)
      expect(Temporal.ZonedDateTime.compare(when, at), `${time} is before 15:00`).toBeGreaterThanOrEqual(0)
    }
    expect(jezo.errors).toEqual([])
  })
})

test.describe('the morning plan, with an experiment running', () => {
  const at = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8, minute: 5 } })
  const monday = today.subtract({ days: today.dayOfWeek - 1 })
  test.use({
    prepare: {
      workspace: (root) => {
        const path = join(root, 'automations/items/a-morning.md')
        writeFileSync(path, readFileSync(path, 'utf8').replace(/^state: off$/m, 'state: on'))
        watching(root, 'a-morning', today.subtract({ days: 1 }).toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 21 } }))
        // Today unplanned, so the plan starts from the backlog: answering emails, calling mom, booking a room.
        for (const id of ['t-2', 't-3', 't-5', 't-6', 't-7']) rmSync(join(root, `todos/items/${id}.md`))
        // This week's arm puts errands like those in the evening, where a plan wouldn't put them on its own.
        mkdirSync(join(root, 'experiments/items'), { recursive: true })
        writeFileSync(join(root, 'experiments/items/x-evening.md'), `---\n${stringify({
          id: 'x-evening',
          title: '雜事集中在晚上',
          state: 'running',
          measure: '雜事做完的件數',
          arms: [
            { label: '隨時做', condition: '照平常，雜事有空就排。', periods: [{ from: monday.subtract({ days: 7 }).toString(), to: monday.subtract({ days: 1 }).toString() }] },
            { label: '晚上一起做', condition: '這週的雜事（回信、打電話、訂東西）都排在 20:00 以後，白天不排。', periods: [{ from: monday.toString(), to: monday.add({ days: 6 }).toString() }] },
          ],
        })}---\n雜事集中在晚上做，會不會做得比較多？\n`)
      },
    },
  })

  test("plans today by this week's arm", async ({ jezo }, info) => {
    const { app, root, items } = jezo
    const before = new Map(items('todos').map((t) => [String(t.data.id), JSON.stringify(t.data)]))
    await wakeAt(app, at)
    await expect.poll(() => history(root, 'a-morning').filter((e) => e.type === 'ended').length, { timeout: 240_000 }).toBe(1)
    const session = readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!
    await info.attach('pi-session', { body: readFileSync(join(root, 'sessions', session)), contentType: 'application/jsonl' })

    // The errands it put on today are at 20:00 or later, as the arm says. Without it, a run put the emails at 08:20.
    const when = (t: { data: Record<string, unknown> }) => Temporal.ZonedDateTime.from(String(t.data.scheduled).includes('[') ? String(t.data.scheduled) : `${t.data.scheduled}[${ZONE}]`)
    const errands = items('todos').filter((t) => ['t-u1', 't-u2', 't-u3'].includes(String(t.data.id)) && typeof t.data.scheduled === 'string' && when(t).toPlainDate().equals(today))
    expect(errands.length).toBeGreaterThan(0)
    for (const t of errands) expect(when(t).hour, `${t.data.title} at ${t.data.scheduled}`).toBeGreaterThanOrEqual(20)
    expect(jezo.errors).toEqual([])
  })
})

test.describe('cut off mid-run', () => {
  const at8 = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-slow', { name: '慢慢來', schedule: '0 8 * * *', catch_up: 'until 18:00' },
          '先用 write 工具建立 notes/hello.md，內容是 hi。寫好以後，用 bash 執行 sleep 120，等它結束再回一句「好了」。')
        watching(root, 'a-slow', at8.subtract({ hours: 1 }))
      },
    },
  })

  test('a run cut off by a crash is recorded as interrupted, isn’t run again, and what it changed can be undone', async ({ jezo }) => {
    const { root } = jezo
    await wakeAt(jezo.app, at8.add({ minutes: 30 }))
    await expect.poll(() => existsSync(join(root, 'notes/hello.md')), { timeout: 240_000 }).toBe(true)

    // Jezo dies mid-run, then opens again.
    jezo.app.process().kill('SIGKILL')
    await jezo.restart()
    await wakeAt(jezo.app, at8.add({ minutes: 40 }))
    await expect.poll(() => history(root, 'a-slow').map((e) => e.type === 'ended' && e.outcome).filter(Boolean)).toEqual(['interrupted'])
    await new Promise((r) => setTimeout(r, 3000))
    expect(history(root, 'a-slow').filter((e) => e.type === 'claimed')).toHaveLength(1)

    // 修改紀錄 has it, marked, with what it changed; undo takes it back, and Continue opens the conversation.
    const { page } = jezo
    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('修改紀錄').click()
    const row = page.locator('[data-history]').filter({ hasText: '沒跑完' }).first()
    await expect(row).toBeVisible()
    await row.getByRole('button', { name: '接著做' }).click()
    await expect(page.locator('main textarea').first()).toHaveValue(/做到一半被打斷/)
    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('修改紀錄').click()
    await page.locator('[data-history]').filter({ hasText: '沒跑完' }).first().getByRole('button', { name: '撤銷' }).click()
    await expect.poll(() => existsSync(join(root, 'notes/hello.md'))).toBe(false)
  })

  test('quitting mid-run cuts it off the same way: interrupted, not finished, and listed with what it changed', async ({ jezo }) => {
    const { root } = jezo
    await wakeAt(jezo.app, at8.add({ minutes: 30 }))
    await expect.poll(() => existsSync(join(root, 'notes/hello.md')), { timeout: 240_000 }).toBe(true)

    // The user quits while the run sleeps in bash; Jezo opens again. Either Quit records it as
    // interrupted or the next launch finds it unfinished; both are the design, so either passes.
    await jezo.restart()
    await wakeAt(jezo.app, at8.add({ minutes: 40 }))
    await expect.poll(() => history(root, 'a-slow').map((e) => e.type === 'ended' && e.outcome).filter(Boolean)).toEqual(['interrupted'])
    await new Promise((r) => setTimeout(r, 3000))
    expect(history(root, 'a-slow').filter((e) => e.type === 'claimed')).toHaveLength(1)

    const { page } = jezo
    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('修改紀錄').click()
    await expect(page.locator('[data-history]').filter({ hasText: '沒跑完' }).first()).toBeVisible()
  })
})

test.describe('run now', () => {
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-now', { name: '現在跑', schedule: '0 3 * * *', catch_up: 'no' })
      },
    },
  })

  test('pressed twice at once, it starts one run, and both give its conversation', async ({ jezo }) => {
    const { page, root } = jezo
    const [first, second] = await page.evaluate(() => Promise.all([window.jezo.schedule.run('a-now'), window.jezo.schedule.run('a-now')]))
    expect(second).toBe(first)
    await expect.poll(() => history(root, 'a-now').filter((e) => e.type === 'ended').length, { timeout: 240_000 }).toBe(1)
    const claims = history(root, 'a-now').filter((e) => e.type === 'claimed') as (Event & { session?: string; origin?: string })[]
    expect(claims).toHaveLength(1)
    // The claim names its conversation, so the page can open it later.
    expect(claims[0]).toMatchObject({ session: first, origin: 'manual' })
    expect(jezo.errors).toEqual([])
  })
})

test.describe('picked up on time, then waiting', () => {
  const at8 = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-long', { name: '先跑的', schedule: '59 7 * * *', catch_up: 'for 2 hours' }, '用 bash 執行 sleep 150，等它結束再回一句「好了」。不用做別的事。')
        automation(root, 'a-strict', { name: '不補跑的', schedule: '0 8 * * *', catch_up: 'no' })
        for (const id of ['a-long', 'a-strict']) watching(root, id, at8.subtract({ hours: 1 }))
      },
    },
  })

  test('a time found on time stays on time while it waits behind another run, even with no catching up', async ({ jezo }) => {
    test.setTimeout(480_000)
    const { root } = jezo
    // Both found at 08:00:30: the 07:59 one runs first and takes minutes; the 08:00 one waits.
    await wakeAt(jezo.app, at8.add({ seconds: 30 }))
    await expect.poll(() => history(root, 'a-strict').filter((e) => e.type === 'ended').length, { timeout: 420_000 }).toBe(1)
    expect(history(root, 'a-long').filter((e) => e.type === 'ended')).toHaveLength(1)
    expect(history(root, 'a-strict').find((e) => e.type === 'claimed')).toMatchObject({ slot: `${today}T08:00`, late: false })
    // It really waited: claimed more than two minutes after it was due.
    const claimedAt = (history(root, 'a-strict').find((e) => e.type === 'claimed') as Event & { at: string }).at
    expect(Temporal.Instant.from(claimedAt).epochMilliseconds - at8.epochMilliseconds).toBeGreaterThan(2 * 60_000)
    expect(history(root, 'a-strict').some((e) => e.type === 'skipped')).toBe(false)
    expect(jezo.errors).toEqual([])
  })
})

test.describe('due while another runs', () => {
  const at8 = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-first', { name: '先跑的', schedule: '59 7 * * *', catch_up: 'for 2 hours' }, '用 bash 執行 sleep 150，等它結束再回一句「好了」。不用做別的事。')
        automation(root, 'a-next', { name: '跑到一半才到的', schedule: '1 8 * * *', catch_up: 'no' })
        for (const id of ['a-first', 'a-next']) watching(root, id, at8.subtract({ hours: 1 }))
      },
    },
  })

  test('a time that comes due while another run is going is found on time and runs after it', async ({ jezo }) => {
    test.setTimeout(480_000)
    const { root } = jezo
    // 07:59:30: the 07:59 one starts; the 08:01 one comes due while it sleeps.
    await wakeAt(jezo.app, at8.subtract({ seconds: 30 }))
    await expect.poll(() => history(root, 'a-next').filter((e) => e.type === 'ended').length, { timeout: 420_000 }).toBe(1)
    expect(history(root, 'a-next').find((e) => e.type === 'claimed')).toMatchObject({ slot: `${today}T08:01`, late: false })
    expect(history(root, 'a-next').some((e) => e.type === 'skipped')).toBe(false)
    // It started after the first one ended, not beside it.
    const ended = (history(root, 'a-first').find((e) => e.type === 'ended') as Event & { at: string }).at
    const claimed = (history(root, 'a-next').find((e) => e.type === 'claimed') as Event & { at: string }).at
    expect(Temporal.Instant.compare(Temporal.Instant.from(claimed), Temporal.Instant.from(ended))).toBeGreaterThanOrEqual(0)
    expect(jezo.errors).toEqual([])
  })
})

test.describe('a damaged history', () => {
  const at8 = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-broken', { name: '紀錄壞了', schedule: '0 8 * * *', catch_up: 'until 18:00' })
        watching(root, 'a-broken', at8.subtract({ hours: 1 }))
        // A claim someone's editor cut in half, with lines after it: which times ran isn't known.
        writeFileSync(join(root, 'automations/history/a-broken.jsonl'), `${readFileSync(join(root, 'automations/history/a-broken.jsonl'), 'utf8')}{"type":"claimed","attem\n{"type":"retry","slot":"x","at":"y"}\n`)
      },
    },
  })

  test('pauses that automation, says why on its page, and lists the file in 有問題的檔案', async ({ jezo }) => {
    const { app, page, root } = jezo
    await wakeAt(app, at8.add({ minutes: 30 }))
    await new Promise((r) => setTimeout(r, 5000))
    expect(history(root, 'a-broken').filter((e) => e.type === 'claimed')).toHaveLength(0)

    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('自動化', { exact: true }).click()
    await page.locator('[data-automation="a-broken"]').click()
    await expect(page.locator('[data-history-damaged]')).toContainText('先不自己跑')
    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('有問題的檔案').click()
    await expect(page.locator('[data-problem="automations/history/a-broken.jsonl"]')).toBeVisible()
    expect(jezo.errors).toEqual([])
  })
})

test.describe('a command cut off', () => {
  const at8 = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        automation(root, 'a-shell', { name: '跑指令', schedule: '0 8 * * *', catch_up: 'until 18:00' },
          '用 bash 執行這一行，一字不改：mkdir -p scratch && echo hi > scratch/from-shell.md && sleep 120。等它結束再回一句「好了」。')
        watching(root, 'a-shell', at8.subtract({ hours: 1 }))
      },
    },
  })

  test('what a shell command changed before a crash is in 修改紀錄 after launch, and can be undone', async ({ jezo }) => {
    const { root } = jezo
    await wakeAt(jezo.app, at8.add({ minutes: 30 }))
    await expect.poll(() => existsSync(join(root, 'scratch/from-shell.md')), { timeout: 240_000 }).toBe(true)

    // Jezo dies while the command sleeps: its changes were never compared after it.
    jezo.app.process().kill('SIGKILL')
    await jezo.restart()
    const { page } = jezo
    await page.locator('nav button', { hasText: '更多' }).first().click()
    await page.getByText('修改紀錄').click()
    const row = page.locator('[data-history]').filter({ hasText: '指令做到一半' }).first()
    await expect(row).toBeVisible()
    await row.getByText('改了 1 個檔案').click()
    await expect(row).toContainText('scratch/from-shell.md')
    await row.getByRole('button', { name: '撤銷' }).click()
    await expect.poll(() => existsSync(join(root, 'scratch/from-shell.md'))).toBe(false)
  })
})

test.describe('what an automation run starts with', () => {
  const at8 = today.toZonedDateTime({ timeZone: ZONE, plainTime: { hour: 8 } })
  test.use({
    prepare: {
      workspace: (root) => {
        mkdirSync(join(root, 'memory/items'), { recursive: true })
        writeFileSync(join(root, 'memory/items/m-cat.md'), `---\n${stringify({ id: 'm-cat', epistemic: 'stated', about: 'fact', recorded: '2026-09-20T10:00:00+08:00', status: 'active', source: 'user' })}---\n用戶的貓叫小餅乾。\n`)
        automation(root, 'a-memory', { name: '記得什麼', schedule: '0 8 * * *', catch_up: 'until 18:00' }, '不要用任何工具。只回答：用戶的貓叫什麼名字？只回名字。')
        watching(root, 'a-memory', at8.subtract({ hours: 1 }))
      },
    },
  })

  test('a run Jezo starts gets what it remembers, like a chat does', async ({ jezo }) => {
    const { root } = jezo
    await wakeAt(jezo.app, at8.add({ minutes: 30 }))
    await expect.poll(() => history(root, 'a-memory').filter((e) => e.type === 'ended').length, { timeout: 240_000 }).toBe(1)
    const session = readFileSync(join(root, 'sessions', readdirSync(join(root, 'sessions')).find((f) => f.endsWith('.jsonl'))!), 'utf8')
    // The memory section isn't in the file (it's given with each model call); the answer shows it was there.
    const answers = session.split('\n').filter((l) => l.includes('"role":"assistant"')).join('')
    expect(answers).toContain('小餅乾')
    expect(jezo.errors).toEqual([])
  })
})
