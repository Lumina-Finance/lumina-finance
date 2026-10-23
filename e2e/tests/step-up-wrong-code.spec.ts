import { expect, test } from '@playwright/test'

import { signUpUser, type TestUser } from '../support/api'
import { openPage } from '../support/app'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs on desktop only: the modal's code step behaves the same at every size

// A code the authenticator will not show for the next few steps, so Verify refuses it
const WRONG_CODE = '000000'

test('clears the code and refocuses its first box after a wrong code in the step-up modal', async ({ page, request }) => {
  const user: TestUser = await signUpUser(request)
  const secret = await enrollTotp(request, user)

  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('One-time code').fill(currentTotp(secret))
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))

  // Changing the password asks for the second factor in the step-up modal, which has only the code step
  await openPage(page, '/settings#security')
  const newPassword = `${user.password}-new1`
  await page.getByLabel('Current password').fill(user.password)
  await page.getByLabel('New password', { exact: true }).fill(newPassword)
  await page.getByLabel('Confirm new password').fill(newPassword)
  await page.locator('#security').getByRole('button', { name: 'Save' }).click()

  const code = page.getByLabel('One-time code')
  await expect(code).toBeFocused()
  await code.pressSequentially(WRONG_CODE)
  await expect(code).toHaveValue(WRONG_CODE)
  await page.getByRole('button', { name: 'Verify' }).click()

  // Announced, since focus stays in the code field
  await expect(page.getByRole('alert')).toContainText(/Your password or code was incorrect/)
  await expect(code).toHaveValue('')
  await expect(code).toBeFocused()

  // The next digit starts a fresh code in the first box, with the failure still on screen
  await page.keyboard.type('1')
  await expect(code).toHaveValue('1')
  await expect(page.getByText(/Your password or code was incorrect/)).toBeVisible()
})
