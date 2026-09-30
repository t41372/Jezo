// Methods through the real GUI, files, provenance and undo. Only GitHub is
// replaced by a local server; the parser still reads a real tar.gz archive.

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { SkillOrigin } from '../src/shared/skills'
import { expect, open, test } from './jezo'
import { SKILL_ADDRESS, skillMarkdown, skillServer } from './skill-server'

let github: Awaited<ReturnType<typeof skillServer>>
test.beforeAll(async () => {
  github = await skillServer()
  process.env.JEZO_GITHUB_API = github.base
  process.env.JEZO_GITHUB_CODELOAD = github.base
})
test.afterAll(() => {
  github.close()
  delete process.env.JEZO_GITHUB_API
  delete process.env.JEZO_GITHUB_CODELOAD
})

test('adding, replacing, writing, removing and updating methods keeps their files and source', async ({ jezo }) => {
  const { app, page, root } = jezo
  const main = page.locator('main')
  const origins = () => (parseYaml(readFileSync(join(root, 'skills/installed.yaml'), 'utf8')) as { skills: SkillOrigin[] }).skills
  const manifest = join(root, 'skills/next-step/SKILL.md')
  await open(page, '更多')
  await main.getByText('它用的方法', { exact: true }).click()
  const add = async () => {
    await main.getByRole('button', { name: '新增方法' }).click()
    return page.getByRole('dialog')
  }
  const find = async (address: string) => {
    const dialog = await add()
    await dialog.getByLabel('網址', { exact: true }).fill(address)
    await dialog.getByRole('button', { name: '找方法' }).click()
    return dialog
  }
  const finish = async () => {
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('方法已開啟')
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
    await expect(dialog).toBeHidden()
  }

  let dialog = await find('https://github.com/o/r/issues')
  await expect(dialog).toContainText('Use a GitHub repository')
  await dialog.getByRole('button', { name: '先不要' }).click()
  expect(existsSync(join(root, 'skills/installed.yaml'))).toBe(false)

  dialog = await find(SKILL_ADDRESS)
  await expect(dialog.getByRole('checkbox')).toHaveCount(2)
  for (const checkbox of await dialog.getByRole('checkbox').all()) await expect(checkbox).toBeChecked()
  await dialog.getByRole('checkbox', { name: /另一個方法/ }).uncheck()
  await expect(dialog).toContainText('path leaves the skill directory')
  await dialog.getByRole('button', { name: '安裝', exact: true }).click()
  await finish()

  expect(readFileSync(manifest, 'utf8')).toContain('Version 1')
  expect(readFileSync(join(root, 'skills/next-step/scripts/run.sh'), 'utf8')).toContain('echo next')
  expect([...readFileSync(join(root, 'skills/next-step/picture.bin'))]).toEqual([0, 255, 128, 42])
  expect(origins()).toEqual([expect.objectContaining({ name: 'next-step', source: SKILL_ADDRESS, ref: 'main', path: 'methods/next-step', by: 'user', binary: ['picture.bin'] })])
  expect(origins()[0].hash).toBe(createHash('sha256').update(readFileSync(manifest)).digest('hex'))
  expect(existsSync(join(root, 'skills/other-method'))).toBe(false)
  expect(github.requests).toContain('/repos/o/r')
  expect(github.requests).toContain('/o/r/tar.gz/main')
  await expect(main).toContainText('來自 github.com/o/r')
  await expect(main.getByRole('switch', { name: '下一步方法' })).toBeChecked()
  await main.getByRole('button', { name: /下一步方法/ }).click()
  await expect(main).toContainText('這個方法附了程式。Jezo 的 agent 目前不能執行程式')
  await main.getByRole('button', { name: '← 它用的方法' }).click()

  // The second install writes nothing until replacement is agreed to.
  dialog = await find(`${SKILL_ADDRESS}/blob/main/methods/next-step/SKILL.md`)
  await expect(dialog.getByRole('checkbox')).toHaveCount(1)
  await dialog.getByRole('button', { name: '安裝', exact: true }).click()
  await expect(dialog).toContainText('取代「下一步方法」？')
  await dialog.getByRole('button', { name: '取代', exact: true }).click()
  await finish()
  expect(origins()).toHaveLength(1)

  dialog = await add()
  await dialog.getByRole('button', { name: '自己寫' }).click()
  await dialog.getByLabel('名稱', { exact: true }).fill('My Method')
  await dialog.getByLabel('一句話說明').fill('先做一件事。')
  await dialog.getByLabel('內容', { exact: true }).fill('每天先找一件能做完的事。')
  await dialog.getByRole('button', { name: '安裝', exact: true }).click()
  await finish()
  expect(jezo.read('skills/my-method/SKILL.md').data.name).toBe('my-method')
  expect(origins().find((s) => s.name === 'my-method')).toMatchObject({ source: 'written', by: 'user' })
  await expect(main.getByRole('switch', { name: 'My Method' })).toBeChecked()
  await expect(main).toContainText('你寫的')

  // Native folder selection is stubbed; reading and installing the folder is real.
  const local = mkdtempSync(join(tmpdir(), 'jezo-local-skill-'))
  mkdirSync(join(local, 'references'))
  writeFileSync(join(local, 'SKILL.md'), skillMarkdown('local-method', '本機方法'))
  writeFileSync(join(local, 'references/example.md'), 'A local reference.\n')
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
  }, local)
  dialog = await add()
  await dialog.getByRole('button', { name: '從這台電腦' }).click()
  await expect(dialog.getByRole('checkbox', { name: /本機方法/ })).toBeChecked()
  await dialog.getByRole('button', { name: '安裝', exact: true }).click()
  await finish()
  expect(readFileSync(join(root, 'skills/local-method/references/example.md'), 'utf8')).toBe('A local reference.\n')
  await expect(main).toContainText('來自這台電腦')

  // Removal includes provenance, and is a real undoable entry in 修改紀錄.
  await main.getByRole('button', { name: /My Method/ }).click()
  await main.getByRole('button', { name: '移除', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('可以在「修改紀錄」撤銷')
  await dialog.getByRole('button', { name: '移除', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(existsSync(join(root, 'skills/my-method/SKILL.md'))).toBe(false)
  expect(origins().some((s) => s.name === 'my-method')).toBe(false)
  await main.getByRole('button', { name: '← 更多' }).click()
  await main.getByText('修改紀錄', { exact: true }).click()
  await main.getByRole('button', { name: '撤銷' }).first().click()
  await expect.poll(() => existsSync(join(root, 'skills/my-method/SKILL.md'))).toBe(true)
  expect(origins().some((s) => s.name === 'my-method')).toBe(true)
  await main.getByRole('button', { name: '← 更多' }).click()
  await main.getByText('它用的方法', { exact: true }).click()

  // Updating uses the recorded ref and path, checks the current hash, and removes old files.
  await github.version(2)
  writeFileSync(manifest, readFileSync(manifest, 'utf8') + '\nMy own edits.\n')
  await main.getByRole('button', { name: /下一步方法/ }).click()
  await main.getByRole('button', { name: '更新', exact: true }).click()
  dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('你改過這個方法，更新會蓋掉你的修改。')
  expect(readFileSync(manifest, 'utf8')).toContain('My own edits.')
  await dialog.getByRole('button', { name: '更新', exact: true }).click()
  await finish()
  expect(readFileSync(manifest, 'utf8')).toContain('Version 2')
  expect(readFileSync(manifest, 'utf8')).not.toContain('My own edits.')
  expect(existsSync(join(root, 'skills/next-step/old.txt'))).toBe(false)
  expect(readFileSync(join(root, 'skills/next-step/new.txt'), 'utf8')).toContain('version two')
  expect(origins().find((s) => s.name === 'next-step')?.hash).toBe(createHash('sha256').update(readFileSync(manifest)).digest('hex'))

  for (const path of ['escape.txt', '../escape.txt', 'skills/escape.txt', 'skills/next-step/escape.txt']) expect(existsSync(join(root, path))).toBe(false)
  expect(jezo.errors).toEqual([])
})
