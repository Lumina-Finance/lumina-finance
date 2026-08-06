import { defineConfig, devices } from '@playwright/test'

import { TEST_TIMEZONE } from './support/api'
import { BASE_URL } from './support/target'

// Above the 1050px breakpoint, so the desktop navigation and the desktop filter panel are the
// ones rendered. The mobile filter sheet has no accessible name on the control that chooses
// which filter to edit, so nothing drives it
const DESKTOP_VIEWPORT = { width: 1440, height: 900 }

export default defineConfig({
  testDir: './tests',

  // Every spec creates its own user, so nothing one spec writes is visible to another
  fullyParallel: true,

  forbidOnly: Boolean(process.env.CI),

  // None anywhere. A spec that passes only on a second attempt is reporting a race in the app
  // or in itself, and retrying would hide the one thing this suite exists to catch
  retries: 0,

  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  globalSetup: './support/global-setup.ts',

  use: {
    baseURL: BASE_URL,
    timezoneId: TEST_TIMEZONE,

    // Amounts are formatted with the browser's own locale, so an unpinned runner renders a
    // Canadian dollar amount as CA$42.50 where this one renders $42.50
    locale: 'en-CA',

    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: DESKTOP_VIEWPORT },
    },
  ],
})
