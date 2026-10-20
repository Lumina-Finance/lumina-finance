import { expect, test, type Page } from '@playwright/test'

import { TEST_PASSWORD } from '../support/api'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the new-password form behaves the same at every size

/** Open the reset form with both passwords filled in, as a password manager leaves it */
async function fillResetForm(page: Page): Promise<void> {
  // The suite can't read reset emails, so the token needn't be a real one
  await page.goto('/reset-password?token=reset-token')
  await page.getByLabel('New password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm new password').fill(TEST_PASSWORD)
}

test('stays on the reset form after a scripted click on "Back to login"', async ({ page }) => {
  await page.route(`${API_BASE_URL}/auth/password/reset`, (route) => route.fulfill({ status: 204 }))
  await fillResetForm(page)

  // A password manager clicks from a script, which the browser marks as untrusted. The page fades
  // out for a moment before it leaves, so finishing the reset afterwards is what shows it stayed
  await page.getByRole('button', { name: 'Back to login' }).evaluate((button) => (button as HTMLButtonElement).click())
  await page.getByRole('button', { name: 'Reset password' }).click()

  await expect(page.getByText('Your password has been reset.')).toBeVisible()
})

test('leaves the reset form for a person\'s click on "Back to login"', async ({ page }) => {
  await fillResetForm(page)
  await page.getByRole('button', { name: 'Back to login' }).click()
  await expect(page).toHaveURL(/\/login$/)
})

test('leaves the reset form for a key press on "Back to login"', async ({ page }) => {
  await fillResetForm(page)
  await page.getByRole('button', { name: 'Back to login' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/login$/)
})
