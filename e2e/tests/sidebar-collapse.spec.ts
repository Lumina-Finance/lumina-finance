import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: the sidebar's hover and focus preview exists only where the pointer hovers

/**
 * Guards the sidebar's "Collapse sidebar" button. It used to unpin the sidebar while the hover or
 * focus preview kept the full menu open, so the sidebar stayed expanded until the pointer left it
 */

const RAIL_WIDTH = 74
const EXPANDED_WIDTH = 240
const NAV_EXPANDED_KEY = 'lumina:settings:navExpanded'

/** Signs up a user and opens a page with the sidebar pinned open or unpinned to its rail */
async function openWithSidebar(page: Page, request: APIRequestContext, pinned: boolean) {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [NAV_EXPANDED_KEY, String(pinned)],
  )
  await openPage(page, '/accounts')
  return page.getByRole('navigation', { name: 'Primary', exact: true })
}

/** Waits for the sidebar's width animation to settle on the given width */
async function expectWidth(navigation: Locator, width: number) {
  await expect
    .poll(() => navigation.evaluate((element) => Math.round(element.getBoundingClientRect().width)))
    .toBe(width)
}

/** Moves the pointer to the page's far corner, away from the sidebar */
async function moveAwayFromSidebar(page: Page) {
  const { width, height } = page.viewportSize()!
  await page.mouse.move(width - 10, height - 10)
}

test('collapses the sidebar at once when its button is clicked with the pointer over it', async ({ page, request }) => {
  const navigation = await openWithSidebar(page, request, false)

  // Hovering the rail previews the full menu, and pinning it keeps the pointer where it is
  await navigation.hover()
  await expectWidth(navigation, EXPANDED_WIDTH)
  await navigation.getByRole('button', { name: 'Keep sidebar expanded', exact: true }).click()
  await expect(navigation.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )

  await navigation.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()

  await expect(navigation.getByRole('button', { name: 'Keep sidebar expanded', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expectWidth(navigation, RAIL_WIDTH)

  // A fresh hover previews the full menu again once the pointer has left and come back
  await moveAwayFromSidebar(page)
  await expectWidth(navigation, RAIL_WIDTH)
  await navigation.hover()
  await expectWidth(navigation, EXPANDED_WIDTH)
})

test('collapses the sidebar at once when its button is pressed from the keyboard', async ({ page, request }) => {
  const navigation = await openWithSidebar(page, request, true)
  await moveAwayFromSidebar(page)

  await navigation.getByRole('button', { name: 'Collapse sidebar', exact: true }).focus()
  await page.keyboard.press('Enter')

  await expect(navigation.getByRole('button', { name: 'Keep sidebar expanded', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  await expectWidth(navigation, RAIL_WIDTH)

  // Moving focus to another menu item previews the full menu again
  await page.keyboard.press('Tab')
  await expectWidth(navigation, EXPANDED_WIDTH)
})

test('keeps the sidebar expanded after its button pins it', async ({ page, request }) => {
  const navigation = await openWithSidebar(page, request, false)

  await navigation.hover()
  await navigation.getByRole('button', { name: 'Keep sidebar expanded', exact: true }).click()
  await moveAwayFromSidebar(page)

  await expect(navigation.getByRole('button', { name: 'Collapse sidebar', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expectWidth(navigation, EXPANDED_WIDTH)
})
