import { expect, test, type Page } from '@playwright/test'

import { signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, with each size set here: the sizes are what the footer is for

const RECOVERY_CODES = Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-cccc-dddd-${i}000`)

/**
 * Report an authenticator as on and stand in for the regeneration's step-up, so the account needs no real
 * factor. Set before the page loads, since it reads the status once
 */
async function standInForAuthenticator(page: Page): Promise<void> {
  await page.route(`${API_BASE_URL}/auth/2fa/status`, (route) => route.fulfill({ json: { totp_enabled: true } }))
  await page.route(`${API_BASE_URL}/auth/2fa/recovery-codes`, (route) =>
    route.fulfill({ json: { recovery_codes: RECOVERY_CODES } }))
}

/** Open the recovery codes a regeneration stages */
async function openNewRecoveryCodes(page: Page, user: TestUser): Promise<void> {
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Regenerate recovery codes' })
  await stepUp.getByPlaceholder('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()
  await stepUp.getByLabel('One-time code').pressSequentially('123456')
  await stepUp.getByRole('button', { name: 'Regenerate' }).click()
}

// The codes, the warning and both boxes run taller than a phone or a 1280x800 window, and Done once sat
// below the fold with nothing showing there was more, while the body scrolled under the close button
for (const size of [{ width: 390, height: 667 }, { width: 1280, height: 800 }]) {
  test(`keeps Done in view while the recovery codes scroll at ${size.width}x${size.height}`, async ({ page, request }) => {
    const user = await signUpUser(request)
    await page.setViewportSize(size)
    await standInForAuthenticator(page)
    await logInViaApi(page, user)
    await openPage(page, '/settings#security')
    await openNewRecoveryCodes(page, user)

    const codes = page.getByRole('dialog', { name: 'Your new recovery codes' })
    const done = codes.getByRole('button', { name: 'Done' })
    await expect(done).toBeInViewport({ ratio: 1 })

    // The first code scrolls out of view under the footer, while Done stays where it is
    const doneTop = (await done.boundingBox())!.y
    await codes.getByText(RECOVERY_CODES[0]).hover()
    await page.mouse.wheel(0, 400)
    await expect(done).toBeInViewport({ ratio: 1 })
    expect((await done.boundingBox())!.y).toBeCloseTo(doneTop, 0)

    // On a phone the close button has a row of its own, so the heading starts below it, and scrolling
    // takes the heading out of view rather than under the button
    const close = codes.getByRole('button', { name: 'Close' })
    if (await close.isVisible()) {
      await page.mouse.wheel(0, -400)
      const closeBox = (await close.boundingBox())!
      const headingTop = async () =>
        (await codes.getByRole('heading', { name: 'Your new recovery codes' }).boundingBox())!.y
      await expect.poll(headingTop).toBeGreaterThanOrEqual(closeBox.y + closeBox.height)
    }
  })
}
