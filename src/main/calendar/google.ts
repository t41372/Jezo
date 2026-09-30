// Google Calendar with the user's own OAuth client (docs/design/calendar.md,
// "Google"). The user creates a Desktop client in their own Google Cloud
// project and pastes its id and secret; Jezo signs in with PKCE and a loopback
// redirect, keeps the tokens in the keychain, and talks to Google directly.
// Nothing passes through anyone else.

import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import type { CalendarEvent } from '../../shared/calendar'
import { getSecret, storeSecret } from '../secrets'

// Tests point these at a local server that answers the way Google does.
const AUTH = process.env.JEZO_GOOGLE_AUTH ?? 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN = process.env.JEZO_GOOGLE_TOKEN ?? 'https://oauth2.googleapis.com/token'
const API = process.env.JEZO_GOOGLE_API ?? 'https://www.googleapis.com/calendar/v3'
/** Reading calendars and their events. Jezo never changes them. */
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'

export interface GoogleClient {
  id: string
  secret: string
}

interface Tokens {
  access: string
  refresh: string
  /** When the access token stops working, in ms since the epoch. */
  expires: number
}

export interface GoogleCalendar {
  id: string
  name: string
  color?: string
  primary: boolean
}

/** Said when Google won't refresh the sign-in and the user has to connect again. */
export class GoogleSignedOut extends Error {}

const CLIENT = 'google:client'
const tokenName = (account: string) => `google:token:${account}`

export function googleClient(): GoogleClient | null {
  const stored = getSecret(CLIENT)
  return stored ? (JSON.parse(stored) as GoogleClient) : null
}

export async function setGoogleClient(client: GoogleClient | null) {
  await storeSecret(CLIENT, client ? JSON.stringify({ id: client.id.trim(), secret: client.secret.trim() }) : null)
}

const base64url = (buffer: Buffer) => buffer.toString('base64url')

async function tokenRequest(body: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const response = await fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await response.json().catch(() => ({}))) as Record<string, string>
  if (!response.ok) {
    const reason = [json.error, json.error_description].filter(Boolean).join(': ') || `${response.status}`
    if (json.error === 'invalid_grant') throw new GoogleSignedOut(reason)
    throw new Error(reason)
  }
  return json as unknown as { access_token: string; refresh_token?: string; expires_in: number }
}

/**
 * Signs in to one Google account in the browser and keeps its tokens. Resolves
 * to the account's email, which is also the id of its main calendar.
 */
/** What the browser tab says when Google sends the user back, in the app's language. */
export interface SignInPage {
  done: string
  failed: string
}

export async function signIn(client: GoogleClient, page: SignInPage): Promise<string> {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  const state = base64url(randomBytes(16))

  // Google sends the browser back to this port on 127.0.0.1 with the code.
  const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
    let redirect = ''
    const timer = setTimeout(() => finish(new Error('Nothing came back from Google within 10 minutes.')), 10 * 60_000)
    const finish = (result: Error | string) => {
      clearTimeout(timer)
      server.close()
      if (result instanceof Error) reject(result)
      else resolve({ code: result, redirect })
    }
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      // Browsers also ask for /favicon.ico; only the redirect with our state counts.
      if (url.pathname !== '/' || url.searchParams.get('state') !== state) return void res.writeHead(404).end()
      const error = url.searchParams.get('error')
      const message = error ? page.failed : page.done
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(`<!doctype html><meta charset="utf-8"><title>Jezo</title><p style="font:16px system-ui;margin:3em">${message}</p>`)
      if (error) finish(new Error(error === 'access_denied' ? 'You said no in Google’s window.' : error))
      else finish(url.searchParams.get('code') ?? '')
    })
    server.on('error', (error) => finish(error))
    server.listen(0, '127.0.0.1', () => {
      redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      const url = new URL(AUTH)
      url.search = new URLSearchParams({
        client_id: client.id,
        redirect_uri: redirect,
        response_type: 'code',
        scope: SCOPE,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        // A refresh token, so the user signs in once rather than every hour.
        access_type: 'offline',
        prompt: 'consent select_account',
      }).toString()
      void shell.openExternal(url.toString())
    })
  })

  const got = await tokenRequest({
    client_id: client.id,
    client_secret: client.secret,
    code: code.code,
    code_verifier: verifier,
    redirect_uri: code.redirect,
    grant_type: 'authorization_code',
  })
  if (!got.refresh_token) throw new Error('Google gave no refresh token.')
  const tokens: Tokens = { access: got.access_token, refresh: got.refresh_token, expires: Date.now() + got.expires_in * 1000 }
  const primary = (await request<{ id: string }>(tokens.access, '/calendars/primary')).id
  await storeSecret(tokenName(primary), JSON.stringify(tokens))
  return primary
}

