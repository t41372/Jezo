// The languages (docs/design/frontend.md, "Translation"): a new install on a
// Mac set to Simplified Chinese starts in Simplified, its new workspace's
// skills and automations included, and 设置 switches between all three. The
// app is launched on its own here, with an empty workspace, since the shared
// fixture writes one in Traditional Chinese.

import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'
import { parse } from '../src/main/workspace/frontmatter'

const repo = join(import.meta.dirname, '..')

test('a Mac in Simplified Chinese gets the app and a new workspace in Simplified, and 设置 switches languages', async ({}, info) => {
  const dir = mkdtempSync(join(tmpdir(), 'jezo-e2e-'))
  const root = join(dir, 'workspace')
  mkdirSync(join(dir, 'data'), { recursive: true })
  const app = await electron.launch({
    executablePath: createRequire(join(repo, 'package.json'))('electron') as string,
    // --lang is the system language as Chromium and app.getLocale() see it.
    args: [join(repo, 'out/main/index.js'), '--lang=zh-CN'],
    env: { ...process.env, JEZO_WORKSPACE: root, JEZO_USER_DATA: join(dir, 'data'), JEZO_IN_BACKGROUND: '1' },
  })
  try {
    let page = app.windows().find((w) => w.url().includes('/index.html'))
    while (!page) {
      await app.waitForEvent('window')
      page = app.windows().find((w) => w.url().includes('/index.html'))
    }
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    const nav = page.locator('nav button')

    // Following the system: Simplified, in the rail and in the new workspace's own files.
    await expect(nav.filter({ hasText: '日历' })).toHaveCount(1)
    await expect(nav.filter({ hasText: '设置' })).toHaveCount(1)
    expect(parse(readFileSync(join(root, 'automations/items/a-morning.md'), 'utf8')).data.name).toBe('早上安排')
    expect(readFileSync(join(root, 'skills/if-then-plans/SKILL.md'), 'utf8')).toContain('把目标拆成「什么时候做什么」')
    expect(readFileSync(join(root, 'experiments/skills/small-experiments/SKILL.md'), 'utf8')).toContain('小实验')

    // Dates are in Simplified too: 周一, where Traditional writes 週一.
    await nav.filter({ hasText: '日历' }).click()
    await expect(page.locator('main').getByText('周一', { exact: true })).toBeVisible()
    await expect(page.locator('main').getByText('週一', { exact: true })).toHaveCount(0)

    // 设置 switches between the three, each named in its own language.
    await nav.filter({ hasText: '设置' }).click()
    const pick = (group: string, language: string) => page.getByRole('group', { name: group }).getByRole('button', { name: language, exact: true }).click()
    await pick('语言', 'English')
    await expect(nav.filter({ hasText: 'Settings' })).toHaveCount(1)
    await pick('Language', '繁體中文')
    await expect(nav.filter({ hasText: '設定' })).toHaveCount(1)
    await pick('語言', '简体中文')
    await expect(nav.filter({ hasText: '设置' })).toHaveCount(1)
    await info.attach('settings', { body: await page.screenshot(), contentType: 'image/png' })
    expect(errors).toEqual([])
  } finally {
    await app.close()
  }
})
