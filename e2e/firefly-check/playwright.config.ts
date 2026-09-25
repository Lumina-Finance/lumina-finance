/**
 * Runs the Firefly III import check on its own, since it needs the exports seed.sh writes and
 * the everyday suite must not
 */
import { defineConfig, devices } from '@playwright/test'

import { TEST_TIMEZONE } from '../support/api'
import { BASE_URL } from '../support/target'

export default defineConfig({
  testDir: '.',
  testMatch: 'import.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  retries: 0,

  // One import of a few hundred rows and a read back of all of it, through the real screen
  timeout: 600_000,
  expect: { timeout: 60_000 },

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: '../support/global-setup.ts',
  use: {
    baseURL: BASE_URL,
    timezoneId: TEST_TIMEZONE,
    locale: 'en-CA',
    trace: { mode: 'retain-on-failure', screenshots: false },
    screenshot: 'only-on-failure',
  },
  workers: 1,
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 1000 } } }],
})
