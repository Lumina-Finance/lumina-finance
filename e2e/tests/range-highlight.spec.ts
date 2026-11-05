import { expect, test, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on the desktop project only. One case resizes the window to a phone width and so reaches the control
// a phone shows. The highlight moves the same way in every size

/**
 * The tan highlight behind This, Last or Past sits on its own segment from the first frame of the Custom
 * builder folding open or shut. It used to be drawn about 17px low while the line of dates above the builder
 * appeared and disappeared. The highlight animated the jump of its segment
 */

/** The highlight of the range control that is on screen, since a hidden copy can come first in the page */
const VISIBLE_THUMB = `
  [...document.querySelectorAll('[aria-label="Relative range type"] .app-range-seg-thumb')]
    .find((node) => node.getClientRects().length > 0)
`

/** How far the highlight reaches outside its own segment right now, 0 once it sits on it */
function reachNow(page: Page): Promise<number> {
  return page.evaluate((find) => {
    const thumb = eval(find) as HTMLElement
    const inner = thumb.getBoundingClientRect()
    const outer = thumb.parentElement!.getBoundingClientRect()
    return Math.max(outer.top - inner.top, inner.bottom - outer.bottom, 0)
  }, VISIBLE_THUMB)
}

/**
 * Chooses a range option inside the page and reads, on every frame for the next 700ms, how far the highlight
 * reaches outside its own segment. Running the click and the sampling in one step is what lets the first frame
 * count
 */
function chooseAndMeasure(page: Page, optionName: string): Promise<number[]> {
  return page.evaluate(async ({ name, find }) => {
    const option = [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
      .find((tab) => tab.getClientRects().length > 0 && tab.textContent?.trim() === name)!
    option.click()
    const reach: number[] = []
    const started = performance.now()
    await new Promise<void>((resolve) => {
      const sample = () => {
        const thumb = eval(find) as HTMLElement | undefined
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
  }, { name: optionName, find: VISIBLE_THUMB })
}

// The slow dev host draws few frames in 700ms, but the first ones are where the highlight used to sit low
const expectOnSegment = (reach: number[]) => {
  expect(reach.length).toBeGreaterThanOrEqual(3)
  expect(Math.max(...reach)).toBeLessThanOrEqual(1)
}

async function openRange(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/insights')

  const head = page.getByRole('button', { name: /^Insights date range: / }).filter({ visible: true })
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
}

// The floating control below 1050px wide is the one a phone and a tablet show, and the desktop window keeps its size
const SIZES = [
  { name: 'desktop', size: null },
  { name: 'phone', size: { width: 390, height: 844 } },
  { name: 'tablet', size: { width: 768, height: 1024 } },
]

for (const { name, size } of SIZES) {
test(`keeps the This, Last and Past highlight on its segment while the Custom builder opens and closes at a ${name} width`, async ({ page, request }) => {
  test.setTimeout(45_000)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  if (size) await page.setViewportSize(size)
  await openRange(page, request)

  // Past is the builder's default, so the first opening is measured with it. Each qualifier is then chosen with
  // the builder open, then the builder is folded shut and opened again with the qualifier still chosen
  expectOnSegment(await chooseAndMeasure(page, 'Custom'))
  for (const qualifier of ['Past', 'Last', 'This']) {
    const tab = page.getByRole('tab', { name: qualifier, exact: true }).filter({ visible: true })
    // Clicked inside the page, since the floating control can sit under a card that catches a pointer click
    await tab.evaluate((node) => (node as HTMLElement).click())
    await expect(tab).toHaveAttribute('aria-selected', 'true')
    await expect.poll(() => reachNow(page)).toBeLessThanOrEqual(1)

    expectOnSegment(await chooseAndMeasure(page, 'YTD'))
    expectOnSegment(await chooseAndMeasure(page, 'Custom'))
  }
})
}

test('has the highlight on its segment at once when Custom opens with reduced motion', async ({ page, request }) => {
  test.setTimeout(45_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openRange(page, request)

  expectOnSegment(await chooseAndMeasure(page, 'Custom'))
})
