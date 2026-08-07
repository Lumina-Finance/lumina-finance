import { defineConfig, devices } from '@playwright/test'

import { TEST_TIMEZONE } from './support/api'
import { BASE_URL } from './support/target'

// The three sizes the screenshot captures use, so the suite checks the layouts the captures
// show. Copied by value from dev/demo/capture/shared.mjs rather than imported: that file is
// JavaScript in the internal repository and this one is TypeScript in this one, so an import
// would need a build step across the two
const VIEWPORTS = {
  desktop: { width: 2200, height: 1322 },

  // Playwright's iPad Pro 11 landscape screen. Only the size is taken, because its full device
  // entry also selects WebKit, and only Chromium is installed
  tablet: { width: 1194, height: 834 },

  phone: { width: 393, height: 852 },
}

export default defineConfig({
  testDir: './tests',

  // Every spec creates its own user, so nothing one spec writes is visible to another
  fullyParallel: true,

  forbidOnly: Boolean(process.env.CI),

  // None anywhere. A spec that passes only on a second attempt is reporting a race in the app
  // or in itself, and retrying would hide the one thing this suite exists to catch
  retries: 0,

  // Both are raised above Playwright's defaults of 30 seconds and 5 seconds, because a spec
  // can spend 20 seconds signing in and 20 more waiting for a modal against an instance that
  // has just started, and every first assertion after a navigation waits on a cold query. With
  // no retries, one slow query would otherwise be a failed run rather than a slow one
  timeout: 90_000,
  expect: { timeout: 15_000 },

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

    // The captures pass this for the same reason: Chromium on Linux otherwise draws a classic
    // scrollbar that takes fifteen pixels out of the page, so the widest project would lay out
    // at 2185 and stop being the size it says it is
    launchOptions: { args: ['--enable-features=OverlayScrollbar'] },
  },

  // Pinned rather than left to default, which is half the machine's cores and would serialise
  // the three sizes on a two-core runner. The ceiling is not the runner but the one app
  // container every test signs up against, which hashes each password with argon2id at 64 MiB
  workers: 6,

  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop },
    },
    {
      // Mobile devices, as the captures take them. What that changes here is the coarse-pointer
      // media queries and the scrollbar, which is drawn over the page rather than taking width
      // out of it, so these two lay out at exactly the width written above
      name: 'tablet',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.tablet, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.phone, isMobile: true, hasTouch: true },
    },
  ],
})
