import { expect, test } from '@playwright/test'

import { signUpUser, TEST_PASSWORD } from '../support/api'
import { expectSignedIn, reachTwoFactorChallenge } from '../support/app'
import { API_BASE_URL } from '../support/target'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs on desktop only: the second-factor step behaves the same at every size

const VERIFY_URL = `${API_BASE_URL}/auth/2fa/verify`

// Longer than an authenticator code, so a recovery code sent as soon as six characters were in would
// show as a shorter code in the request
const RECOVERY_CODE = 'aaaa-bbbb-cccc-dddd-0000'

test('sends the code once when the challenge is submitted again while it is checked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const secret = await enrollTotp(request, user)

  // Hold the first verification, so a second submission lands while it is still in flight
  let verifyRequests = 0
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  await page.route(VERIFY_URL, async (route) => {
    verifyRequests += 1
    await released
    await route.continue()
  })

  // A code submits itself once its last digit is typed
  await reachTwoFactorChallenge(page, user)
  await page.getByLabel('One-time code').pressSequentially(currentTotp(secret))
  await expect.poll(() => verifyRequests).toBe(1)

  // A password manager can submit the form from a script while the first answer is pending
  await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  release()

  await expectSignedIn(page)
  expect(verifyRequests).toBe(1)
})

test('waits for Verify before sending a recovery code', async ({ page, request }) => {
  const user = await signUpUser(request)
  await enrollTotp(request, user)

  // Only the request matters here, so the answer refuses the code without spending a real one
  const sentCodes: string[] = []
  await page.route(VERIFY_URL, (route) => {
    sentCodes.push((route.request().postDataJSON() as { code: string }).code)
    return route.fulfill({ status: 401, json: { detail: 'Invalid code' } })
  })

  await reachTwoFactorChallenge(page, user)
  await page.getByRole('button', { name: 'Enter a recovery code instead' }).click()
  await page.getByPlaceholder('Recovery code').pressSequentially(RECOVERY_CODE)

  // Verify's own request comes after any the typing sent, so waiting for it fences the count below
  const verified = page.waitForResponse(VERIFY_URL)
  await page.getByRole('button', { name: 'Verify' }).click()
  await verified
  expect(sentCodes).toEqual([RECOVERY_CODE])
})

// Authenticator apps show and copy the code as two groups of three, and the field once cut the pasted
// text at six characters, space included, which left five digits
test('takes all six digits of a code pasted with a space in the middle', async ({ page, request }) => {
  const user = await signUpUser(request)
  await enrollTotp(request, user)

  const sentCodes: string[] = []
  await page.route(VERIFY_URL, (route) => {
    sentCodes.push((route.request().postDataJSON() as { code: string }).code)
    return route.fulfill({ status: 401, json: { detail: 'Invalid code' } })
  })

  await reachTwoFactorChallenge(page, user)
  const field = page.getByLabel('One-time code')
  await field.focus()
  await page.keyboard.insertText('123 456')

  await expect(field).toHaveValue('123456')
  await expect.poll(() => sentCodes).toEqual(['123456'])
})

test('leaves the challenge for a person\'s click on "Back to login" but not a scripted one', async ({ page, request }) => {
  const user = await signUpUser(request)
  const secret = await enrollTotp(request, user)
  const code = page.getByLabel('One-time code')
  const backToLogin = page.getByRole('button', { name: 'Back to login' })

  await reachTwoFactorChallenge(page, user)
  await backToLogin.click()
  await expect(code).toHaveCount(0)

  // A password manager clicks from a script, which the browser marks as untrusted. The step stays on
  // screen for a moment even as it leaves, so signing in with it afterwards is what shows it stayed
  await reachTwoFactorChallenge(page, user)
  await backToLogin.evaluate((button) => (button as HTMLButtonElement).click())
  const verified = page.waitForResponse(VERIFY_URL)
  await code.fill(currentTotp(secret))

  expect((await verified).status()).toBe(200)
  await expectSignedIn(page)
})

test('finishes a password reset once the code is filled', async ({ page }) => {
  // The suite can't read reset emails, so the reset and its second factor are answered here. Only
  // the answers decide what the page shows, so the token and code needn't be real ones
  const verifyBodies: unknown[] = []
  await page.route(`${API_BASE_URL}/auth/password/reset`, (route) => route.fulfill({
    json: { mfa_required: true, mfa_token: 'reset-challenge', totp_enabled: true, passkey_available: false, recovery_only: false },
  }))
  await page.route(`${API_BASE_URL}/auth/password/reset/verify`, (route) => {
    verifyBodies.push(route.request().postDataJSON())
    return route.fulfill({ status: 204 })
  })

  await page.goto('/reset-password?token=reset-token')
  await page.getByLabel('New password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm new password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Reset password' }).click()
  await page.getByLabel('One-time code').fill('123456')

  await expect(page.getByText('Your password has been reset.')).toBeVisible()
  expect(verifyBodies).toEqual([expect.objectContaining({ mfa_token: 'reset-challenge', code: '123456' })])
})
