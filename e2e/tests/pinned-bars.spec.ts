/**
 * Guards the bars that pin to the top of a page as it scrolls, against covering the controls and content
 * below them or running under the round menu button the phone layout fixes to the top right
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

/**
 * How far the right end of a control reaches past the left edge of the phone menu button, while the two
 * share any height on screen. Zero or less means the control stops short of the button
 */
async function overlapWithMenuButton(page: Page, control: Locator): Promise<number> {
  const button = (await page.getByRole('button', { name: 'Open navigation menu' }).boundingBox())!
  const box = (await control.boundingBox())!
  const sharesHeight = box.y < button.y + button.height && box.y + box.height > button.y
  return sharesHeight ? box.x + box.width - button.x : 0
}

test('keeps the pinned settings section menu clear of the menu button just below the wide layout', async ({ page, request }) => {
  const user = await signUpUser(request)
  // The widest window that still shows the phone layout, which some browser zoom levels give
  await page.setViewportSize({ width: 1049, height: 768 })
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  const menu = page.locator('[aria-controls="settings-mobile-section-menu"]')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(menu).toBeInViewport()
  await expect.poll(() => overlapWithMenuButton(page, menu)).toBeLessThanOrEqual(-8)
})

/** Resolve once the page has held still for ten frames, so a smooth scroll has come to rest */
async function waitForScrollToRest(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = window.scrollY
    let stillFrames = 0
    const tick = () => {
      if (window.scrollY === last) stillFrames += 1
      else stillFrames = 0
      last = window.scrollY
      if (stillFrames >= 10) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

test('brings each chosen settings section to rest below the pinned section menu', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  // The section menu pins above the page below the side list's width, and the side list takes its place above it
  const menu = page.locator('[aria-controls="settings-mobile-section-menu"]')
  const compact = await menu.isVisible()
  for (const name of ['Security', 'Runway', 'Categories', 'Merchants', 'Tags', 'Tax-Advantaged Categories']) {
    if (compact) {
      await menu.click()
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name, exact: true }).click()
    } else {
      await page.getByRole('button', { name, exact: true }).click()
    }
    await waitForScrollToRest(page)

    const heading = (await page.getByRole('heading', { level: 2, name, exact: true }).boundingBox())!
    const coveredTo = compact ? (await menu.boundingBox())!.y + (await menu.boundingBox())!.height : 0
    expect(heading.y, name).toBeGreaterThanOrEqual(coveredTo + 8)
  }
})
