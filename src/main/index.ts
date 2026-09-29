import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, nativeTheme, type BrowserWindowConstructorOptions } from 'electron'
import type { QuickSubmission, ThemeSource } from '../shared/bridge'
import { registerQuickKey, unregisterQuickKey } from './hotkey'
import { createQuickWindow, endVoice, hideQuick, startVoice, toggleTyping } from './quick'

const QUICK_KEY = 'Alt+X'

let mainWindow: BrowserWindow | null = null
let canHold = false
/** The page the main window shows, as the user sees its title. */
let context: string | null = null

const webPreferences: BrowserWindowConstructorOptions['webPreferences'] = {
  preload: join(__dirname, '../preload/index.js'),
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
    window.loadFile(join(__dirname, `../renderer/${page}.html`))
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
ipcMain.on('quick:submit', (_, submission: QuickSubmission) => {
  hideQuick()
  const fresh = !mainWindow
  if (fresh) createMainWindow()
  const window = mainWindow!
  // A note is filed quietly; the user stays in whatever they were doing.
  if (submission.as === 'ask') {
    window.show()
    window.focus()
  }
  // A window that was closed has to load its page before it can take the text.
  const deliver = () => window.webContents.send('quick:submitted', submission)
  if (fresh) window.webContents.once('did-finish-load', deliver)
  else deliver()
})

app.whenReady().then(() => {
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

app.on('will-quit', unregisterQuickKey)
