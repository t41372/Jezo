// The main process, loaded by index.ts once the environment is set.

import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, type BrowserWindowConstructorOptions } from 'electron'
import type { ThemeSource } from '../shared/bridge'
import { AgentHost } from './agent/host'
import { serveAgent } from './agent/ipc'
import { createMemory, serveMemory } from './agent/memory'
import { Providers } from './agent/providers'
import { Schedule, setLanguage } from './agent/schedule'
import { modelJudge, OutsideContent } from './agent/outside'
import { snapshot } from './agent/shell'
import { historyFile, UndoLog } from './agent/undo'
import { Calendars } from './calendar/calendars'
import { serveCalendars } from './calendar/ipc'
import { getConfig } from './config'
import { inBackground } from './env'
import { registerQuickKey, unregisterQuickKey } from './hotkey'
import { createQuickWindow, endVoice, hideQuick, resizeQuick, startVoice, toggleTyping } from './quick'
import { serveSpeech } from './speech/ipc'
import { Speech } from './speech/speech'
import { registerFileScheme, serveFiles } from './workspace/attachments'
import { serveWorkspace } from './workspace/ipc'
import { seedWorkspace } from './workspace/seed'
import { checkZone, deviceZone, watchZone } from './clock'
import { Workspace } from './workspace/workspace'
import { installer } from './install/installer'


// Before the app is ready: the windows load workspace files, like images in notes, from this scheme.
registerFileScheme()

const QUICK_KEY = 'Alt+X'

let mainWindow: BrowserWindow | null = null
let canHold = false
/** The page the main window shows, as the user sees its title. */
let context: string | null = null

const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload: join(import.meta.dirname, '../preload/index.cjs'),
}

// Glass on macOS and Windows, so the desktop shows through. Linux gets a solid window.
// On macOS, under-window and sidebar are nearly opaque; fullscreen-ui lets the colors through.
function glass(): BrowserWindowConstructorOptions {
  if (process.platform === 'darwin') {
    return { vibrancy: 'fullscreen-ui', visualEffectState: 'active', backgroundColor: '#00000000' }
  }
  if (process.platform === 'win32') {
    return { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
  }
  return {}
}

function load(window: BrowserWindow, page: 'index' | 'quick') {
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (!app.isPackaged && devUrl) {
    window.loadURL(`${devUrl}/${page}.html`)
  } else {
    window.loadFile(join(import.meta.dirname, `../renderer/${page}.html`))
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    show: false,
    // On macOS the traffic lights sit centered at the top of the 88 px icon rail.
    // They're 59 px wide on macOS 26 (measured), so this leaves about 15 px on each side.
    ...(process.platform === 'darwin' && { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 20 } }),
    ...glass(),
    webPreferences,
  })
  mainWindow.once('ready-to-show', () => (inBackground ? mainWindow?.showInactive() : mainWindow?.show()))
  // Links, like where to get an API key, open in the browser, not in a Jezo window.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    // The hidden ⌥X window would otherwise keep the app running on Windows and Linux.
    if (process.platform !== 'darwin') app.quit()
  })
  load(mainWindow, 'index')
}

ipcMain.on('theme:set', (_, source: ThemeSource) => {
  nativeTheme.themeSource = source
})
ipcMain.on('context:set', (_, pageTitle: string) => {
  context = pageTitle
})
ipcMain.handle('quick:can-hold', () => canHold)
ipcMain.on('quick:hide', hideQuick)
ipcMain.on('quick:resize', (_, height: number) => resizeQuick(height))
/** Brings the main window forward with a conversation open. */
function openSession(session: string) {
  const fresh = !mainWindow
  if (fresh) createMainWindow()
  const window = mainWindow!
  window.show()
  window.focus()
  // A window that was closed has to load its page before it can take the conversation.
  const deliver = () => window.webContents.send('session:open', session)
  if (fresh) window.webContents.once('did-finish-load', deliver)
  else deliver()
}

ipcMain.on('quick:continue', (_, session: string) => {
  hideQuick()
  openSession(session)
})
ipcMain.on('language:set', (_, language: string) => setLanguage(language))

