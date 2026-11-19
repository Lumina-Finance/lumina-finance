import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { requestResetLink, submitNewPassword } from '../support/reset'
import { ON_ARM64 } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: asking for a link and choosing a password behave the same at every size

const NEW_PASSWORD = 'N3wE2ePassw0rd!'
const PROVIDER_WARNING = 'Resetting your password also removes your linked sign-in provider. You can link it again in Settings.'
const PROVIDER_REMOVED = 'Your linked sign-in provider was removed. You can link it again in Settings.'

test('warns before a reset removes a linked sign-in provider, and says so after', async ({ page }) => {
  // The suite can't link an identity provider, so the link check and the reset's answer are stubbed.
  // Only those answers decide what the form and the success screen show
  await page.route(`${API_BASE_URL}/auth/password/reset/check`, (route) => route.fulfill({ json: { sign_in_providers_linked: 1 } }))
  await page.route(`${API_BASE_URL}/auth/password/reset`, (route) => route.fulfill({ json: { sign_in_providers_removed: 1 } }))

  await page.goto('/reset-password?token=stubbed-reset-token')
  await expect(page.getByText(PROVIDER_WARNING)).toBeVisible()
  await submitNewPassword(page, NEW_PASSWORD)

  await expect(page.getByText('Your password has been reset. You can now log in with your new password.')).toBeVisible()
  await expect(page.getByText(PROVIDER_REMOVED)).toBeVisible()
})

// The arm64 test of emails, with templates rendered by markupsafe, compiled for the processor type
test('resets a forgotten password through the emailed link', ON_ARM64, async ({ page, request }) => {
  const user = await signUpUser(request)

  // The link is the only way to the new-password form, and it chooses the account. Its check answers
  // for this account, and the unit tests cover which counts show a warning
  const link = await requestResetLink(page, user.email)
  const checked = page.waitForResponse(`${API_BASE_URL}/auth/password/reset/check`)
  await page.goto(link)
  const checkAnswer = await checked
  expect(checkAnswer.ok()).toBe(true)
  expect(await checkAnswer.json()).toEqual({ sign_in_providers_linked: 0 })
  await submitNewPassword(page, NEW_PASSWORD)
  await expect(page.getByText('Your password has been reset. You can now log in with your new password.')).toBeVisible()
  await expect(page.getByText(/linked sign-in provider/)).toHaveCount(0)

  // The old password stops working and the new one signs in
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()
  await logIn(page, { ...user, password: NEW_PASSWORD })
  await expectSignedIn(page)
})
