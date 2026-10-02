// Google Calendar with the user's own OAuth client, end to end. Google itself
// can't be used in a test, so a local server answers the way Google's OAuth and
// Calendar API do (their documented request and response shapes), and checks
// what Jezo sends: PKCE, the client, the bearer token. Everything else is real:
// the GUI, the browser round trip to Jezo's loopback port, the keychain, the
// workspace files.
process.env.TZ = 'Asia/Taipei'

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { expect, open, test } from './jezo'

const pad = (n: number) => String(n).padStart(2, '0')
const day = (offset: number) => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const CLIENT = { id: '1234-test.apps.googleusercontent.com', secret: 'GOCSPX-test-secret' }
const ACCOUNT = 'tim@example.com'

/** What the fake Google saw and how it answers. */
const google = {
  challenges: new Map<string, string>(),
  grants: [] as string[],
  bearer: [] as string[],
  /** Short, so the first read after signing in already has to refresh. */
  expiresIn: 1,
  revoked: false,
  issued: 0,
}

let server: Server
let base: string

test.beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://x')
    const json = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    if (url.pathname === '/auth') {
      // The user signs in and agrees; Google sends the browser back with a code.
      const p = url.searchParams
      if (p.get('client_id') !== CLIENT.id || p.get('code_challenge_method') !== 'S256' || p.get('access_type') !== 'offline') return res.writeHead(400).end('bad request')
      google.challenges.set('code-1', p.get('code_challenge')!)
      return res.writeHead(302, { location: `${p.get('redirect_uri')}/?code=code-1&state=${p.get('state')}` }).end()
    }
    if (url.pathname === '/token') {
      let body = ''
      for await (const chunk of req) body += chunk
      const p = new URLSearchParams(body)
      google.grants.push(p.get('grant_type')!)
      if (p.get('client_id') !== CLIENT.id || p.get('client_secret') !== CLIENT.secret) return json(401, { error: 'invalid_client' })
      if (p.get('grant_type') === 'authorization_code') {
        const challenge = createHash('sha256').update(p.get('code_verifier') ?? '').digest('base64url')
        if (google.challenges.get(p.get('code') ?? '') !== challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE verification failed' })
        google.revoked = false
        return json(200, { access_token: `access-${++google.issued}`, refresh_token: 'refresh-1', expires_in: google.expiresIn, token_type: 'Bearer' })
      }
      if (google.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
      return json(200, { access_token: `access-${++google.issued}`, expires_in: google.expiresIn, token_type: 'Bearer' })
    }
    if (url.pathname.startsWith('/calendar/v3/')) {
      google.bearer.push(req.headers.authorization ?? '')
      if (!req.headers.authorization?.startsWith('Bearer access-')) return json(401, { error: { message: 'Invalid Credentials' } })
      const path = url.pathname.slice('/calendar/v3'.length)
      if (path === '/calendars/primary') return json(200, { id: ACCOUNT, summary: ACCOUNT })
      if (path === '/users/me/calendarList') {
        return json(200, {
          items: [
            { id: ACCOUNT, summary: ACCOUNT, summaryOverride: '我的', backgroundColor: '#7986cb', primary: true },
            { id: 'family@group.calendar.google.com', summary: 'Family', backgroundColor: '#33b679' },
          ],
        })
      }
      if (path === `/calendars/${encodeURIComponent(ACCOUNT)}/events`) {
        if (url.searchParams.get('singleEvents') !== 'true') return json(400, { error: { message: 'expected singleEvents' } })
        return json(200, {
          items: [
            // Google gives times with the event's own offset: 09:00 in Los Angeles is 00:00 or 01:00 the next day in Taipei.
            { id: 'la', summary: 'Call with LA', start: { dateTime: `${day(1)}T09:00:00-07:00` }, end: { dateTime: `${day(1)}T09:30:00-07:00` }, htmlLink: 'https://calendar.google.com/event?eid=la' },
            { id: 'dentist', summary: '牙醫', location: '台北市', start: { dateTime: `${day(3)}T19:00:00+08:00` }, end: { dateTime: `${day(3)}T20:00:00+08:00` },
              description: 'Bring the <b>card</b>.<br>Map: <a href="https://maps.example/x">here</a>' },
            { id: 'trip_20261001', recurringEventId: 'trip', summary: 'Ken 來台北', start: { date: day(3) }, end: { date: day(5) } },
            { id: 'gone', status: 'cancelled', summary: 'Cancelled', start: { dateTime: `${day(2)}T10:00:00+08:00` }, end: { dateTime: `${day(2)}T11:00:00+08:00` } },
          ],
        })
      }
      if (path === `/calendars/${encodeURIComponent('family@group.calendar.google.com')}/events`) {
        return json(200, { items: [{ id: 'dinner', summary: '家庭聚餐', start: { dateTime: `${day(5)}T18:00:00+08:00` }, end: { dateTime: `${day(5)}T20:00:00+08:00` } }] })
      }
    }
    res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  process.env.JEZO_GOOGLE_AUTH = `${base}/auth`
  process.env.JEZO_GOOGLE_TOKEN = `${base}/token`
  process.env.JEZO_GOOGLE_API = `${base}/calendar/v3`
})

test.afterAll(() => server.close())

