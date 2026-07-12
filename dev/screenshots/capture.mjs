// Capture app screenshots against a running frontend
//
// The frontend address, screen size, and theme come from environment
// variables so no machine addresses ever live in the repository:
//     URL=<host:port> SIZE=<desktop|tablet|mobile> THEME=<light|dark> make take-screenshots
//
// Signs in as the demo user, walks the core pages in the chosen theme, and
// writes PNGs named after the existing README screenshots. Desktop refreshes
// docs/screenshots in place while other sizes write to docs/screenshots/<size>

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

// Demo login the screenshots are taken as
const DEMO_EMAIL = 'alice@example.com'
const DEMO_PASSWORD = 'password'

// Account and budget whose detail views are captured
const ACCOUNT_DETAILS_NAME = 'Platinum Rewards Card'
const BUDGET_DETAILS_NAME = 'Utilities'

const THEME_STORAGE_KEY = 'lumina:settings:theme'

// Screenshots are taken at a fixed clock so light mode reads as morning and
// dark mode as evening, on the same day of month the seed script pins its
// data window to, so captured pages never show future-dated entries
const CLOCK_DAY_OF_MONTH = 15
const CLOCK_HOUR_BY_THEME = { light: 9, dark: 19 }
const VIEWPORTS = {
  desktop: { width: 2200, height: 1400 },
  tablet: { width: 1180, height: 820 },
  mobile: { width: 390, height: 844 },
}

// Every capture waits at least this long after its anchor content appears so
// animations finish, a fixed delay because the app keeps polling endpoints
// alive, which never lets Playwright's network-idle heuristic fire
const SETTLE_MS = 2000

// How long a page may take to render its anchor before the run fails,
// generous because the dev server compiles each route on first visit
const CONTENT_TIMEOUT_MS = 30_000

const rawUrl = process.env.URL
if (!rawUrl) {
  console.error('URL is required, e.g. URL=<host:port> SIZE=desktop THEME=light make take-screenshots')
  process.exit(1)
}
const size = process.env.SIZE
if (!size || !(size in VIEWPORTS)) {
  console.error(`SIZE must be one of ${Object.keys(VIEWPORTS).join(', ')}`)
  process.exit(1)
}
const theme = process.env.THEME
if (!theme || !(theme in CLOCK_HOUR_BY_THEME)) {
  console.error(`THEME must be one of ${Object.keys(CLOCK_HOUR_BY_THEME).join(', ')}`)
  process.exit(1)
}
const baseUrl = rawUrl.startsWith('http') ? rawUrl.replace(/\/$/, '') : `http://${rawUrl.replace(/\/$/, '')}`
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Desktop output lands directly in docs/screenshots because those file names
// are what the README embeds, other sizes get their own folder
const screenshotsDir = path.join(repoRoot, 'docs', 'screenshots')
const outputDir = size === 'desktop' ? screenshotsDir : path.join(screenshotsDir, size)

/** Wait until the page shows its anchor content and stays showing it

The anchor is text that only renders once the page's own data has loaded,
because generic readiness checks pass on the navigation chrome while the
content area is still a spinner. The app can also fall back to its boot
splash seconds after content first appears, when the dev server compiles a
lazy chunk on first visit, so the state is re-checked after the settle delay
and the wait starts over if the splash won */
async function waitForContent(page, anchor) {
  // Layouts render some text in both a desktop and a mobile variant with only
  // one visible, so the anchor must match the visible occurrence
  const anchorText = page.getByText(anchor).filter({ visible: true }).first()
  const splash = page.getByText(/financial future awaits/i)

  for (let attempt = 0; attempt < 3; attempt++) {
    await anchorText.waitFor({ timeout: CONTENT_TIMEOUT_MS })
    await splash.waitFor({ state: 'hidden', timeout: CONTENT_TIMEOUT_MS })
    await page.waitForTimeout(SETTLE_MS)
    if ((await anchorText.isVisible()) && !(await splash.isVisible())) {
      return
    }
  }
  throw new Error(`Content for "${anchor}" did not stay visible`)
}

/** Wait for the page's anchor content, then write one screenshot */
async function capture(page, name, anchor, { fullPage = false } = {}) {
  await waitForContent(page, anchor)
  await page.screenshot({ path: path.join(outputDir, `${name}_${theme}.png`), fullPage })
  console.log(`  ${name}_${theme}.png`)
}

