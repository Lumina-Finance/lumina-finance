import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { waitForResetLink } from '../support/mail'

// Runs on desktop only: asking for a link and choosing a password behave the same at every size

const NEW_PASSWORD = 'N3wE2ePassw0rd!'

test('resets a forgotten password through the emailed link', async ({ page, request }) => {
  const user = await signUpUser(request)

  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
  await page.getByLabel('Email').fill(user.email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(`If an account exists for ${user.email}`)).toBeVisible()

  // The link is the only way to the new-password form, and it chooses the account
  await page.goto(await waitForResetLink(user.email))
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('Confirm new password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Reset password' }).click()
  await expect(page.getByText('Your password has been reset. You can now log in with your new password.')).toBeVisible()

  // The old password stops working and the new one signs in
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()
  await logIn(page, { ...user, password: NEW_PASSWORD })
  await expectSignedIn(page)
})
