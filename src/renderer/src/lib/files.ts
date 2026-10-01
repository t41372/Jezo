// Links in an item's notes are relative to its file, like ../attachments/t-1/photo.png.
// These turn them into workspace paths and addresses the windows can load.

/** The workspace path a relative link points to, or null for a web address or a link leaving the workspace. */
export function linkedPath(fromFile: string, link: string) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(link) || link.startsWith('/') || link.startsWith('#')) return null
  const parts = fromFile.split('/').slice(0, -1)
  for (const part of decodeURI(link.split(/[?#]/)[0]).split('/')) {
    if (part === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/** Where the window loads a workspace file from (src/main/workspace/attachments.ts). */
export const fileUrl = (path: string) => `jezo-file://workspace/${path.split('/').map(encodeURIComponent).join('/')}`

const IMAGE = /\.(png|jpe?g|gif|webp|svg|avif|heic)$/i
export const isImage = (path: string) => IMAGE.test(path)

/** The files an item's notes link to in its attachments folder, with the name each link shows. */
export function attachmentsIn(notes: string, fromFile: string) {
  const found = new Map<string, string>()
  for (const m of notes.matchAll(/(!?)\[([^\]]*)\]\(<?([^)\s>]+)>?\)/g)) {
    const path = linkedPath(fromFile, m[3])
    if (path && /\/attachments\//.test(path)) found.set(path, m[2] || path.split('/').at(-1)!)
  }
  return [...found].map(([path, name]) => ({ path, name }))
}
