// E2E tests run the built app against a workspace of their own (e2e/jezo.ts).
// Build first: bun run e2e does both.

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  // One app at a time: each one registers the ⌥X key with the OS.
  workers: 1,
  timeout: 60_000,
  reporter: [['list'], ['html', { outputFolder: 'e2e/report', open: 'never' }]],
  outputDir: 'e2e/results',
  globalSetup: './e2e/setup.ts',
  use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' },
})
