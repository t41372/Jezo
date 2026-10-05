// The README's pictures, made the same way each time. After `bun run build`:
//
//   node scripts/screenshots.ts            (writes docs/screenshots/<language>/<shot>.jpg)
//   node scripts/screenshots.ts chat       (only the shots named)
//
// For each language the README comes in:
// 1. The sample workspace the E2E tests use (scripts/fixture.ts), written in that
//    language, with one conversation in it, so no one's own data is in them.
// 2. Each shot is taken from the built app with its glass left see-through.
// 3. It's laid over a painting from docs/screenshots/backdrops/, the way macOS
//    shows the window over a wallpaper: the painting behind the window blurred
//    and tinted like the fullscreen-ui material, with the window's corners,
//    shadow and traffic lights. A page in the same Electron draws it, so the blur
//    is Chromium's and nothing else needs installing.
//
// A new picture is an entry in SHOTS, a new language one in LANGUAGES and in
// CONVERSATION, and a new backdrop a JPEG in the backdrops folder. Buttons are
// found by the app's own strings, so changing a string doesn't break this.
//
// Speech recognition is the one thing not in the sample workspace: installing
// it takes minutes and a few GB. Its picture borrows the speech folder of the
// Jezo on this computer (in ~/Library/Application Support/jezo), and shows
// whichever engines are installed there; the README's was taken with
// std-mlx-audio and std-faster-whisper. The page only reads it. Without one,
// that picture is skipped.
// sky.jpg and rain.jpg were painted by OpenAI's image model through Codex (2026-10-02).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

type Theme = 'light' | 'dark'
type Language = 'en' | 'zh-CN'

const LANGUAGES: Language[] = ['en', 'zh-CN']

interface Shot {
  name: string
  theme: Theme
  /** A file in docs/screenshots/backdrops, without `.jpg`. */
  backdrop: string
  /** Gets the window to what the picture shows. */
  show: (page: Page, t: Strings) => Promise<void>
  /** Needs speech recognition installed in the Jezo on this computer. */
  speech?: true
}

/** The app's strings in the language being shot: a namespace (a plugin's id, or common) and a dotted key. */
type Strings = (ns: string, key: string) => string

const nav = (page: Page, t: Strings, plugin: string) => page.locator('nav button', { hasText: t(plugin, 'page.title') }).first().click()

// The light ones come first, so the theme changes once. The ones that show the
// plan as drafts come before the first that accepts it.
const SHOTS: Shot[] = [
  {
    name: 'chat',
    theme: 'light',
    backdrop: 'sky',
    show: async (page, t) => {
      await nav(page, t, 'chat')
      // The list shows the start of what was asked.
      await page.getByRole('button', { name: CONVERSATION[language].asked.slice(0, 12) }).first().click()
      await page.getByRole('button', { name: new RegExp(`^${t('chat', 'work.thought')}`) }).first().click()
    },
  },
  {
    name: 'todos',
    theme: 'light',
    backdrop: 'sky',
    show: async (page, t) => {
      await nav(page, t, 'todos')
      // The promo doc's first section: a draft, with the agent's reason and its steps.
      await page.getByText(/Impact/).first().click()
    },
  },
  {
    name: 'notes',
    theme: 'light',
    backdrop: 'sky',
    show: (page, t) => nav(page, t, 'notes'),
  },
  {
    name: 'goal',
    theme: 'light',
    backdrop: 'sky',
    show: async (page, t) => {
      await nav(page, t, 'goals')
      // The promo doc: its rules, open because the agent proposes to move one.
      await page.getByText(/Q4/).first().click()
    },
  },
  {
    name: 'speech',
    theme: 'light',
    backdrop: 'sky',
    speech: true,
    show: async (page, t) => {
      await nav(page, t, 'settings')
      await page.getByRole('button', { name: new RegExp(`^${t('settings', 'speech.title')}`) }).click()
      // The model ⌥X uses, with its capabilities, files and settings.
      await page.getByRole('heading', { name: SPEECH_MODEL.split('/')[1], level: 2 }).waitFor({ timeout: 60_000 })
      await page.getByText(t('settings', 'speech.reading')).first().waitFor({ state: 'detached', timeout: 60_000 })
      // The list scrolled to its end, so the engines after the first show too.
      await page.locator('nav').last().evaluate((list) => list.scrollTo(0, list.scrollHeight))
    },
  },
  {
    name: 'skill',
    theme: 'light',
    backdrop: 'sky',
    show: async (page, t) => {
      await more(page, t, 'skills')
      // A method Jezo comes with, as the file the agent reads.
      const title = /^\s+title: (.+)$/m.exec(readFileSync(join(repo, `resources/workspace.${language}/skills/if-then-plans/SKILL.md`), 'utf8'))![1]
      await page.getByText(title, { exact: true }).click()
    },
  },
  {
    name: 'today',
    theme: 'light',
    backdrop: 'sky',
    show: async (page, t) => {
      await acceptPlan(page, t)
      await nav(page, t, 'today')
    },
  },
  {
    name: 'calendar',
    theme: 'light',
    backdrop: 'sky',
    show: async (page, t) => {
      await acceptPlan(page, t)
      await nav(page, t, 'calendar')
    },
  },
  {
    name: 'installed',
    theme: 'dark',
    backdrop: 'rain',
    show: (page, t) => more(page, t, 'skills'),
  },
  {
    name: 'memory',
    theme: 'dark',
    backdrop: 'rain',
    show: (page, t) => more(page, t, 'memory'),
  },
]

