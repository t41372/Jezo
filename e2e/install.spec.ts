import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { expect, open, test } from './jezo'
import { installServer, STDIO_SERVER } from './install-server'

let server: Awaited<ReturnType<typeof installServer>>
test.beforeAll(async () => {
  server = await installServer()
  process.env.JEZO_GITHUB_API = server.base
  process.env.JEZO_GITHUB_CODELOAD = server.base
  process.env.npm_config_registry = server.base
  process.env.npm_config_audit = 'false'
})
test.afterAll(() => {
  server.close()
  for (const name of ['JEZO_GITHUB_API', 'JEZO_GITHUB_CODELOAD', 'npm_config_registry', 'npm_config_audit']) delete process.env[name]
})

async function installedPage(page: Page) {
  await open(page, '更多')
  await page.locator('main').getByText('已安裝', { exact: true }).click()
}

async function install(page: Page, source: string) {
  await page.locator('main').getByRole('button', { name: '安裝', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('網址、指令或 JSON', { exact: true }).fill(source)
  await dialog.getByRole('button', { name: '查看內容' }).click()
  await expect(dialog.getByRole('checkbox').first()).toBeChecked()
  await expect(dialog).toContainText('下一個對話')
  await dialog.getByRole('button', { name: '安裝', exact: true }).click()
  await expect(dialog).toContainText('已安裝')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
}

test('stdio and HTTP MCP servers keep secrets in the keychain and appear in real sessions', async ({ jezo }, info) => {
  const { app, page, root } = jezo
  const data = await app.evaluate(({ app }) => app.getPath('userData'))
  const script = join(data, 'mcp-test.cjs')
  writeFileSync(script, STDIO_SERVER)
  const source = JSON.stringify({ mcpServers: { local_test: { command: 'node', args: [script], env: { INSTALL_TOKEN: 'literal-test-secret' }, exposure: 'direct' }, unchecked: { command: 'node', args: [script] } } })
  await installedPage(page)
  await page.locator('main').getByRole('button', { name: '安裝', exact: true }).click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('網址、指令或 JSON').fill(source)
  await dialog.getByRole('button', { name: '查看內容' }).click()
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  await dialog.getByRole('checkbox', { name: /unchecked/ }).uncheck()
  await dialog.getByRole('button', { name: '安裝', exact: true }).click()
  await dialog.getByRole('button', { name: '完成' }).click()

  const configFile = join(data, 'pi/mcp.json')
  const configText = readFileSync(configFile, 'utf8')
  expect(configText).not.toContain('literal-test-secret')
  const config = JSON.parse(configText)
  expect(config.mcpServers.unchecked).toBeUndefined()
  expect(config.mcpServers.local_test.jezo.by).toBe('user')
  const secretName = config.mcpServers.local_test.env.INSTALL_TOKEN.slice(2, -1)
  // The evaluated function runs in the main process, where dynamic import isn't available.
  const loaded = await app.evaluate(({ app, safeStorage }, name) => {
    const { readFileSync } = process.getBuiltinModule('node:fs')
    const { join } = process.getBuiltinModule('node:path')
    const keys = JSON.parse(readFileSync(join(app.getPath('userData'), 'keys.json'), 'utf8'))
    return safeStorage.decryptString(Buffer.from(keys[name], 'base64')) === 'literal-test-secret'
  }, secretName)
  expect(loaded).toBe(true)
  expect(readFileSync(join(data, 'keys.json'), 'utf8')).not.toContain('literal-test-secret')
  const stdioRow = page.locator('[data-installed-mcp="local_test"]')
  await expect(stdioRow).toContainText('已連線')
  await expect(stdioRow).toContainText('1 個工具')
  await stdioRow.getByText('查看工具').click()
  await expect(stdioRow).toContainText('echo')

  await install(page, `${server.base}/mcp`)
  const httpRow = page.locator('[data-installed-mcp="127-0-0-1"]')
  await expect(httpRow).toContainText('已連線')
  await expect(httpRow).toContainText('1 個工具')
  const session = await page.evaluate(() => window.jezo.agent.send(null, '列出現在可用的工具。'))
  await expect.poll(() => page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.tools ?? [], session)).toEqual(expect.arrayContaining(['mcp__local_test__echo', 'mcp__127-0-0-1__http_echo']))
  await page.evaluate((id) => window.jezo.agent.abort(id), session)

  expect(readFileSync(script + '.proof', 'utf8')).toBe('secret-loaded')

  await stdioRow.getByRole('switch').click()
  await expect(stdioRow).toContainText('停用')
  expect(JSON.parse(readFileSync(configFile, 'utf8')).mcpServers.local_test.enabled).toBe(false)
  await httpRow.getByRole('switch').click()
  await expect(httpRow).toContainText('停用')
  const disabledSession = await page.evaluate(() => window.jezo.agent.send(null, '列出工具。'))
  await expect.poll(() => page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.tools ?? [], disabledSession)).toContain('install_from_address')
  const disabledTools = await page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.tools ?? [], disabledSession)
  expect(disabledTools.some((name) => name.startsWith('mcp__'))).toBe(false)
  await page.evaluate((id) => window.jezo.agent.abort(id), disabledSession)
  for (const row of [stdioRow, httpRow]) {
    await row.getByRole('button', { name: '移除', exact: true }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: '移除', exact: true }).click()
    await expect(row).toBeHidden()
  }
  expect(JSON.parse(readFileSync(configFile, 'utf8')).mcpServers).toEqual({})
  expect(JSON.parse(readFileSync(join(data, 'keys.json'), 'utf8'))[secretName]).toBeUndefined()
  await info.attach('mcp-config', { path: configFile })
  expect(jezo.errors).toEqual([])
})

