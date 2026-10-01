// Files the user adds to an item's notes, like a photo of a whiteboard or a PDF.
// They live in the workspace, next to the items, and the notes link to them
// with ordinary relative links (docs/design/frontend.md, "Todo details").

import { readFile } from 'node:fs/promises'
import { extname, join, posix } from 'node:path'
import { protocol, shell } from 'electron'
import { insideWorkspace, type Workspace } from './workspace'

/** The scheme the windows load workspace files from: jezo-file://workspace/todos/attachments/t-1/photo.png */
export const FILE_SCHEME = 'jezo-file'

/** Called before the app is ready, as Electron requires. */
export function registerFileScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])
}

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.avif': 'image/avif', '.heic': 'image/heic', '.pdf': 'application/pdf',
}

/** Serves files from the workspace, and nothing outside it. */
export function serveFiles(workspace: Workspace) {
  protocol.handle(FILE_SCHEME, async (request) => {
    const url = new URL(request.url)
    const path = insideWorkspace(workspace.root, join(workspace.root, decodeURIComponent(url.pathname)))
    if (url.host !== 'workspace' || path === null) return new Response(null, { status: 403 })
    try {
      return new Response(await readFile(workspace.abs(path)), { headers: { 'content-type': TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream' } })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

/** A name that's safe as one path segment, keeping the extension. */
function safeName(name: string) {
  const cleaned = name.normalize('NFC').replace(/[/\\:*?"<>|\u0000-\u001f]/g, '-').replace(/^\.+/, '').trim()
  return cleaned || 'file'
}

/**
 * Stores a file for an item, as `<plugin>/attachments/<item id>/<name>`, through
 * the workspace like any write. Returns the link to it from the item's file.
 */
export async function attach(workspace: Workspace, itemId: string, name: string, bytes: Uint8Array) {
  const item = workspace.get(itemId)
  if (!item) throw new Error(`There is no item ${itemId}.`)
  const plugin = item.path.split('/')[0]
  const dir = `${plugin}/attachments/${itemId}`
  const ext = extname(safeName(name))
  const base = safeName(name).slice(0, safeName(name).length - ext.length)
  let file = `${base}${ext}`
  // A second file with the same name doesn't replace the first.
  for (let n = 2; (await readFile(workspace.abs(`${dir}/${file}`)).then(() => true, () => false)); n++) file = `${base}-${n}${ext}`
  await workspace.writeFile(`${dir}/${file}`, bytes, { by: 'user' }, null)
  return posix.relative(posix.dirname(item.path), `${dir}/${file}`)
}

/** Opens a workspace file in the app the system uses for it. */
export async function openFile(workspace: Workspace, path: string) {
  const inside = insideWorkspace(workspace.root, workspace.abs(path))
  if (inside === null) throw new Error('Only files in the workspace open from here.')
  const error = await shell.openPath(workspace.abs(inside))
  if (error) throw new Error(error)
}
