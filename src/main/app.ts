// The main process, loaded by index.ts once the environment is set.

import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, type BrowserWindowConstructorOptions } from 'electron'
import type { ThemeSource } from '../shared/bridge'
import { AgentHost } from './agent/host'
import { serveAgent } from './agent/ipc'
import { historyFile, UndoLog } from './agent/undo'
import { getConfig } from './config'
import { registerQuickKey, unregisterQuickKey } from './hotkey'
import { createQuickWindow, endVoice, hideQuick, startVoice, toggleTyping } from './quick'
import { serveSpeech } from './speech/ipc'
import { Speech } from './speech/speech'
import { serveWorkspace } from './workspace/ipc'
import { seedWorkspace } from './workspace/seed'
import { Workspace } from './workspace/workspace'


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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
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
ipcMain.on('quick:continue', (_, session: string) => {
  hideQuick()
  const fresh = !mainWindow
  if (fresh) createMainWindow()
  const window = mainWindow!
  window.show()
  window.focus()
  // A window that was closed has to load its page before it can take the text.
  const deliver = () => window.webContents.send('quick:continued', session)
  if (fresh) window.webContents.once('did-finish-load', deliver)
  else deliver()
})

let workspace: Workspace | null = null
const speech = new Speech()

/** Opens the workspace, creating it on first run. The seeded skills follow the OS language. */
async function openWorkspace() {
  const { workspace: root } = getConfig()
  await seedWorkspace(root, app.getLocale().startsWith('zh') ? 'zh-TW' : 'en')
  workspace = new Workspace(root)
  await workspace.open()
  serveWorkspace(workspace)
  const undo = new UndoLog(workspace, historyFile(app.getPath('userData')))
  const host = new AgentHost(workspace, undo, () => getConfig().model)
  await host.open()
  serveAgent(host, undo)
  serveSpeech(speech)
  // Start the speech server early, so the first hold of ⌥X doesn't wait for Python to start.
  setTimeout(() => void speech.start(), 3000)
  // File events can be missed; coming back to the app is a good moment to look again.
  app.on('browser-window-focus', () => void workspace?.rescan())
}

app.whenReady().then(async () => {
  try {
    await openWorkspace()
  } catch (error) {
    dialog.showErrorBox("Jezo can't open its workspace", `${getConfig().workspace}\n\n${String(error)}`)
    app.quit()
    return
  }
  createMainWindow()
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

app.on('will-quit', () => {
  unregisterQuickKey()
  speech.stop()
  workspace?.close()
})
