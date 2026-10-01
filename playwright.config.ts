// E2E tests run the built app against a workspace of their own (e2e/jezo.ts).
// Build first: bun run e2e does both.

import { defineConfig } from '@playwright/test'

// Every test and every app it starts see the same zone, so "tomorrow" is the same
// day on both sides whatever the machine's zone and the hour. Set here, before the
// workers start: set in one spec file, it reached the apps of later specs but not
// the dates those specs worked out, and they disagreed after Taipei's midnight.
process.env.TZ = 'Asia/Taipei'

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
