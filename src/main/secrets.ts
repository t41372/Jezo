// Keys, tokens and private addresses, encrypted with the OS keychain
// (safeStorage) and kept in the app's data directory, never in the workspace
// (AGENTS.md, principle 1). They never go back to a window.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { writeAtomic } from './workspace/files'

const file = () => join(app.getPath('userData'), 'keys.json')

function read(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return {}
  }
}

/** The names secrets are stored under. */
export const secretNames = () => Object.keys(read())

export function getSecret(name: string) {
  const stored = read()[name]
  return stored ? safeStorage.decryptString(Buffer.from(stored, 'base64')) : undefined
}

/** Stores a secret under a name, or removes it when the value is null. */
export async function storeSecret(name: string, value: string | null) {
  const all = read()
  if (value) all[name] = safeStorage.encryptString(value).toString('base64')
  else delete all[name]
  await writeAtomic(file(), JSON.stringify(all))
}
