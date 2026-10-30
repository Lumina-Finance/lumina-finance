import { test } from '@playwright/test'

import { TEST_PASSWORD } from '../support/api'
import { checkSubmitTransition } from '../support/buttonFrames'

// Runs at 390px and 1280px wide, both set here: the button fills the form's width at both and shrinks
// to its circle from there

for (const size of [{ width: 390, height: 844 }, { width: 1280, height: 800 }]) {
  test(`fades the reset password button's label and spinner and eases its width at ${size.width}px wide`, async ({ page }) => {
    await page.setViewportSize(size)
    // The suite can't read reset emails, so the token needn't be a real one
    await page.goto('/reset-password?token=reset-token')
    await page.getByLabel('New password', { exact: true }).fill(TEST_PASSWORD)
    await page.getByLabel('Confirm new password').fill(TEST_PASSWORD)

    const button = page.getByRole('button', { name: 'Reset password', exact: true })
    await checkSubmitTransition(page, button, 'Reset password', { method: 'POST', path: '/auth/password/reset' })
  })
}