/** Sign in through the real login form and wait until the app leaves the login page */
async function logIn(page) {
  await page.getByLabel('Email').or(page.getByPlaceholder('Email')).first().fill(DEMO_EMAIL)
  await page.getByLabel('Password').or(page.getByPlaceholder('Password')).first().fill(DEMO_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: CONTENT_TIMEOUT_MS })
}

/** Walk the core pages in the chosen theme and capture each screen */
async function captureAll(browser) {
  console.log(`${theme} theme at ${size} size`)
  const context = await browser.newContext({ viewport: VIEWPORTS[size], reducedMotion: 'reduce' })

  // The theme must be in localStorage before the app boots so the first paint
  // already uses it
  await context.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [THEME_STORAGE_KEY, theme],
  )

  // Shift only Date by a constant offset so the app reads the theme's time of
  // day in greetings while real timers keep running, because Playwright's
  // clock API fakes timers and stalls the app's loading screen forever
  const clockTime = new Date()
  clockTime.setDate(CLOCK_DAY_OF_MONTH)
  clockTime.setHours(CLOCK_HOUR_BY_THEME[theme], 0, 0, 0)
  const clockOffsetMs = clockTime.getTime() - Date.now()
  await context.addInitScript((offsetMs) => {
    const RealDate = Date
    const realNow = RealDate.now.bind(RealDate)
    class OffsetDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(realNow() + offsetMs)
        } else {
          super(...args)
        }
      }

      static now() {
        return realNow() + offsetMs
      }
    }
    window.Date = OffsetDate
  }, clockOffsetMs)

  const page = await context.newPage()

  await page.goto(`${baseUrl}/login`)
  await logIn(page)
  await capture(page, 'dashboard', 'Net Worth')

  // Tablet and mobile only showcase the dashboard, the full page walk is a
  // desktop concern
  if (size !== 'desktop') {
    await context.close()
    return
  }

  for (const [route, name, anchor] of [
    ['/accounts', 'accounts', 'Everyday Chequing'],
    ['/transactions', 'transactions', 'Clay & Kiln Studio'],
    ['/budgets', 'budgets', 'Monthly Groceries'],
  ]) {
    await page.goto(`${baseUrl}${route}`)
    await capture(page, name, anchor)
  }

  // Insights is captured in full because its charts run well past the fold,
  // and everything below the fold must have scrolled into view once so every
  // chart has computed before the capture
  await page.goto(`${baseUrl}/insights`)
  await waitForContent(page, 'Cash Flow')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await page.waitForTimeout(SETTLE_MS)
  await page.evaluate(() => window.scrollTo(0, 0))
  await capture(page, 'insights', 'Cash Flow', { fullPage: true })

  // Account rows link to their detail page, and the capture shows one
  // specific account so the screenshot stays stable across reseeds
  await page.goto(`${baseUrl}/accounts`)
  await waitForContent(page, ACCOUNT_DETAILS_NAME)
  await page.locator('a[href^="/accounts/"]', { hasText: ACCOUNT_DETAILS_NAME }).first().click()
  await page.waitForURL(/\/accounts\/.+/)
  await capture(page, 'account_details', ACCOUNT_DETAILS_NAME)

  // Budget details open as an overlay when a budget card is clicked, and the
  // tracked category name only renders once the overlay has loaded
  await page.goto(`${baseUrl}/budgets`)
  await waitForContent(page, BUDGET_DETAILS_NAME)
  await page.getByText(BUDGET_DETAILS_NAME).first().click()
  await waitForContent(page, 'Electricity')

  // Hovering the second-last period column shows the on-hover utilization
  // breakdown in the shot. The column is found by its unique horizontal
  // centre, and the hover lands mid-chart because the tooltip activates
  // anywhere in the plot area at that x position
  const chartBox = await page.locator('.recharts-wrapper').first().boundingBox()
  const barBoxes = await Promise.all(
    (await page.locator('.recharts-bar-rectangle').all()).map((bar) => bar.boundingBox()),
  )
  const columnCentres = [...new Set(
    barBoxes.filter(Boolean).map((box) => Math.round(box.x + box.width / 2)),
  )].sort((a, b) => a - b)
  const hoverX = columnCentres.at(-2) ?? columnCentres.at(-1)
  if (chartBox && hoverX !== undefined) {
    await page.mouse.move(hoverX, chartBox.y + chartBox.height / 2)
  }
  await capture(page, 'budget_details', 'Electricity')

  await context.close()
}

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch()
try {
  await captureAll(browser)
} finally {
  await browser.close()
}
console.log(`Screenshots written to ${outputDir}`)