/** Opens a section of 更多. */
async function more(page: Page, t: Strings, section: string) {
  await nav(page, t, 'more')
  await page.getByRole('button', { name: new RegExp(`^${t('more', `sections.${section}.title`)}`) }).click()
}

/** The morning's conversation in each language: what the user asked, what the agent thought, and what it said. */
const CONVERSATION: Record<Language, { asked: string; thoughts: [string, string, string]; plan: string; said: string }> = {
  en: {
    asked: 'Plan my day, I have a lot of meetings this afternoon.',
    thoughts: [
      'First what today already has, the backlog, and the goals\' rules.\nMeetings all afternoon, so the writing goes in the morning.',
      'The promo doc goes at 09:10, after coffee at work: 70 minutes, since the last 8 took 68 on average.\nThe gym is tied to walking out of the office, and only 20 minutes.',
      'Say why it\'s planned this way, in two or three sentences.',
    ],
    plan: 'Today',
    said: 'Writing is in the morning, before the meetings start; the gym is only 20 minutes, so it\'s easier to start. Have a look, and tell me what doesn\'t fit.',
  },
  'zh-CN': {
    asked: '帮我排今天，下午会议很多。',
    thoughts: [
      '先看今天已经排了什么、backlog，还有目标的规则。\n下午会议多，写东西的事要放早上。',
      '晋升文档照「到公司倒完咖啡」排 09:10，估 70 分：过去 8 次平均 68 分。\n健身房绑在下班走出大楼，只排 20 分钟。',
      '说明为什么这样排，两三句就好。',
    ],
    plan: '今天的安排',
    said: '写文档放在早上，趁会议还没开始；健身房只排 20 分钟，比较容易开始。你看一下，不合适的直接跟我说。',
  },
}

/** The window's size, as the user would have it. */
const WINDOW = { width: 1440, height: 900 }
/** The picture: the window with some of the painting around it, 16:10. */
const STAGE = { width: 1680, height: 1050 }

/**
 * What macOS does behind a fullscreen-ui window: a wide blur that keeps the
 * colors, and a light or dark tint. Matched by eye against the real window.
 */
const MATERIAL: Record<Theme, { filter: string; tint: string }> = {
  light: { filter: 'blur(30px) saturate(1.7) brightness(1.06)', tint: 'rgb(246 246 250 / 0.28)' },
  dark: { filter: 'blur(30px) saturate(1.5) brightness(0.8)', tint: 'rgb(22 20 34 / 0.38)' },
}

/** The speech folder of the Jezo on this computer, and the model the picture shows: the one a first install sets up. */
const SPEECH = join(homedir(), 'Library/Application Support/jezo/speech')
const SPEECH_MODEL = 'mlx-audio/qwen3-asr-0.6b'

const repo = join(import.meta.dirname, '..')
const out = join(repo, 'docs/screenshots')
const only = process.argv.slice(2)
const shots = (only.length ? SHOTS.filter((s) => only.includes(s.name)) : SHOTS).filter((s) => {
  if (s.speech && !existsSync(SPEECH)) console.log(`Skipping ${s.name}: speech recognition isn't installed in ${SPEECH}.`)
  return !s.speech || existsSync(SPEECH)
})
let language: Language = 'en'

