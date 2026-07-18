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
import { buildImportCsv } from './import-fixture.mjs'
import {
  applyThemeAndClock,
  CLOCK_HOUR_BY_THEME,
  logIn,
  resolveBaseUrl,
  resolvePinnedDay,
  SETTLE_MS,
  VIEWPORTS,
  waitForContent,
} from './shared.mjs'

// Account and budget whose detail views are captured
const ACCOUNT_DETAILS_NAME = 'Platinum Rewards Card'
const BUDGET_DETAILS_NAME = 'Utilities'

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
const baseUrl = resolveBaseUrl(rawUrl)
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Desktop output lands directly in docs/screenshots because those file names
// are what the README embeds, other sizes get their own folder
const screenshotsDir = path.join(repoRoot, 'docs', 'screenshots')
const outputDir = size === 'desktop' ? screenshotsDir : path.join(screenshotsDir, size)

/** Wait for the page's anchor content, then write one screenshot */
async function capture(page, name, anchor, { fullPage = false } = {}) {
  await waitForContent(page, anchor)
  await page.screenshot({ path: path.join(outputDir, `${name}_${theme}.png`), fullPage })
  console.log(`  ${name}_${theme}.png`)
}

/** Walk the core pages in the chosen theme and capture each screen */
async function captureAll(browser) {
  console.log(`${theme} theme at ${size} size`)
  const context = await browser.newContext({ viewport: VIEWPORTS[size], reducedMotion: 'reduce' })
  await applyThemeAndClock(context, theme)

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

  // Staging a file is entirely client-side, so setInputFiles on the hidden
  // input parses the fixture in the browser and populates the workflow
  // without touching the server. The anchor is a fixture merchant name
  // because it only renders once staging has finished and the mapping,
  // matching, and preview sections have all populated. Commit import must
  // never be clicked so the capture stays read-only and safe to run
  // alongside the demo recording against the same seeded data
  await page.goto(`${baseUrl}/settings/imports`)
  const importCsv = buildImportCsv(resolvePinnedDay())
  await page.locator('input[type="file"]').setInputFiles({
    name: 'transactions.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(importCsv),
  })
  await capture(page, 'transaction_import', 'Golden Pantry')

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
