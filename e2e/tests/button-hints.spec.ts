import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only, except the tap test, which sets up a touch screen of its own. A button says what it
// does in the app's own tooltip, under a mouse and on keyboard focus, and never in the browser's title

const HINT = 'control-hint-tooltip'
const SIZES = [
  { width: 1280, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
]

/** The spending breakdown's toggle on the dashboard, named for the breakdown it would show */
function breakdownToggle(page: Page, mode: 'income' | 'spending') {
  return page.getByRole('button', { name: `Show ${mode} breakdown`, exact: true })
}

/** Signs a user in on the dashboard, with one account so the widgets draw */
async function openDashboard(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
}

/** The hint with this text, whether or not it has faded in */
function hintWith(page: Page, text: string) {
  return page.getByTestId(HINT).filter({ hasText: text })
}

/** Expects every hint to be faded out, or gone from the page once its fade has ended */
async function expectNoHintShown(page: Page) {
  await expect.poll(() => page.getByTestId(HINT).evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).opacity === '0'))).toBe(true)
}

/** The hint's drawn box and the button's, in page coordinates */
async function boxes(hint: Locator, button: Locator) {
  return { hint: (await hint.locator('> div').boundingBox())!, button: (await button.boundingBox())! }
}

test('leaves no native title on any button of the dashboard', async ({ page, request }) => {
  await openDashboard(page, request)

  await expect(breakdownToggle(page, 'income')).toBeVisible()
  await expect(page.locator('button[title]')).toHaveCount(0)
})

test('explains the breakdown toggle under the mouse, and says the new thing once it is pressed', async ({ page, request }) => {
  await openDashboard(page, request)
  const toggle = breakdownToggle(page, 'income')
  const hint = hintWith(page, 'Show income breakdown')
  await expectNoHintShown(page)

  await toggle.hover()
  await expect(hint).toHaveCSS('opacity', '1')

  // The press is never held back, and the hint reads afresh for the button's new meaning
  await toggle.click()
  await expect(breakdownToggle(page, 'spending')).toBeVisible()
  await expect(hintWith(page, 'Show spending breakdown')).toHaveCSS('opacity', '1')

  await page.mouse.move(2, 2)
  await expectNoHintShown(page)
})

test('explains the breakdown toggle on keyboard focus only, and puts it away on Escape', async ({ page, request }) => {
  await openDashboard(page, request)
  const toggle = breakdownToggle(page, 'income')

  // A mouse press focuses the button without a ring, which shows nothing
  await toggle.click()
  await page.mouse.move(2, 2)
  await expectNoHintShown(page)

  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(toggle).toBeFocused()
  await expect(hintWith(page, 'Show income breakdown')).toHaveCSS('opacity', '1')

  await page.keyboard.press('Escape')
  await expectNoHintShown(page)
})

for (const size of SIZES) {
  test(`keeps the hint on screen and off its own button at ${size.width}px`, async ({ page, request }) => {
    await page.setViewportSize(size)
    await openDashboard(page, request)
    const toggle = breakdownToggle(page, 'income')
    const hint = hintWith(page, 'Show income breakdown')

    await toggle.hover()
    await expect(hint).toHaveCSS('opacity', '1')
    const { hint: hintBox, button } = await boxes(hint, toggle)

    expect(hintBox.x).toBeGreaterThanOrEqual(0)
    expect(hintBox.x + hintBox.width).toBeLessThanOrEqual(size.width)
    expect(hintBox.y).toBeGreaterThanOrEqual(0)
    expect(hintBox.y + hintBox.height).toBeLessThanOrEqual(size.height)
    const overlapsButton =
      hintBox.x < button.x + button.width && hintBox.x + hintBox.width > button.x &&
      hintBox.y < button.y + button.height && hintBox.y + hintBox.height > button.y
    expect(overlapsButton).toBe(false)
  })
}

test('gives way to the reason of a delete button held off, which shows in the hint\'s place', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const trash = dialog.getByRole('button', { name: 'Delete account', exact: true })

  await trash.hover()
  await expect(hintWith(page, 'Delete account')).toHaveCSS('opacity', '1')
  await expect(page.locator('button[title]')).toHaveCount(0)

  await trash.click()
  await page.mouse.move(2, 2)
  await expect(trash).toHaveAttribute('aria-disabled', 'true')
  await trash.hover()
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: 'Finish or cancel deleting the account first' })).toHaveCSS('opacity', '1')
  await expectNoHintShown(page)
})

test.describe('on a touch screen', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 } })

  test('runs the action on a tap and shows no hint', async ({ page, request }) => {
    await openDashboard(page, request)

    await breakdownToggle(page, 'income').tap()
    await expect(breakdownToggle(page, 'spending')).toBeVisible()
    await expectNoHintShown(page)
  })
})
