import { expect, test, type Page } from '@playwright/test'

import { expectSignedIn, logIn } from '../support/app'
import { PATHS, card, expectLoaded, matchesApi, navigate, seedRichInsights } from '../support/insights'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the range control is a sticky sidebar on a wide screen and a fixed bar on a
// narrow one, and only the sidebar sits where the browser picks the element that holds the reading position

const LOADING_START_MS = 250
const NARROWEST_FIXED_HEIGHT_WIDTH = 1350

// How long the reveal fade lasts, plus a margin, after the last loading indicator has gone
const REVEAL_SETTLE_MS = 600

type PositionRecorder = { tops: number[]; stop: boolean }

/**
 * Presses a control at its centre without letting the test runner scroll it into view first, since
 * that scroll would be mistaken for the page moving by itself
 * @param page - Insights page
 * @param role - Role of the control
 * @param name - Accessible name of the control
 */
async function press(page: Page, role: 'button' | 'tab', name: string | RegExp): Promise<void> {
  const control = page.getByRole(role, { name, exact: typeof name === 'string' }).filter({ visible: true }).first()

  // A control inside the panel is pressed only once the panel has finished opening under it
  let box = await control.boundingBox()
  await expect.poll(async () => {
    const previous = box
    box = await control.boundingBox()
    return box !== null && previous !== null && box.x === previous.x && box.y === previous.y && box.width === previous.width
  }).toBe(true)
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2)
}

/**
 * Starts recording, on every frame, how far the net worth card sits from the top of the window
 * @param page - Insights page
 */
async function startRecording(page: Page): Promise<void> {
  await card(page, 0).evaluate((element) => {
    const recorder: PositionRecorder = { tops: [], stop: false }
    ;(window as unknown as { __recorder: PositionRecorder }).__recorder = recorder
    const tick = () => {
      recorder.tops.push(element.getBoundingClientRect().top)
      if (!recorder.stop) requestAnimationFrame(tick)
    }
    tick()
  })
}

/**
 * Stops recording and returns every position seen
 * @param page - Insights page
 * @returns The card's distance from the top of the window on each recorded frame
 */
async function stopRecording(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const recorder = (window as unknown as { __recorder: PositionRecorder }).__recorder
    recorder.stop = true
    return recorder.tops
  })
}

test('switching the period keeps the card being read where it is', AT_EVERY_SIZE, async ({ page, request }) => {
  // The breakdown card holds one height from this width up, so a wider window has no change to detect
  if (page.viewportSize()!.width >= NARROWEST_FIXED_HEIGHT_WIDTH) await page.setViewportSize({ width: 1280, height: 800 })
  const rich = await seedRichInsights(request)
  const succeeded = new Set<string>()
  page.on('response', (response) => {
    const path = PATHS.find((candidate) => matchesApi(response.url(), candidate))
    if (path && response.ok()) succeeded.add(path)
  })
  await logIn(page, rich.user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')
  await expectLoaded(page, succeeded)

  // The cards above net worth load only once they have been on screen, so each is shown in turn
  // before their heights are compared
  const cards = page.locator('.space-y-4 > div')
  for (let index = 0; index < await cards.count(); index += 1) {
    await cards.nth(index).scrollIntoViewIfNeeded()
    await expect(page.locator('.space-y-4').getByRole('status')).toHaveCount(0)
  }

  // Net worth sits below the two cards whose height follows the period's data, so it is the card
  // that shows whether a change above it moved the reading position
  await card(page, 0).evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const resting = (await card(page, 0).boundingBox())!.y
  const pageHeights = new Set<number>()

  for (const code of ['LM', 'MTD', '30D', 'MTD']) {
    await startRecording(page)
    await press(page, 'button', /Insights date range/)
    await press(page, 'tab', code)
    // The loading indicator appears a frame after the press, so a count taken at once would pass early
    await page.waitForTimeout(LOADING_START_MS)
    await expect(page.locator('.space-y-4').getByRole('status')).toHaveCount(0)
    await page.waitForTimeout(REVEAL_SETTLE_MS)
    const tops = await stopRecording(page)
    pageHeights.add(await page.evaluate(() => document.documentElement.scrollHeight))

    expect(Math.max(...tops.map((top) => Math.abs(top - resting))), `net worth card moved after switching to ${code}`).toBeLessThanOrEqual(1)
  }

  // Without a change in the page's height the check above would hold for any code
  expect(pageHeights.size).toBeGreaterThan(1)
})
