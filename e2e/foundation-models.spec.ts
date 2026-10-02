// Apple's on-device model (docs/design/backend.md, "Apple Foundation Models").
// It can be picked for anything; its context is too small for a conversation
// with the agent, so the pickers say so, and it suits small tasks, like naming a
// conversation, which otherwise use the background model. Needs a Mac with Apple
// Intelligence for the parts that run the model; they say so when skipped.

import { test, expect, open } from './jezo'

test.setTimeout(180_000)

test('the Apple provider is set up without a key, can be picked anywhere, and is marked too small for a conversation', async ({ jezo }, info) => {
  const { page } = jezo
  const providers = await page.evaluate(() => window.jezo.providers.list())
  if (process.platform !== 'darwin') {
    expect(providers.some((p) => p.id === 'apple-foundation-models')).toBe(false)
    return
  }
  expect(providers.some((p) => p.id === 'apple-foundation-models')).toBe(true)
  await open(page, '設定')
  await page.getByText('模型服務商', { exact: true }).click()
  await page.getByRole('button', { name: 'Apple Foundation Models', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Apple Foundation Models' })).toBeVisible()
  const detail = await page.evaluate(() => window.jezo.providers.get('apple-foundation-models'))
  if (process.env.JEZO_TEST_AFM === '1') expect(detail.state).toBe('ready')
  expect(detail.needsKey).toBe(false)
  expect(detail.baseUrl).toBeUndefined()
  await page.screenshot({ path: info.outputPath('apple-provider.png') })
  if (detail.state !== 'ready') return

  // Nothing is refused for being Apple's: what counts is whether a conversation fits its context.
  const choices = await page.evaluate(() => window.jezo.providers.choices())
  expect((await page.evaluate(() => window.jezo.providers.choosable())).some((c) => c.provider === 'apple-foundation-models')).toBe(true)
  expect(choices.small).toBeNull()
  await open(page, '設定')
  await page.locator('main').getByRole('button', { name: choices.main!.name }).click()
  await expect(page.getByRole('option', { name: /Apple on-device/ })).toContainText('太小')
  await page.getByRole('option', { name: /Apple on-device/ }).click()
  await expect.poll(async () => (await page.evaluate(() => window.jezo.providers.choices())).main).toMatchObject({ provider: 'apple-foundation-models' })
  await expect(page.getByText(/這個模型一次只讀得了 8K/)).toBeVisible()
  await page.screenshot({ path: info.outputPath('apple-as-main.png') })
  await page.evaluate((ref) => window.jezo.providers.choose('main', ref), { provider: choices.main!.provider, id: choices.main!.id })

  // Small tasks use the background model until another is picked, Apple's among them.
  await page.getByRole('button', { name: '背景工作和小任務用的模型' }).click()
  await page.getByRole('button', { name: '跟背景工作一樣' }).click()
  await expect(page.getByRole('option', { name: /Apple on-device/ })).not.toContainText('太小')
  await page.getByRole('option', { name: /Apple on-device/ }).click()
  await expect.poll(async () => (await page.evaluate(() => window.jezo.providers.choices())).small).toMatchObject({ provider: 'apple-foundation-models' })
  await page.screenshot({ path: info.outputPath('small-tasks.png') })
  expect(jezo.errors).toEqual([])
})

test('a conversation is named from what the user asked, by Apple\'s model when it is picked for small tasks', async ({ jezo }) => {
  test.skip(process.platform !== 'darwin', 'Apple model requires macOS.')
  const { page } = jezo
  const detail = await page.evaluate(() => window.jezo.providers.get('apple-foundation-models'))
  if (process.env.JEZO_TEST_AFM === '1') expect(detail.state).toBe('ready')
  test.skip(detail.state !== 'ready', `Apple model unavailable: ${detail.appleAvailability}`)
  await page.evaluate(() => window.jezo.providers.choose('small', { provider: 'apple-foundation-models', id: 'system' }))
  const asked = '這週末想去爬山，但不確定天氣，也還沒決定要不要約朋友一起去。不要用工具，回一句就好。'
  const id = await page.evaluate((text) => window.jezo.agent.send(null, text), asked)
  // Named after the first run: a few words, not the start of the message cut off.
  await expect.poll(async () => (await page.evaluate(() => window.jezo.agent.list())).find((s) => s.id === id)?.title, { timeout: 150_000 }).not.toMatch(/…$/)
  const title = (await page.evaluate(() => window.jezo.agent.list())).find((s) => s.id === id)!.title!
  expect(title.length).toBeGreaterThan(0)
  expect(title.length).toBeLessThanOrEqual(20)
  expect(jezo.errors).toEqual([])
})
