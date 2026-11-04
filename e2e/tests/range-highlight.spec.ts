import { expect, test, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: the sidebar range control is the one this checks, and the highlight moves the same way
// in the floating one

/**
 * The tan highlight behind This, Last or Past sits on its own segment from the first frame of the Custom
 * builder folding open or shut. It used to be drawn about 17px low while the line of dates above the builder
 * appeared and disappeared, since the highlight animated the jump of the segment it sits in
 */

/** How far the highlight reaches outside its own segment right now, which is 0 once it has settled on it */
function reachNow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const thumb = document.querySelector('[aria-label="Relative range type"] .app-range-seg-thumb')!
    const inner = thumb.getBoundingClientRect()
    const outer = thumb.parentElement!.getBoundingClientRect()
    return Math.max(outer.top - inner.top, inner.bottom - outer.bottom, 0)
  })
}

/**
 * Chooses a range option inside the page and reads, on every frame for the next 700ms, how far the highlight
 * reaches outside its own segment. Running the click and the sampling in one step is what lets the first frame
 * count
 */
function chooseAndMeasure(page: Page, optionName: string): Promise<number[]> {
  return page.evaluate(async (name) => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.getClientRects().length > 0 && tab.textContent?.trim() === name)!
    option.click()
    const reach: number[] = []
    const started = performance.now()
    await new Promise<void>((resolve) => {
      const sample = () => {
        const thumb = document.querySelector('[aria-label="Relative range type"] .app-range-seg-thumb')
        const segment = thumb?.parentElement
        if (thumb && segment) {
          const inner = thumb.getBoundingClientRect()
          const outer = segment.getBoundingClientRect()
          reach.push(Math.max(outer.top - inner.top, inner.bottom - outer.bottom, 0))
        }
        if (performance.now() - started < 700) requestAnimationFrame(sample)
        else resolve()
      }
      requestAnimationFrame(sample)
    })
    return reach
  }, optionName)
}

test('keeps the This, Last and Past highlight on its segment while the Custom builder opens and closes', async ({ page, request }) => {
  test.setTimeout(45_000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/insights')

  const head = page.getByRole('button', { name: /^Insights date range: / }).filter({ visible: true })
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')

  for (const qualifier of ['Past', 'Last', 'This']) {
    // Open with this qualifier chosen: the builder is folded shut first, then opened by choosing Custom
    const opening = await chooseAndMeasure(page, 'Custom')
    // The slow dev host draws few frames in 700ms, but the first ones are where the highlight used to sit low
    expect(opening.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...opening)).toBeLessThanOrEqual(1)
    // Clicked inside the page, since the floating control can sit under a card that catches a pointer click
    await page.getByRole('tab', { name: qualifier, exact: true }).filter({ visible: true }).evaluate((node) => (node as HTMLElement).click())
    await expect.poll(() => reachNow(page)).toBeLessThanOrEqual(1)
    await expect(page.getByRole('tab', { name: qualifier, exact: true }).filter({ visible: true })).toHaveAttribute('aria-selected', 'true')

    const closing = await chooseAndMeasure(page, 'YTD')
    expect(closing.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...closing)).toBeLessThanOrEqual(1)
  }
})