for (language of LANGUAGES) {
  const t = strings(language)

  // ─── 1. The sample workspace, and the morning's conversation ───

  const dir = mkdtempSync(join(tmpdir(), 'jezo-screenshots-'))
  const root = join(dir, 'workspace')
  execFileSync('bun', ['scripts/fixture.ts', root], { cwd: repo, env: { ...process.env, JEZO_LANGUAGE: language } })
  // Automations would start runs of their own while the pictures are taken.
  for (const file of readdirSync(join(root, 'automations/items'))) {
    const path = join(root, 'automations/items', file)
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^state: on$/m, 'state: off'))
  }
  writeConversation(root, CONVERSATION[language])

  // ─── 2. The app ───

  mkdirSync(join(dir, 'data'), { recursive: true })
  if (shots.some((s) => s.speech)) {
    symlinkSync(SPEECH, join(dir, 'data/speech'))
    writeFileSync(join(dir, 'data/config.json'), JSON.stringify({ speech: { model: SPEECH_MODEL, models: {}, sources: {} } }))
  }
  const app = await electron.launch({
    executablePath: createRequire(join(repo, 'package.json'))('electron') as string,
    args: [join(repo, 'out/main/index.js')],
    env: { ...process.env, JEZO_WORKSPACE: root, JEZO_USER_DATA: join(dir, 'data'), JEZO_IN_BACKGROUND: '1' },
  })
  let page: Page | undefined
  while (!(page = app.windows().find((w) => w.url().includes('/index.html')))) await app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('/index.html'))!.setContentSize(size.width, size.height)
  }, WINDOW)
  const stage = await stagePage(app)

  mkdirSync(join(out, language), { recursive: true })
  let theme: Theme | null = null
  for (const shot of shots) {
    if (shot.theme !== theme) {
      theme = shot.theme
      await page.evaluate(([l, th]) => {
        localStorage.setItem('jezo.language', l)
        localStorage.setItem('jezo.theme', th)
      }, [language, theme])
      // Playwright answers prefers-color-scheme itself, over what the app sets in nativeTheme.
      await page.emulateMedia({ colorScheme: theme })
      await page.reload()
      await page.locator('nav button').first().waitFor()
    }
    await shot.show(page, t)
    // Off the page, so whatever was clicked last isn't shown hovered.
    await page.mouse.move(1, WINDOW.height / 2)
    // Lets the page settle: fonts, the fold opening, the rail's highlight moving.
    await page.waitForTimeout(800)
    await compose(stage, await page.screenshot({ omitBackground: true }), shot, join(out, language, `${shot.name}.jpg`))
  }
  await app.close()
  console.log(`docs/screenshots/${language}: ${shots.map((s) => `${s.name}.jpg`).join(', ')}`)
}

/** Looks up the app's own strings for a language, as i18next would. */
function strings(language: Language): Strings {
  const files: Record<string, Record<string, unknown>> = {}
  const load = (ns: string) => {
    const path = ns === 'common' ? 'src/renderer/src/locales' : `src/renderer/src/plugins/${ns}/locales`
    return (files[ns] ??= JSON.parse(readFileSync(join(repo, path, `${language}.json`), 'utf8')))
  }
  return (ns, key) => {
    const value = key.split('.').reduce<unknown>((at, part) => (at as Record<string, unknown>)?.[part], load(ns))
    if (typeof value !== 'string') throw new Error(`No string ${ns}:${key} in ${language}`)
    return value
  }
}

// ─── 3. Over the painting ───

/** A hidden window to draw the pictures in, the size of one. */
async function stagePage(app: ElectronApplication): Promise<Page> {
  const opened = app.waitForEvent('window')
  await app.evaluate(({ BrowserWindow }, size) => {
    void new BrowserWindow({ ...size, useContentSize: true, show: false }).loadURL('about:blank')
  }, STAGE)
  // A hidden window isn't laid out at its size, and draws at 1×; the page is twice the size and
  // zoomed 2× (in compose), so the window's own Retina pixels go into the picture as they are.
  const stage = await opened
  await stage.setViewportSize({ width: STAGE.width * 2, height: STAGE.height * 2 })
  return stage
}