test('a GitHub pi package brings resources and its questions receive GUI answers', async ({ jezo }, info) => {
  test.setTimeout(120_000)
  const { app, page } = jezo
  const data = await app.evaluate(({ app }) => app.getPath('userData'))
  await installedPage(page)
  await install(page, 'https://github.com/o/package')
  const packagePath = join(data, 'pi/git/github.com/o/package')
  expect(existsSync(join(packagePath, 'extension.ts'))).toBe(true)
  expect(existsSync(join(packagePath, '.git'))).toBe(false)
  const settingsFile = join(data, 'pi/settings.json')
  const saved = JSON.parse(readFileSync(settingsFile, 'utf8'))
  expect(saved.packages[0]).toMatchObject({ source: 'git/github.com/o/package', jezo: { source: 'https://github.com/o/package', ref: 'main', by: 'user' } })
  const row = page.locator('[data-installed-package]')
  await row.getByText('3 個附帶資源').click()
  for (const resource of ['extension.ts', 'package-method', 'package-prompt.md']) await expect(row).toContainText(resource)

  const session = await page.evaluate(() => window.jezo.agent.send(null, '載入這個對話的工具。'))
  await open(page, '聊天')
  await page.evaluate((id) => window.jezo.quick.continue(id), session)
  const question = page.locator('[data-extension-question]').filter({ hasText: '啟用測試工具？' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: '同意', exact: true }).click()
  await page.locator('[data-extension-question]').filter({ hasText: '選一個測試選項' }).getByRole('button', { name: '第二個' }).click()
  const input = page.locator('[data-extension-question]').filter({ hasText: '輸入測試文字' })
  await input.getByRole('textbox').fill('這是 GUI 的回答')
  await input.getByRole('button', { name: '送出' }).click()
  await expect(page.getByText('測試套件收到回答', { exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.tools ?? [], session)).toContain('installation_echo')
  await page.evaluate((id) => window.jezo.agent.abort(id), session)
  const entries = await app.evaluate((_electron, dir) => {
    const { readdirSync, readFileSync } = process.getBuiltinModule('node:fs')
    const { join } = process.getBuiltinModule('node:path')
    return readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), 'utf8').trim().split('\n').map((line) => JSON.parse(line))).filter((e) => e.customType === 'install.confirm').map((e) => e.data)
  }, join(jezo.root, 'sessions'))
  expect(entries).toContainEqual({ allowed: true, selected: '第二個', input: '這是 GUI 的回答' })

  await installedPage(page)
  await row.getByRole('switch').click()
  await expect(row).toContainText('停用')
  const disabled = JSON.parse(readFileSync(settingsFile, 'utf8')).packages[0]
  for (const kind of ['extensions', 'skills', 'prompts', 'themes']) expect(disabled[kind]).toEqual([])
  const next = await page.evaluate(() => window.jezo.agent.send(null, '列出工具。'))
  await expect.poll(() => page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.tools ?? [], next)).toContain('install_from_address')
  expect(await page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.tools, next)).not.toContain('installation_echo')
  await page.evaluate((id) => window.jezo.agent.abort(id), next)
  await row.getByRole('switch').click()
  expect(JSON.parse(readFileSync(settingsFile, 'utf8')).packages[0].extensions).toBeUndefined()
  await row.getByRole('button', { name: '移除', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
  await expect(row).toBeHidden()
  expect(JSON.parse(readFileSync(settingsFile, 'utf8')).packages).toEqual([])
  expect(existsSync(packagePath)).toBe(false)
  await info.attach('pi-settings', { path: settingsFile })
  expect(jezo.errors).toEqual([])
})

