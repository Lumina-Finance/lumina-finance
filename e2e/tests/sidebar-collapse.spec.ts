import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: the sidebar's hover and focus preview exists only where the pointer hovers

/**
 * Guards the sidebar's "Collapse sidebar" button. It used to unpin the sidebar while the hover or
 * focus preview kept the full menu open, so the sidebar stayed expanded until the pointer left it
 *
 * Also guards the user row's Log out button. The collapsed rail folds it away, and it must then leave
 * the focus order and the accessibility tree
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

// How long the collapsed rail waits before it hides Log out. The button fades out for that long first
const HIDING_DELAY_MS = 200

/**
 * Holds the transition that hides Log out at the given time into its delay, and answers the button's
 * visibility there, or null while no such transition has started
 */
function holdHidingTransition(page: Page, milliseconds: number) {
  return page.evaluate((time) => {
    const button = document.querySelector('nav[aria-label="Primary"] button[aria-label="Log out"]')
    const transition = button
      ?.getAnimations()
      .find((animation): animation is CSSTransition => animation instanceof CSSTransition && animation.transitionProperty === 'visibility')
    if (!button || !transition) return null
    transition.pause()
    transition.currentTime = time
    return getComputedStyle(button).visibility
  }, milliseconds)
}

test('takes Log out out of reach when the rail collapses around it', async ({ page, request }) => {
  const navigation = await openWithSidebar(page, request, false)
  const logOut = navigation.getByRole('button', { name: 'Log out', exact: true })

  // Hovering previews the full menu, where Log out is an ordinary control the keyboard can reach
  await navigation.hover()
  await expectWidth(navigation, EXPANDED_WIDTH)
  await logOut.focus()
  await expect(logOut).toBeFocused()

  // The pointer leaving collapses the rail even though focus is still inside it. The button stays while
  // it fades, so the transition that hides it is held just before its end
  await moveAwayFromSidebar(page)
  await expect.poll(() => holdHidingTransition(page, HIDING_DELAY_MS - 50), { intervals: [20] }).toBe('visible')
  await expect(logOut).toHaveCount(1)

  // Once that transition ends the button leaves the accessibility tree and focus leaves it
  await holdHidingTransition(page, HIDING_DELAY_MS)
  await expect(logOut).toHaveCount(0)
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null))
    .not.toBe('Log out')

  // Opening the rail again makes it a normal control again at once, a couple of frames after the pointer
  // arrives and well inside the delay that hides it, so it is read once with no retry
  await navigation.hover()
  const visibilityAfterFrames = await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    const button = document.querySelector('nav[aria-label="Primary"] button[aria-label="Log out"]')
    return button ? getComputedStyle(button).visibility : null
  })
  expect(visibilityAfterFrames).toBe('visible')
  await logOut.focus()
  await expect(logOut).toBeFocused()
})
