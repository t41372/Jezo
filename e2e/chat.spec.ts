// Chat runs in the real app. Rendering uses pi JSONL without a model; delivery
// and branches use the same pinned local model as agent.spec.ts.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'
import { expect, localModel, test } from './jezo'
import { writeSortSession } from './sessions'

const SESSION_ID = '01a0f000-0000-7000-8000-000000000002'
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }

function seed(root: string, cards = false, cutOff = false, thinking = false) {
  const now = Date.now()
  const at = new Date(now).toISOString()
  let parentId: string | null = null
  let count = 0
  const lines: object[] = [{ type: 'session', version: 3, id: SESSION_ID, timestamp: at, cwd: root }]
  const append = (value: object) => {
    const id = `c${String(++count).padStart(7, '0')}`
    lines.push({ ...value, id, parentId, timestamp: at })
    parentId = id
  }
  const message = (value: object) => append({ type: 'message', message: { ...value, timestamp: now + count } })
  const assistant = (content: object[], stopReason = 'stop') => message({ role: 'assistant', content, stopReason, api: 'openai-completions', provider: 'lmstudio', model: 'seed', usage })
  append({ type: 'custom', customType: 'jezo.session', data: { trigger: 'user' } })
  message({ role: 'user', content: thinking ? '想給我看' : cutOff ? '想太久' : cards ? '卡片測試' : '排版測試' })
  for (const customType of ['jezo.time', 'jezo.request', 'jezo.check']) append({ type: 'custom_message', customType, content: `HIDDEN-${customType}`, display: false })
  if (thinking) {
    // Two stretches of work, with something said between them, the way a real run alternates.
    assistant([
      { type: 'thinking', thinking: '用戶想知道今天的安排。\n先讀今天的待辦。', thinkingSignature: 'reasoning_content' },
      { type: 'text', text: '我先看看你今天的待辦。' },
      { type: 'toolCall', id: 'read-call', name: 'read', arguments: { path: `${root}/todos/items/t-1.md` } },
    ], 'toolUse')
    message({ role: 'toolResult', toolCallId: 'read-call', toolName: 'read', content: [{ type: 'text', text: 'TOOL-OUTPUT-晨跑' }], isError: false })
    assistant([
      { type: 'thinking', thinking: '只有一件：晨跑。\n可以直接回答。', thinkingSignature: 'reasoning_content' },
      { type: 'text', text: '今天只有晨跑。' },
    ])
  } else if (cutOff) {
    assistant([{ type: 'thinking', thinking: 'I\'ll write the JSON.\n'.repeat(50) }], 'length')
  } else if (cards) {
    assistant([
      { type: 'text', text: '先看計畫，再選一個。' },
      { type: 'toolCall', id: 'plan-call', name: 'todos_propose', arguments: { todos: [{ title: '升等 doc' }] } },
    ], 'toolUse')
    message({ role: 'toolResult', toolCallId: 'plan-call', toolName: 'todos_propose', content: [{ type: 'text', text: 'Proposed.' }], isError: false, details: { card: { kind: 'plan', title: '明天的小計畫', todoIds: ['t-2'] } } })
    assistant([{ type: 'toolCall', id: 'ask-call', name: 'ask_user', arguments: { options: ['先做這件', '換一件'] } }], 'toolUse')
    message({ role: 'toolResult', toolCallId: 'ask-call', toolName: 'ask_user', content: [{ type: 'text', text: 'Asked.' }], isError: false, details: { card: { kind: 'choices', options: ['先做這件', '換一件'] } } })
  } else {
    assistant([{ type: 'text', text: [
      '| 待辦 | 分鐘 |', '| --- | ---: |', '| 打給媽 | 10 |', '| 整理書桌 | 15 |', '',
      '```typescript', 'const minutes: number = 10', 'console.log(minutes)', '```', '',
      '行內公式 $$x^2 + y^2 = z^2$$。', '', '$$', '\\int_0^1 x^2\\,dx = \\frac{1}{3}', '$$', '',
      '這是**中文重點**，還有*中文強調*。', '', '![outside](https://example.com/private.png)',
      '', '[外部連結](https://example.com/)',
    ].join('\n') }])
  }
  mkdirSync(join(root, 'sessions'), { recursive: true })
  writeFileSync(join(root, 'sessions', `${at.replace(/[:.]/g, '-')}_${SESSION_ID}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
}

async function artifact(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

async function idle(page: Page) {
  await expect(page.getByRole('button', { name: '停下來' })).toHaveCount(0, { timeout: 240_000 })
}

test.describe('saved chat, without a model', () => {
  test.use({ prepare: { model: null, workspace: (root) => seed(root) } })
  test('renders tables, highlighted code, default math and CJK without fetching images', async ({ jezo }, info) => {
    const { page } = jezo
    await page.getByRole('button', { name: /排版測試/ }).click()
    await expect(page.locator('main table')).toHaveCount(1)
    await expect(page.locator('main td')).toHaveText(['打給媽', '10', '整理書桌', '15'])
    await expect(page.locator('main pre code')).toContainText('const minutes: number = 10')
    // Highlighting arrives after the plain text: Streamdown gives each token a color in --sdm-c.
    await expect(page.locator('main pre code span[style*="--sdm-c"]:not([style*="--sdm-c: inherit"])').first()).toBeVisible()
    await expect(page.locator('main .katex')).toHaveCount(2)
    await expect(page.locator('main .katex-display')).toHaveCount(1)
    await expect(page.locator('main [data-streamdown=strong]')).toHaveText('中文重點')
    await expect(page.locator('main em')).toHaveText('中文強調')
    await expect(page.locator('main img[src^="http"]')).toHaveCount(0)
    await expect(page.locator('main')).not.toContainText('HIDDEN-')
    await expect(page.getByRole('link', { name: '外部連結' })).toHaveAttribute('target', '_blank')
    // The clipboard is the developer's own: what was on it goes back right after.
    const theirs = await jezo.app.evaluate(({ clipboard }) => clipboard.readText())
    try {
      await page.getByRole('button', { name: '複製訊息' }).last().click()
      await expect.poll(() => jezo.app.evaluate(({ clipboard }) => clipboard.readText())).toContain('| 待辦 | 分鐘 |')
    } finally {
      await jezo.app.evaluate(({ clipboard }, text) => clipboard.writeText(text), theirs)
    }
    await artifact(page, info, 'markdown')
    expect(jezo.errors).toEqual([])
  })
})

test.describe('saved versions', () => {
  test.use({ prepare: { model: null, workspace: (root) => {
    seed(root)
    const file = readdirSync(join(root, 'sessions')).find((name) => name.includes(SESSION_ID))!
    const path = join(root, 'sessions', file)
    const timestamp = new Date().toISOString()
    const entries = [
      { type: 'custom', id: 'r0000001', parentId: 'c0000001', customType: 'jezo.retry', data: { userEntryId: 'c0000002' }, timestamp },
      { type: 'message', id: 'r0000002', parentId: 'r0000001', timestamp, message: { role: 'user', content: '排版測試', timestamp: Date.now() } },
      { type: 'message', id: 'r0000003', parentId: 'r0000002', timestamp, message: { role: 'assistant', content: [{ type: 'text', text: 'VERSION-TWO' }], api: 'openai-completions', provider: 'lmstudio', model: 'seed', usage, stopReason: 'stop', timestamp: Date.now() + 1 } },
    ]
    writeFileSync(path, readFileSync(path, 'utf8') + entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n')
  } } })
  test('selects a saved continuation without changing files or undo', async ({ jezo }, info) => {
    const { page, root } = jezo
    const before = readdirSync(join(root, 'todos/items')).sort().map((file) => readFileSync(join(root, 'todos/items', file), 'utf8'))
    const history = await page.evaluate(() => window.jezo.history.list())
    await page.getByRole('button', { name: /排版測試/ }).click()
    await expect(page.locator('main')).toContainText('VERSION-TWO')
    const picker = page.locator('main [data-chat-message="assistant"] [data-branch-picker]')
    await expect(picker).toContainText('2/2')
    await picker.getByRole('button', { name: '上一個版本' }).click()
    await expect(picker).toContainText('1/2')
    await expect(page.locator('main table')).toHaveCount(1)
    await expect(page.locator('main')).not.toContainText('VERSION-TWO')
    const file = readdirSync(join(root, 'sessions')).find((name) => name.includes(SESSION_ID))!
    await expect.poll(() => JSON.parse(readFileSync(join(root, 'sessions', file), 'utf8').trim().split('\n').at(-1)!)).toMatchObject({ type: 'custom', customType: 'jezo.branch', parentId: 'c0000006' })
    await page.reload()
    await page.getByRole('button', { name: /排版測試/ }).click()
    await expect(page.locator('main table')).toHaveCount(1)
    expect(readdirSync(join(root, 'todos/items')).sort().map((file) => readFileSync(join(root, 'todos/items', file), 'utf8'))).toEqual(before)
    expect(await page.evaluate(() => window.jezo.history.list())).toEqual(history)
    await artifact(page, info, 'saved-original-version')
    expect(jezo.errors).toEqual([])
  })
})

test.describe("the agent's thinking, saved", () => {
  test.use({ prepare: { model: null, workspace: (root) => seed(root, false, false, true) } })
  test('folds each stretch of thinking and steps where it happened, and opens to them in order', async ({ jezo }, info) => {
    const { page } = jezo
    await page.getByRole('button', { name: /想給我看/ }).click()
    const message = page.locator('main [data-chat-message="assistant"]')
    const folds = message.getByRole('button', { name: /^想了一下/ })
    await expect(folds).toHaveCount(2)
    // A message is thought, then said, then a tool call: the call folds with the thinking after it.
    await expect(folds.nth(0)).toHaveText('想了一下')
    await expect(folds.nth(1)).toHaveText('想了一下 · 看了 1 個檔案')
    // What the agent said between the two stretches sits between their folds.
    const order = await message.evaluate((root) => [...root.querySelectorAll('button, [data-selectable]')].map((el) => el.textContent?.trim()).filter((text) => /想了一下|我先看看|今天只有晨跑/.test(text ?? '')))
    expect(order).toEqual(['想了一下', '我先看看你今天的待辦。', '想了一下 · 看了 1 個檔案', '今天只有晨跑。'])
    // With the steps spread over folds, the run's total is under it.
    await expect(message.locator('[data-run-summary]')).toHaveText('這輪看了 1 個檔案')
    // Nothing of the thinking shows until a fold is opened; then it's there, in the order it happened.
    await expect(page.locator('main [data-thought]')).toHaveCount(0)
    await folds.nth(1).click()
    const work = message.locator('[data-work]')
    await expect(work).toHaveCount(1)
    await expect(work.locator('[data-step="read"]')).toHaveText('讀 todos/items/t-1.md')
    await expect(work.locator('[data-tool-output]')).toHaveText('TOOL-OUTPUT-晨跑')
    await expect(work.locator('[data-thought]')).toHaveText('只有一件：晨跑。\n可以直接回答。')
    expect(await work.evaluate((el) => [...el.children].map((child) => child.querySelector('[data-step]') ? 'step' : child.hasAttribute('data-thought') ? 'thought' : '?'))).toEqual(['step', 'thought'])
    await folds.nth(0).click()
    await expect(message.locator('[data-work]').first().locator('[data-thought]')).toHaveText('用戶想知道今天的安排。\n先讀今天的待辦。')
    await artifact(page, info, 'thinking-folds')
    expect(jezo.errors).toEqual([])
  })
})

test.describe('a reply cut off by its length', () => {
  test.use({ prepare: { model: null, workspace: (root) => seed(root, false, true) } })
  test('says so, and offers to answer again', async ({ jezo }) => {
    const { page } = jezo
    await page.getByRole('button', { name: /想太久/ }).click()
    await expect(page.locator('main [data-cut-off]')).toContainText('還沒寫完就停了')
    await expect(page.getByRole('button', { name: '重新回答' })).toBeVisible()
    expect(jezo.errors).toEqual([])
  })
})

test.describe('Jezo cards', () => {
  test.setTimeout(300_000)
  test.use({ prepare: { model: null, workspace: (root) => {
    seed(root, true)
    writeSortSession(root, [{ note: 'n-1', as: 'todo', title: '回房東訊息，問冷氣什麼時候修' }])
  } } })
  test('plan, ask_user and registered note proposals still work', async ({ jezo }, info) => {
    const { page, read, items } = jezo
    await page.getByRole('button', { name: /卡片測試/ }).click()
    await expect(page.getByText('明天的小計畫')).toBeVisible()
    await page.getByRole('button', { name: '好，就這樣', exact: true }).click()
    await expect.poll(() => read('todos/items/t-2.md').data.state).toBe('open')
    await page.getByRole('button', { name: '先做這件', exact: true }).click()
    await expect(page.locator('main [data-chat-message="user"]').last()).toContainText('先做這件')
    await expect(page.getByRole('button', { name: '換一件', exact: true })).toHaveCount(0)
    await idle(page)
    await artifact(page, info, 'plan-and-answer')
    // The same plugin view and decision flow used by agent.spec.ts.
    await page.getByRole('button', { name: /整理隨手記/ }).click()
    await page.getByRole('button', { name: '好', exact: true }).first().click()
    await expect.poll(() => read('notes/items/n-1.md').data.state).toBe('sorted')
    expect(items('todos').some((t) => t.data.title === '回房東訊息，問冷氣什麼時候修')).toBe(true)
    await artifact(page, info, 'note-proposal')
    expect(jezo.errors).toEqual([])
  })
})

test.describe('live pi chat', () => {
  test.setTimeout(600_000)
  test.beforeEach(async () => { test.skip(!(await localModel()), 'No local model server (LM Studio or Ollama) is running.') })

  test('shows what the model is thinking while it thinks, then folds it where it happened', async ({ jezo }, info) => {
    const { page } = jezo
    const box = page.locator('main textarea').first()
    await box.fill('我今天有哪些待辦？先查再回答。')
    await box.press('Enter')
    // While it works, a fold says so: thinking with its latest line, or the step running.
    await expect(page.locator('main [data-chat-message="assistant"]').getByRole('button', { name: /^(正在想|正在)/ }).first()).toBeVisible({ timeout: 120_000 })
    await idle(page)
    const message = page.locator('main [data-chat-message="assistant"]').first()
    const folds = message.getByRole('button', { name: /^想了一下/ })
    await expect(folds.first()).toBeVisible()
    await expect(message.getByRole('button', { name: /^正在/ })).toHaveCount(0)
    // It looked the todos up, and that step sits in a fold with the thinking around it.
    await expect(message.getByRole('button', { name: /看了 \d+ 個檔案|做了 \d+ 件事/ }).first()).toBeVisible()
    for (const fold of await folds.all()) await fold.click()
    expect((await message.locator('[data-thought]').allInnerTexts()).join('').length).toBeGreaterThan(20)
    await expect(message.locator('[data-step="todos_list"]').first()).toBeVisible()
    await artifact(page, info, 'thinking-live-run')
    expect(jezo.errors).toEqual([])
  })

  test('queues, retries, switches the continuation, edits and stops', async ({ jezo }, info) => {
    const { page, root } = jezo
    const box = page.locator('main textarea').first()
    await box.fill('不要使用工具。寫一篇 800 字的中文短文，主題是整理書桌。')
    await box.press('Enter')
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible({ timeout: 30_000 })
    // What the model says is up to it; a six-digit number is easy to check and unlikely to be skipped.
    await box.fill('不要使用工具。只回一個隨機的六位數字，別的都不要寫。')
    await box.press('Enter')
    await expect(page.locator('[data-pending-messages]')).toContainText('六位數字')
    await idle(page)
    const answers = page.locator('main [data-chat-message="assistant"] [data-selectable]')
    await expect(answers).toHaveCount(2)
    expect((await answers.nth(0).innerText()).length).toBeGreaterThan(200)
    await expect(answers.nth(1)).toContainText(/\d{6}/)
    const firstAnswer = await answers.last().innerText()
    const workspaceBefore = readdirSync(join(root, 'todos/items')).sort().map((name) => readFileSync(join(root, 'todos/items', name), 'utf8'))

    await page.getByRole('button', { name: '重新回答' }).last().click()
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible()
    await idle(page)
    const versions = page.locator('main [data-chat-message="assistant"] [data-branch-picker]').last()
    await expect(versions).toContainText('2/2')
    await versions.getByRole('button', { name: '上一個版本' }).click()
    await expect(versions).toContainText('1/2')
    await expect(answers.last()).toHaveText(firstAnswer)
    expect(readdirSync(join(root, 'todos/items')).sort().map((name) => readFileSync(join(root, 'todos/items', name), 'utf8'))).toEqual(workspaceBefore)
    await artifact(page, info, 'retry-original-version')

    await page.getByRole('button', { name: '編輯訊息' }).first().click()
    await page.locator('[data-chat-edit] textarea').fill('不要使用工具。17 加 25 等於多少？只回數字。')
    await page.getByRole('button', { name: '儲存並送出' }).click()
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible()
    await idle(page)
    await expect(page.locator('main [data-chat-message="user"] [data-branch-picker]').first()).toContainText('2/2')
    await expect(answers.last()).toContainText('42')
    await expect(page.locator('main')).not.toContainText(firstAnswer)
    // Back to the first version of the message: its conversation comes back, and the edit's is gone.
    await page.getByRole('button', { name: '上一個版本' }).first().click()
    await expect(page.locator('main [data-chat-message="user"]').first()).toContainText('整理書桌')
    await expect(page.locator('main')).not.toContainText('17 加 25')
    await expect(answers).toHaveCount(2)

    await box.fill('不要使用工具。寫一篇 10000 字的長篇小說，一直寫下去。')
    await box.press('Enter')
    await expect(page.getByRole('button', { name: '停下來' })).toBeVisible()
    // Stop once the story is streaming in.
    await expect(answers).toHaveCount(3, { timeout: 120_000 })
    await page.getByRole('button', { name: '停下來' }).click()
    await idle(page)
    // The real JSONL is the branch artifact, alongside the screenshot/workspace.
    const sessions = readdirSync(join(root, 'sessions')).filter((name) => name.endsWith('.jsonl'))
    await info.attach('pi-session', { body: readFileSync(join(root, 'sessions', sessions[0])), contentType: 'application/jsonl' })
    await artifact(page, info, 'stopped-branch')
    expect(jezo.errors).toEqual([])
  })
})