let workspace: Workspace | null = null
let schedule: Schedule | null = null
let calendars: Calendars | null = null
let host: AgentHost | null = null
const speech = new Speech()

/** Opens the workspace, creating it on first run. The seeded skills follow the OS language. */
async function openWorkspace() {
  const { workspace: root } = getConfig()
  const language = app.getLocale().startsWith('zh') ? 'zh-TW' : 'en'
  await seedWorkspace(root, language)
  workspace = new Workspace(root)
  await workspace.open()
  await installer(workspace).open()
  const undo = new UndoLog(workspace, historyFile(app.getPath('userData')))
  // Shell commands Jezo was running when it last stopped: what they changed goes into 修改紀錄.
  await undo.recover(() => snapshot(workspace!.root))
  serveWorkspace(workspace, undo)
  serveFiles(workspace)
  const providers = new Providers()
  await providers.open()
  const memory = createMemory(workspace)
  await memory.load()
  serveMemory(memory)
  calendars = new Calendars(workspace)
  await calendars.open()
  serveCalendars(calendars)
  const outside = new OutsideContent(modelJudge(providers), join(app.getPath('userData'), 'outside.json'))
  host = new AgentHost(workspace, undo, providers, memory, calendars, outside)
  await host.open()
  schedule = new Schedule(workspace, host, providers, openSession)
  serveAgent(host, undo, providers, schedule)
  void schedule.start()
  serveSpeech(speech)
  // Start the speech server early, so the first hold of ⌥X doesn't wait for Python to start.
  setTimeout(() => void speech.start(), 3000)
  // The device may have moved to another zone (docs/design/time.md).
  ipcMain.handle('time:zone', () => deviceZone())
  watchZone()
  // File events can be missed; coming back to the app is a good moment to look again.
  app.on('browser-window-focus', () => {
    checkZone()
    // The check reads the files again first, so it never starts a run from a stale copy.
    if (schedule) void schedule.check({ rescan: true })
    else void workspace?.rescan()
    calendars?.refreshIfStale()
  })
}

// One Jezo per data folder: two would each run the 08:00 plan (docs/design/automations.md,
// "One scheduler"). The data folder is set before this (env.ts), so each test's own app is alone.
const alone = app.requestSingleInstanceLock()
if (!alone) app.quit()
app.on('second-instance', () => {
  if (!mainWindow) createMainWindow()
  mainWindow?.show()
  mainWindow?.focus()
})

app.whenReady().then(async () => {
  if (!alone) return
  // A packaged app gets its icon from the bundle; in development the Dock would show Electron's.
  if (!app.isPackaged) app.dock?.setIcon(join(import.meta.dirname, '../../build/icon.png'))
  try {
    await openWorkspace()
  } catch (error) {
    dialog.showErrorBox("Jezo can't open its workspace", `${getConfig().workspace}\n\n${String(error)}`)
    app.quit()
    return
  }
  // Started by the OS at login, Jezo stays in the background: automations run, and the Dock icon opens the window.
  if (!app.getLoginItemSettings().wasOpenedAtLogin) createMainWindow()
  createQuickWindow(
    {
      ...(process.platform === 'darwin'
        ? { vibrancy: 'popover', visualEffectState: 'active', backgroundColor: '#00000000', roundedCorners: true }
        : glass()),
      webPreferences,
    },
    (w) => load(w, 'quick'),
  )
  canHold = registerQuickKey(QUICK_KEY, {
    press: toggleTyping,
    holdStart: () => startVoice(context),
    holdEnd: endVoice,
  })

  app.on('activate', () => {
    if (!mainWindow) createMainWindow()
  })
})

let readyToQuit = false
let quitting = false
app.on('before-quit', (event) => {
  if (readyToQuit) return
  event.preventDefault()
  if (quitting) return
  quitting = true
  schedule?.stop()
  void Promise.all([host?.close(), workspace && installer(workspace).close()]).catch(console.error).finally(() => {
    readyToQuit = true
    app.quit()
  })
})

app.on('will-quit', () => {
  unregisterQuickKey()
  speech.stop()
  schedule?.stop()
  calendars?.close()
  workspace?.close()
})