export async function signOut(account: string) {
  await storeSecret(tokenName(account), null)
}

async function accessToken(account: string): Promise<string> {
  const stored = getSecret(tokenName(account))
  if (!stored) throw new GoogleSignedOut('This Mac has no sign-in for this account.')
  const tokens = JSON.parse(stored) as Tokens
  if (tokens.expires - 60_000 > Date.now()) return tokens.access
  const client = googleClient()
  if (!client) throw new GoogleSignedOut('The Google client is missing.')
  const got = await tokenRequest({ client_id: client.id, client_secret: client.secret, refresh_token: tokens.refresh, grant_type: 'refresh_token' })
  const next: Tokens = { access: got.access_token, refresh: got.refresh_token ?? tokens.refresh, expires: Date.now() + got.expires_in * 1000 }
  await storeSecret(tokenName(account), JSON.stringify(next))
  return next.access
}

async function request<T>(token: string, path: string, query: Record<string, string> = {}): Promise<T> {
  const url = new URL(API + path)
  url.search = new URLSearchParams(query).toString()
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) })
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } }
  if (!response.ok) throw new Error(json.error?.message ?? `${response.status} ${response.statusText}`)
  return json as T
}

export async function googleCalendars(account: string): Promise<GoogleCalendar[]> {
  const token = await accessToken(account)
  const calendars: GoogleCalendar[] = []
  let page: string | undefined
  do {
    const got = await request<{ items: { id: string; summary: string; summaryOverride?: string; backgroundColor?: string; primary?: boolean; hidden?: boolean }[]; nextPageToken?: string }>(
      token,
      '/users/me/calendarList',
      page ? { pageToken: page } : {},
    )
    for (const c of got.items ?? []) calendars.push({ id: c.id, name: c.summaryOverride ?? c.summary, color: c.backgroundColor, primary: !!c.primary })
    page = got.nextPageToken
  } while (page)
  return calendars
}

interface GoogleTime {
  date?: string
  dateTime?: string
}

interface GoogleEvent {
  id: string
  status?: string
  summary?: string
  location?: string
  description?: string
  htmlLink?: string
  recurringEventId?: string
  start: GoogleTime
  end: GoogleTime
}

/** Google keeps descriptions as a little HTML (links, line breaks); Jezo shows text. */
export function plainText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<a\s[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_, href: string, label: string) => (label && label !== href ? `${label} (${href})` : href))
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const pad = (n: number) => String(n).padStart(2, '0')
const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`

/** One calendar's events between two local dates (`to` exclusive), repeats expanded by Google. */
export async function googleEvents(account: string, calendar: string, from: string, to: string): Promise<Omit<CalendarEvent, 'calendar'>[]> {
  const token = await accessToken(account)
  const events: Omit<CalendarEvent, 'calendar'>[] = []
  let page: string | undefined
  do {
    const got = await request<{ items: GoogleEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(calendar)}/events`, {
      timeMin: new Date(`${from}T00:00`).toISOString(),
      timeMax: new Date(`${to}T00:00`).toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '2500',
      ...(page && { pageToken: page }),
    })
    for (const e of got.items ?? []) {
      if (e.status === 'cancelled') continue
      const allDay = !!e.start.date
      events.push({
        id: e.id,
        title: e.summary ?? '',
        start: allDay ? e.start.date! : local(new Date(e.start.dateTime!)),
        end: allDay ? (e.end.date ?? e.start.date!) : local(new Date(e.end.dateTime ?? e.start.dateTime!)),
        ...(allDay && { allDay: true }),
        ...(e.location && { location: e.location }),
        ...(e.description && { notes: plainText(e.description) }),
        ...(e.htmlLink && { url: e.htmlLink }),
        ...(e.recurringEventId && { repeats: true }),
      })
    }
    page = got.nextPageToken
  } while (page)
  return events
}