test('npm packages use the bundled launcher and pi settings', async ({ jezo }, info) => {
  test.setTimeout(120_000)
  await installedPage(jezo.page)
  await install(jezo.page, 'npm:jezo-e2e-tools@1.0.0')
  const data = await jezo.app.evaluate(({ app }) => app.getPath('userData'))
  expect(existsSync(join(data, 'pi/npm/node_modules/jezo-e2e-tools/extension.ts'))).toBe(true)
  expect(await jezo.app.evaluate(() => process.env.ELECTRON_RUN_AS_NODE)).toBeUndefined()
  const settingsFile = join(data, 'pi/settings.json')
  expect(JSON.parse(readFileSync(settingsFile, 'utf8')).packages[0].source).toBe('npm:jezo-e2e-tools@1.0.0')
  await jezo.restart()
  await installedPage(jezo.page)
  const row = jezo.page.locator('[data-installed-package]')
  await row.getByRole('switch').click()
  await expect(row).toContainText('停用')
  await row.getByRole('button', { name: '移除', exact: true }).click()
  await jezo.page.getByRole('dialog').getByRole('button', { name: '移除', exact: true }).click()
  await expect(row).toBeHidden()
  expect(existsSync(join(data, 'pi/npm/node_modules/jezo-e2e-tools'))).toBe(false)
  await info.attach('pi-settings', { path: settingsFile })
  expect(jezo.errors).toEqual([])
})

test('the user can ask the local agent to install an MCP server', async ({ jezo }) => {
  test.setTimeout(240_000)
  const ready = await jezo.page.evaluate(async () => (await window.jezo.providers.choosable()).some((p) => p.provider === 'lmstudio' && p.model.loaded))
  test.skip(!ready, 'No local model is running.')
  const source = JSON.stringify({ mcpServers: { agent_http: { url: `${server.base}/mcp` } } })
  const id = await jezo.page.evaluate((source) => window.jezo.agent.send(null, `幫我裝這個 MCP：${source}`), source)
  const data = await jezo.app.evaluate(({ app }) => app.getPath('userData'))
  await expect.poll(() => {
    try { return JSON.parse(readFileSync(join(data, 'pi/mcp.json'), 'utf8')).mcpServers.agent_http.jezo.by } catch { return undefined }
  }, { timeout: 180_000 }).toBe('agent')
  await expect.poll(() => jezo.page.evaluate(async (id) => (await window.jezo.agent.list()).find((s) => s.id === id)?.running, id), { timeout: 180_000 }).not.toBe(true)
  expect(jezo.errors).toEqual([])
})
