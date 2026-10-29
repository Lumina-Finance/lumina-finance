import { defineConfig, devices } from '@playwright/test'
import { availableParallelism } from 'node:os'

import { TEST_TIMEZONE } from './support/api'
import { ACROSS_ORIGINS_TESTS } from './support/origins'
import { EVERY_SIZE_TESTS } from './support/sizes'
import { BASE_URL } from './support/target'
import { VISUAL_TEST_TIMEOUT_MS } from './support/visual-limit-reporter'

// The development runner preserves the host-derived count when reserving an app CPU.
// Playwright CLI worker overrides still take precedence over this default
const configuredWorkers = process.env.E2E_WORKERS
if (configuredWorkers !== undefined && (!/^[1-9]\d*$/.test(configuredWorkers) || !Number.isSafeInteger(Number(configuredWorkers)))) {
  throw new Error('E2E_WORKERS must be a positive integer')
}

// Set by the development runner for a screenshot or visual check run, whose throwaway specs fail
// fast: a test over the limit fails, one that outlasts it by the teardown allowance stops the run,
// and a failed test is not retried. A test that cannot finish in that time is broken, and waiting
// it out only delays the report
const isVisualRun = process.env.E2E_VISUAL === '1'

// What Playwright's headless Chromium passes as `--blink-settings` to report a mouse that hovers
const PLAYWRIGHT_HEADLESS_BLINK_SETTINGS = 'primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'

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

  // Three everywhere, so one slow moment on a busy runner doesn't fail a whole run. A spec that
  // passes only on a retry is still listed as flaky in the report, so the race stays visible
  retries: isVisualRun ? 0 : 3,

  // Long real flows need a total budget that tolerates CPU contention at high worker counts.
  // Each assertion still bounds the expected UI update independently
  timeout: isVisualRun ? VISUAL_TEST_TIMEOUT_MS : 180_000,
  expect: { timeout: 15_000 },

  reporter: [
    ...(process.env.CI ? ([['list'], ['html', { open: 'never' }]] as const) : ([['list']] as const)),
    ...(isVisualRun ? ([['./support/visual-limit-reporter.ts']] as const) : []),
  ],

  globalSetup: './support/global-setup.ts',

  use: {
    baseURL: BASE_URL,
    timezoneId: TEST_TIMEZONE,

    // Money is written the way the reader's own region writes it, so this decides how the currency
    // symbols in these tests render and cannot be removed without rewriting their expectations. The
    // suite spends Canadian dollars, which this renders as $42.50. Dropped, a runner set to the
    // United States renders the same amount CA$42.50 and every assertion naming a symbol fails
    locale: 'en-CA',

    trace: { mode: 'retain-on-failure', screenshots: false },
    screenshot: 'only-on-failure',

    // Chromium otherwise reserves fifteen pixels for a classic scrollbar beside the root's
    // `scrollbar-gutter: stable`, so the widest project would lay out at 2185 and a phone width
    // 15 narrower than it says. The `OverlayScrollbar` feature the captures pass stopped doing this in
    // Chromium 156, and this setting draws the overlay scrollbars a phone has. A second
    // `--blink-settings` replaces the one Playwright's headless mode passes, so that one is repeated
    // here, or hover and fine pointer would stop matching
    launchOptions: { args: [`--blink-settings=${PLAYWRIGHT_HEADLESS_BLINK_SETTINGS},forceAndroidOverlayScrollbar=true`] },
  },

  // Leave one available CPU for the application and operating system
  workers: configuredWorkers === undefined ? Math.max(1, availableParallelism() - 1) : Number(configuredWorkers),

  projects: [
    {
      name: 'desktop',
      grepInvert: ACROSS_ORIGINS_TESTS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop },
    },
    {
      // Desktop's size, for the tests desktop leaves out because they need the app and the API on
      // different origins. Its CI job builds the frontend for that and is the only job to name
      // this project. The development runner names none, so it runs this one too, on an instance
      // whose frontend and API already have separate ports
      name: 'cross-origin',
      grep: ACROSS_ORIGINS_TESTS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.desktop },
    },
    {
      // Mobile devices, as the captures take them. What that changes here is the coarse-pointer
      // media queries and the scrollbar, which is drawn over the page rather than taking width
      // out of it, so these two lay out at exactly the width written above. Both run only the
      // tests whose result depends on the screen, since every other test fails the same way on desktop
      name: 'tablet',
      grep: EVERY_SIZE_TESTS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.tablet, isMobile: true, hasTouch: true },
    },
    {
      name: 'phone',
      grep: EVERY_SIZE_TESTS,
      use: { ...devices['Desktop Chrome'], viewport: VIEWPORTS.phone, isMobile: true, hasTouch: true },
    },
  ],
})