async function compose(stage: Page, window: Buffer, shot: Shot, path: string) {
  const backdrop = readFileSync(join(out, 'backdrops', `${shot.backdrop}.jpg`)).toString('base64')
  const { filter, tint } = MATERIAL[shot.theme]
  const light = shot.theme === 'light'
  const button = (color: string, x: number) =>
    `<span style="position:absolute;left:${x}px;top:0;width:12px;height:12px;border-radius:50%;background:${color};box-shadow:inset 0 0 0 0.5px rgb(0 0 0 / 0.2)"></span>`
  await stage.setContent(`<!doctype html>
<body style="margin:0;overflow:hidden;zoom:2">
  <div style="position:relative;width:${STAGE.width}px;height:${STAGE.height}px;background:url(data:image/jpeg;base64,${backdrop}) center/cover">
    <div style="position:absolute;left:${(STAGE.width - WINDOW.width) / 2}px;top:${(STAGE.height - WINDOW.height) / 2}px;width:${WINDOW.width}px;height:${WINDOW.height}px;
      border-radius:12px;overflow:hidden;box-shadow:0 28px 70px rgb(0 0 0 / 0.38), 0 0 0 0.5px rgb(0 0 0 / ${light ? 0.18 : 0.6})">
      <div style="position:absolute;inset:0;backdrop-filter:${filter};background:${tint}"></div>
      <img src="data:image/png;base64,${window.toString('base64')}" style="position:absolute;inset:0;width:100%;height:100%">
      <div style="position:absolute;left:14px;top:20px">${button('#ff5f57', 0)}${button('#febc2e', 20)}${button('#28c840', 40)}</div>
      <div style="position:absolute;inset:0;border-radius:12px;box-shadow:inset 0 0 0 0.5px rgb(255 255 255 / ${light ? 0.55 : 0.14})"></div>
    </div>
  </div>
</body>`)
  await stage.waitForFunction(() => [...document.images].every((img) => img.complete))
  await stage.screenshot({ path, type: 'jpeg', quality: 88 })
}

// ─── The conversation ───

/** Accepts the plan the conversation proposed, once: the pictures after the chat show the day as planned. */
async function acceptPlan(page: Page, t: Strings) {
  await nav(page, t, 'today')
  const accept = page.getByRole('button', { name: t('common', 'plan.accept'), exact: true })
  if (await accept.count()) await accept.first().click()
}

/** The morning's conversation: what the agent thought and looked at, folded, and the plan it proposed. */
function writeConversation(root: string, words: (typeof CONVERSATION)[Language]) {
  const session = '01a0f000-0000-7000-8000-00000000000a'
  const at = new Date().toISOString()
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
  let parent: string | null = null
  let n = 0
  const lines: object[] = [{ type: 'session', version: 3, id: session, timestamp: at, cwd: root }]
  const append = (value: object) => {
    const id = `s${String(++n).padStart(7, '0')}`
    lines.push({ ...value, id, parentId: parent, timestamp: at })
    parent = id
  }
  const message = (value: object) => append({ type: 'message', message: { ...value, timestamp: Date.now() + n } })
  const assistant = (content: object[], stopReason = 'stop') => message({ role: 'assistant', content, stopReason, api: 'openai-completions', provider: 'lmstudio', model: 'local', usage })
  const thought = (thinking: string) => ({ type: 'thinking', thinking, thinkingSignature: 'reasoning_content' })
  append({ type: 'custom', customType: 'jezo.session', data: { trigger: 'user' } })
  message({ role: 'user', content: words.asked })
  assistant([thought(words.thoughts[0]), { type: 'toolCall', id: 'list', name: 'todos_list', arguments: {} }], 'toolUse')
  message({ role: 'toolResult', toolCallId: 'list', toolName: 'todos_list', content: [{ type: 'text', text: '6 todos: 1 done today, 5 in the backlog.' }], isError: false })
  assistant([thought(words.thoughts[1]), { type: 'toolCall', id: 'plan', name: 'todos_propose', arguments: { title: words.plan } }], 'toolUse')
  message({ role: 'toolResult', toolCallId: 'plan', toolName: 'todos_propose', content: [{ type: 'text', text: 'Proposed 5 todos as a plan.' }], isError: false, details: { card: { kind: 'plan', title: words.plan, todoIds: ['t-2', 't-3', 't-6', 't-5', 't-7'] } } })
  assistant([thought(words.thoughts[2]), { type: 'text', text: words.said }])
  mkdirSync(join(root, 'sessions'), { recursive: true })
  writeFileSync(join(root, 'sessions', `${at.replace(/[:.]/g, '-')}_${session}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}
