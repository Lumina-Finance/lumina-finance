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
  await stepUp.getByLabel('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()
  await stepUp.getByLabel('One-time code').pressSequentially('123456')
  await stepUp.getByRole('button', { name: 'Regenerate' }).click()
}

// The codes, the warning and both boxes run taller than a phone or a 1280x800 window, and Done once sat
// below the fold with nothing showing there was more
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

    // The codes scroll under the footer, while Done stays where it is
    const doneTop = (await done.boundingBox())!.y
    await codes.getByText(RECOVERY_CODES[0]).hover()
    // Scrolled all the way, since the footer once rode up by the body's padding only at the end. The
    // content runs taller than the panel, so the body really scrolls
    const body = codes.locator('.app-modal-body')
    await page.mouse.wheel(0, 2000)
    await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
    await expect
      .poll(() => body.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop))
      .toBeLessThanOrEqual(1)
    await expect(done).toBeInViewport({ ratio: 1 })
    expect((await done.boundingBox())!.y).toBeCloseTo(doneTop, 0)
  })
}
