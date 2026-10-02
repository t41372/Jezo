// Apple's on-device model (docs/design/backend.md, "Apple Foundation Models").
// Its context is too small for the agent, so it isn't offered as one; Jezo uses
// it for small tasks, like naming a conversation. Needs a Mac with Apple
// Intelligence for the parts that run the model; they say so when skipped.

import { test, expect, open } from './jezo'

test.setTimeout(180_000)

test('the Apple provider is set up without a key, and isn’t offered to run the agent', async ({ jezo }, info) => {
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
  if (detail.state === 'ready') await expect(page.getByText('Jezo 用它做小事')).toBeVisible()
  await page.screenshot({ path: info.outputPath('apple-provider.png') })

  // Not among the models the agent can run on, and choosing it is refused.
  const choosable = await page.evaluate(() => window.jezo.providers.choosable())
  expect(choosable.some((c) => c.provider === 'apple-foundation-models')).toBe(false)
  const refused = await page.evaluate(() => window.jezo.providers.choose('main', { provider: 'apple-foundation-models', id: 'system' }).then(() => '', (e: Error) => e.message))
  expect(refused).toContain('small tasks')
  expect(jezo.errors.filter((e) => !e.includes('small tasks'))).toEqual([])
})

test('a conversation is named from what the user asked, by the small model', async ({ jezo }) => {
  test.skip(process.platform !== 'darwin', 'Apple model requires macOS.')
  const { page } = jezo
  const detail = await page.evaluate(() => window.jezo.providers.get('apple-foundation-models'))
  if (process.env.JEZO_TEST_AFM === '1') expect(detail.state).toBe('ready')
  test.skip(detail.state !== 'ready', `Apple model unavailable: ${detail.appleAvailability}`)
  const asked = '這週末想去爬山，但不確定天氣，也還沒決定要不要約朋友一起去。不要用工具，回一句就好。'
  const id = await page.evaluate((text) => window.jezo.agent.send(null, text), asked)
  // Named after the first run: a few words, not the start of the message cut off.
  await expect.poll(async () => (await page.evaluate(() => window.jezo.agent.list())).find((s) => s.id === id)?.title, { timeout: 150_000 }).not.toMatch(/…$/)
  const title = (await page.evaluate(() => window.jezo.agent.list())).find((s) => s.id === id)!.title!
  expect(title.length).toBeGreaterThan(0)
  expect(title.length).toBeLessThanOrEqual(20)
  expect(jezo.errors).toEqual([])
})
