// Small experiments: files in experiments/items/, a page in 更多, and the agent
// counting the result from real done todos (docs/design/experiments.md).

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { expect, localModel, open, test } from './jezo'

const pad = (n: number) => String(n).padStart(2, '0')
/** A local date this many days from today. */
const day = (offset: number) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function write(root: string, path: string, data: object, body = '') {
  mkdirSync(join(root, path, '..'), { recursive: true })
  writeFileSync(join(root, path), `---\n${stringify(data)}---\n${body}`)
}

/** Meditating in the evening one week and in the morning the next, ending yesterday. */
function meditation(root: string, state: 'running' | 'finished', extra: object = {}) {
  write(root, 'experiments/items/x-meditate.md', {
    id: 'x-meditate',
    title: '早上冥想還是晚上冥想',
    state,
    measure: '冥想有做的天數',
    arms: [
      { label: '晚上冥想', condition: '睡前冥想 10 分鐘', periods: [{ from: day(-14), to: day(-8) }] },
      { label: '早上冥想', condition: '起床後冥想 10 分鐘', periods: [{ from: day(-7), to: day(-1) }] },
    ],
    ...extra,
  }, '我想知道冥想放早上還是晚上比較做得到。\n')
}

test.describe('without a model', () => {
  test.use({
    prepare: {
      model: null,
      workspace: (root) => {
        meditation(root, 'finished', {
          arms: [
            { label: '晚上冥想', condition: '睡前冥想 10 分鐘', periods: [{ from: day(-14), to: day(-8) }], value: '2 / 7 天', basis: 'done todos titled 冥想, by completed date' },
            { label: '早上冥想', condition: '起床後冥想 10 分鐘', periods: [{ from: day(-7), to: day(-1) }], value: '5 / 7 天', basis: 'done todos titled 冥想, by completed date' },
          ],
          conclusion: '早上那週做到的天數多很多。不過那週剛好沒有晚上的聚餐，差距有一部分可能是因為這個。',
        })
        write(root, 'experiments/items/x-cards.md', {
          id: 'x-cards',
          title: '單字卡：睡前背還是早上背',
          state: 'running',
          measure: '背完單字卡的次數',
          arms: [
            { label: '睡前背', condition: '單字卡排在睡前', periods: [{ from: day(-7), to: day(-1) }, { from: day(7), to: day(13) }] },
            { label: '早上背', condition: '單字卡排在早上通勤', periods: [{ from: day(0), to: day(6) }, { from: day(14), to: day(20) }] },
          ],
        }, '想知道哪個時間比較背得下去。\n')
      },
    },
  })

  test('the page shows a running experiment by this week, and a finished one by its numbers; the decision goes to the file', async ({ jezo }) => {
    const { page, read } = jezo
    const main = page.locator('main')
    await open(page, '更多')
    await expect(main.getByRole('button', { name: /小實驗/ })).toContainText('1 個進行中')
    await main.getByText('小實驗', { exact: true }).click()

    const running = main.locator('[data-experiment="x-cards"]')
    await expect(running).toContainText('第 2 / 4 週')
    await expect(running).toContainText('這週：早上背，單字卡排在早上通勤')

    const finished = main.locator('[data-experiment="x-meditate"]')
    await expect(finished).toContainText('2 / 7 天')
    await expect(finished).toContainText('5 / 7 天')
    await expect(finished).toContainText('剛好沒有晚上的聚餐')
    await finished.getByRole('button', { name: '採用' }).click()
    await expect.poll(() => read('experiments/items/x-meditate.md').data.decision).toBe('adopt')
    await expect(finished).toContainText('記下了：採用這個做法。')

    // What adopting means for the days is the agent's to do, when the user asks.
    await finished.getByRole('button', { name: '跟 Jezo 說' }).click()
    await expect(main.locator('textarea').first()).toHaveValue('小實驗「早上冥想還是晚上冥想」我決定採用，幫我把它放進每天的安排。')
    expect(jezo.errors).toEqual([])
  })
})

test.describe('with a model', () => {
  test.beforeEach(async () => {
    test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.')
  })
  test.setTimeout(300_000)
  test.use({
    prepare: {
      workspace: (root) => {
        meditation(root, 'running')
        // Two evenings in the first week, five mornings in the second.
        const done = [-13, -10, -7, -6, -5, -3, -2]
        done.forEach((offset, i) => {
          const at = `${day(offset)}T${offset <= -8 ? '22:00' : '07:10'}`
          write(root, `todos/items/t-med${i}.md`, { id: `t-med${i}`, title: '冥想 10 分鐘', state: 'done', estimate: 10, scheduled: at, created: at, completed: at })
        })
      },
    },
  })

  test('the agent counts an experiment that has run its course from the done todos, and writes the result', async ({ jezo }) => {
    const { page, read } = jezo
    const box = page.locator('main textarea').first()
    await box.fill('冥想的小實驗跑完了，幫我算結果。')
    await box.press('Enter')
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })

    const x = read('experiments/items/x-meditate.md').data as { state: string; conclusion?: string; arms: { value?: string }[] }
    expect(x.state).toBe('finished')
    expect(x.arms[0].value).toMatch(/\b2\b/)
    expect(x.arms[1].value).toMatch(/\b5\b/)
    expect(x.conclusion).toBeTruthy()
    // The decision is the user's.
    expect(read('experiments/items/x-meditate.md').data.decision).toBeUndefined()
    expect(jezo.errors).toEqual([])
  })

  test.describe('starting one', () => {
    test.use({ prepare: {} })
    test('the user says what they want to try, and the agent sets up alternating weeks from next week', async ({ jezo }) => {
      const { page, items } = jezo
      await open(page, '更多')
      await page.getByText('小實驗', { exact: true }).click()
      await page.locator('main').getByRole('button', { name: '新增' }).click()
      const box = page.locator('main textarea').first()
      await box.pressSequentially('早上先做最難的事。用升等 doc 那個目標的待辦做完幾件來比，試四週。')
      await box.press('Enter')
      await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })

      const [x] = items('experiments')
      const arms = x?.data.arms as { periods: { from: string; to: string }[] }[]
      expect(x?.data).toMatchObject({ state: 'running' })
      expect(arms.length).toBeGreaterThanOrEqual(2)
      // Alternating: each way of doing it gets more than one week, and nothing starts before today.
      const periods = arms.flatMap((a) => a.periods)
      expect(periods.length).toBeGreaterThanOrEqual(4)
      for (const p of periods) expect(p.from >= day(0)).toBe(true)
      await open(page, '更多')
      await page.getByText('小實驗', { exact: true }).click()
      await expect(page.locator(`[data-experiment="${x.data.id}"]`)).toBeVisible()
      expect(jezo.errors).toEqual([])
    })
  })
})
