// A todo's details in its drawer: every field edits the file, the notes are a
// markdown editor that changes only what was edited, and files added to the
// notes live in the workspace (docs/design/frontend.md, "Todo details").

import { deflateSync } from 'node:zlib'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, open, test } from './jezo'

const NOTES = [
  '要先問 Anna 哪個版本，再開始寫。',
  '',
  '- 列出 3 個案例',
  '  - 每個配一句數字',
  '- 寄給 [Anna 的 1:1](../../todos/items/t-3.md)',
  '',
  '* [ ] 確認截止日',
  '* [x] 找到舊稿',
  '',
  '**重點**：一頁以內。',
  '',
  '1. 開頭',
  '2. 結尾',
  '',
].join('\n')

/** A real 2×2 PNG, so the window has something to decode. */
function png() {
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4)
    const crc = Buffer.alloc(4)
    let c = ~0
    for (const byte of Buffer.concat([Buffer.from(type), data])) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    crc.writeUInt32BE(~c >>> 0)
    return Buffer.concat([head, data, crc])
  }
  const ihdr = Buffer.from([0, 0, 0, 2, 0, 0, 0, 2, 8, 2, 0, 0, 0])
  const pixels = deflateSync(Buffer.from([0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255, 255, 255, 0]))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', pixels), chunk('IEND', Buffer.alloc(0))])
}

test.use({
  prepare: {
    model: null,
    workspace: (root) => {
      const file = join(root, 'todos/items/t-1.md')
      writeFileSync(file, readFileSync(file, 'utf8').replace(/\n---\n[\s\S]*$/, `\n---\n${NOTES}`))
    },
  },
})

test('the drawer edits every field, the notes keep their markdown, and files go into the workspace', async ({ jezo }) => {
  const { page, read, root } = jezo
  const file = join(root, 'todos/items/t-1.md')
  await open(page, '行事曆')
  await page.locator('[data-slot=event-calendar-event]').filter({ hasText: '晨跑' }).last().click()
  const drawer = page.locator('aside')

  // The notes, as the agent wrote them; one word added changes one line of the file.
  const editor = drawer.locator('[data-editor] .ProseMirror')
  await expect(editor.locator('li')).toHaveCount(7)
  await editor.locator('p').first().click()
  await page.keyboard.press('End')
  await page.keyboard.type('今天')
  await drawer.getByRole('textbox', { name: '標題' }).click()
  await expect.poll(() => read('todos/items/t-1.md').body).toBe(NOTES.replace('再開始寫。', '再開始寫。今天'))

  // Title, cue and length are edited where they're shown.
  const title = drawer.getByRole('textbox', { name: '標題' })
  await title.fill('晨跑 6 km')
  await title.press('Enter')
  await expect.poll(() => read('todos/items/t-1.md').data.title).toBe('晨跑 6 km')
  const cue = drawer.getByRole('textbox', { name: '什麼時候' })
  await cue.fill('起床喝完水、換好鞋')
  await cue.press('Enter')
  await expect.poll(() => read('todos/items/t-1.md').data.cue).toBe('起床喝完水、換好鞋')
  await drawer.locator('[data-estimate-field]').click()
  await page.getByRole('button', { name: '45 分', exact: true }).click()
  await expect.poll(() => read('todos/items/t-1.md').data.estimate).toBe(45)

  // A new day from the month view, then a time: the user's own, so not a proposal.
  const scheduled = String(read('todos/items/t-1.md').data.scheduled)
  await drawer.locator('[data-slot-field]').click()
  const nextDay = new Date(`${scheduled.slice(0, 10)}T12:00`)
  nextDay.setDate(nextDay.getDate() + 1)
  await page.locator(`[data-day="${nextDay.toLocaleDateString('zh-TW')}"]`).click()
  await page.getByLabel('時間').fill('18:30')
  const day = `${nextDay.getFullYear()}-${String(nextDay.getMonth() + 1).padStart(2, '0')}-${String(nextDay.getDate()).padStart(2, '0')}`
  await expect.poll(() => read('todos/items/t-1.md').data.scheduled).toBe(`${day}T18:30[Asia/Taipei]`)
  expect(read('todos/items/t-1.md').data.proposed).toBeUndefined()
  await page.keyboard.press('Escape')

  // An image and a PDF: stored next to the todo, linked from its notes; the image shows, the PDF is listed.
  await drawer.locator('input[type=file]').setInputFiles([
    { name: '白板.png', mimeType: 'image/png', buffer: png() },
    { name: '報名表.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
  ])
  await expect.poll(() => read('todos/items/t-1.md').body).toContain('![白板.png](../attachments/t-1/%E7%99%BD%E6%9D%BF.png)')
  expect(read('todos/items/t-1.md').body).toContain('[報名表.pdf](../attachments/t-1/%E5%A0%B1%E5%90%8D%E8%A1%A8.pdf)')
  expect(readFileSync(join(root, 'todos/attachments/t-1/白板.png'))).toEqual(png())
  expect(existsSync(join(root, 'todos/attachments/t-1/報名表.pdf'))).toBe(true)
  await expect.poll(() => editor.locator('img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2)
  await expect(drawer.getByRole('list', { name: '附件' })).toContainText('報名表.pdf')

  // The file changes underneath, as when the agent edits it: the open editor shows the new notes.
  writeFileSync(file, readFileSync(file, 'utf8').replace('- 列出 3 個案例', '- 列出 4 個案例'))
  await expect(editor).toContainText('列出 4 個案例')
  expect(jezo.errors).toEqual([])
})