test('Google Calendar with the user’s own client: set up, sign in, show, refresh, sign in again, remove', async ({ jezo }) => {
  const { app, page, root } = jezo
  const main = page.locator('main')
  const dataDir = jezo.data
  const accounts = () => (parseYaml(readFileSync(join(root, 'calendar/google.yaml'), 'utf8')) as { accounts: { id: string; hidden?: string[] }[] }).accounts

  // The test is the browser: it follows the sign-in page to where Google sends it back.
  await app.evaluate(({ shell }) => {
    shell.openExternal = async (url: string) => {
      await fetch(url)
    }
  })

  await open(page, '更多')
  await page.getByText('連接', { exact: true }).click()
  await main.getByRole('button', { name: '設定' }).click()
  const dialog = page.getByRole('dialog')
  // Every step links to where it's done at Google.
  await expect(dialog.getByRole('link')).toHaveCount(5)
  await expect(dialog).toContainText('正式版')
  await dialog.getByLabel('用戶端 ID').fill(CLIENT.id)
  await dialog.getByLabel('用戶端密鑰').fill(CLIENT.secret)
  await dialog.getByRole('button', { name: '連接 Google 帳號' }).click()
  await expect(dialog).toBeHidden()
  await expect(main.getByText(ACCOUNT)).toBeVisible()
  await expect(main.getByText('我的', { exact: true })).toBeVisible()
  await expect(main.getByText('Family', { exact: true })).toBeVisible()

  // The account is the user's, in the workspace; the client and the sign-in are only in the keychain.
  expect(accounts()).toEqual([{ id: ACCOUNT }])
  const workspaceText = readFileSync(join(root, 'calendar/google.yaml'), 'utf8')
  for (const secret of [CLIENT.secret, 'refresh-1', 'access-']) expect(workspaceText).not.toContain(secret)
  const keys = JSON.parse(readFileSync(join(dataDir, 'keys.json'), 'utf8')) as Record<string, string>
  expect(Object.keys(keys)).toEqual(expect.arrayContaining(['google:client', `google:token:${ACCOUNT}`]))
  expect(JSON.stringify(keys)).not.toContain('refresh-1')
  expect(google.grants[0]).toBe('authorization_code')

  // The events, at the right local times, with the description as text.
  await open(page, '行事曆')
  const detail = async (title: string) => {
    await main.getByText(title, { exact: true }).first().click()
    const panel = page.locator('aside, [data-slot="detail-panel"]').filter({ hasText: title }).first()
    await expect(panel).toBeVisible()
    return panel
  }
  const la = new Date(`${day(1)}T09:00:00-07:00`)
  await expect(await detail('Call with LA')).toContainText(`${pad(la.getHours())}:00 – `)
  const dentist = await detail('牙醫')
  await expect(dentist).toContainText('19:00 – 20:00')
  await dentist.getByText('說明').click()
  await expect(dentist).toContainText('Bring the card.')
  await expect(dentist).toContainText('here (https://maps.example/x)')
  await expect(dentist).not.toContainText('<b>')
  await expect(await detail('Ken 來台北')).toContainText('全天')
  await page.getByRole('button', { name: '關閉' }).click()
  await expect(main.getByText('Cancelled', { exact: true })).toHaveCount(0)
  await expect(main.getByText('家庭聚餐', { exact: true })).toHaveCount(1)

  // Hiding one calendar of the account.
  await open(page, '更多')
  await page.getByText('連接', { exact: true }).click()
  await main.getByRole('switch', { name: '顯示「Family」' }).click()
  await expect.poll(() => accounts()[0].hidden).toEqual(['family@group.calendar.google.com'])
  await open(page, '行事曆')
  await expect(main.getByText('家庭聚餐', { exact: true })).toHaveCount(0)

  // An expired access token is refreshed on the next read, without the user.
  await page.evaluate(() => window.jezo.calendar.refresh())
  expect(google.grants.slice(1).length).toBeGreaterThan(0)
  expect(google.grants.slice(1).every((g) => g === 'refresh_token')).toBe(true)
  expect(google.bearer.every((b) => b.startsWith('Bearer access-'))).toBe(true)

  // Revoked (or a project left in testing, after 7 days): the row says so, and connecting again fixes it.
  google.revoked = true
  await page.evaluate(() => window.jezo.calendar.refresh())
  await expect(main).toContainText(`${ACCOUNT} 讀不到`)
  await expect(main.getByText('牙醫', { exact: true })).toHaveCount(1)
  await open(page, '更多')
  await page.getByText('連接', { exact: true }).click()
  await expect(main).toContainText('要重新連接')
  await main.getByRole('button', { name: '重新連接' }).click()
  await expect(main).not.toContainText('要重新連接')

  // Removing the account removes its sign-in and its copy; the client stays for the next account.
  await main.locator('div').filter({ hasText: ACCOUNT }).filter({ has: page.getByRole('button', { name: '移除' }) }).last().getByRole('button', { name: '移除' }).click()
  await expect.poll(() => accounts()).toEqual([])
  await expect.poll(() => Object.keys(JSON.parse(readFileSync(join(dataDir, 'keys.json'), 'utf8')))).not.toContain(`google:token:${ACCOUNT}`)
  expect(Object.keys(JSON.parse(readFileSync(join(dataDir, 'keys.json'), 'utf8')))).toContain('google:client')
  expect(readdirSync(join(dataDir, 'calendar')).filter((f) => f.startsWith('google-'))).toEqual([])
  await open(page, '行事曆')
  await expect(main.getByText('牙醫', { exact: true })).toHaveCount(0)
  expect(existsSync(join(root, 'calendar/google.yaml'))).toBe(true)
  expect(jezo.errors).toEqual([])
})
