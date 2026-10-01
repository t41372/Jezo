// Automations when the computer was asleep or off (docs/design/automations.md).
// The main process's clock is moved the way the two-hours test moves it, and
// waking up is the real resume handler; the history is the workspace's own file.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
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
