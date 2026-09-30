// The calendars, for the windows: what's connected, the events in a range,
// and adding or hiding calendars (docs/design/calendar.md).

import { BrowserWindow, ipcMain, shell } from 'electron'
import type { Calendars } from './calendars'

export function serveCalendars(calendars: Calendars) {
  ipcMain.handle('calendar:status', () => calendars.status())
  ipcMain.handle('calendar:events', (_, from: string, to: string) => calendars.events(from, to))
  ipcMain.handle('calendar:subscribe', (_, url: string, name?: string) => calendars.subscribe(url, name))
  ipcMain.handle('calendar:unsubscribe', (_, id: string) => calendars.unsubscribe(id))
  ipcMain.handle('calendar:refresh', (_, id?: string) => calendars.refresh(id))
  ipcMain.handle('calendar:connect-mac', () => calendars.connectMac())
  ipcMain.handle('calendar:disconnect-mac', () => calendars.disconnectMac())
  // Where the user turns calendar access back on after saying no to macOS's question.
  ipcMain.handle('calendar:open-mac-settings', () => shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Calendars'))
  ipcMain.handle('calendar:set-google-client', (_, id: string, secret: string) => calendars.setGoogleClient(id, secret))
  ipcMain.handle('calendar:connect-google', (_, page: { done: string; failed: string }) => calendars.connectGoogle(page))
  ipcMain.handle('calendar:disconnect-google', (_, account: string) => calendars.disconnectGoogle(account))
  ipcMain.handle('calendar:set-hidden', (_, id: string, hidden: boolean) => calendars.setHidden(id, hidden))
  calendars.onChange(() => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('calendar:changed')
  })
}
