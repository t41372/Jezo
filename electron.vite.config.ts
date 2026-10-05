import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/** Git's answer, or empty when there's no git or no repository (a source archive). */
function git(...args: string[]) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

/**
 * Which build this is, for 設定 → 關於: the version, the commit it was built
 * from, and whether the files that go into the app had changes not yet
 * committed. The version is read here because `app.getVersion()` gives
 * Electron's own when the app is started from a script, as the E2E tests do.
 */
const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string; license: string; homepage: string }
const build = {
  version: manifest.version,
  license: manifest.license,
  homepage: manifest.homepage,
  // The agent's own version, from the copy this build bundles.
  pi: (JSON.parse(readFileSync('node_modules/@earendil-works/pi-coding-agent/package.json', 'utf8')) as { version: string }).version,
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain', '--', 'src', 'packages', 'resources', 'native', 'package.json', 'bun.lock', 'electron.vite.config.ts') !== '',
  date: new Date().toISOString(),
}

export default defineConfig({
  main: {
    define: { __JEZO_BUILD__: JSON.stringify(build) },
  },
  // pi and the rest of the main process are ESM. Preload scripts in a sandboxed
  // renderer must be CommonJS, and with "type": "module" that means .cjs.
  preload: {
    build: { rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: {
      alias: { '@': resolve('src/renderer/src') },
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        input: {
          main: resolve('src/renderer/index.html'),
          quick: resolve('src/renderer/quick.html'),
        },
      },
    },
  },
})
