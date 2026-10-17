import { expect, test, type Page } from '@playwright/test'

import { signUpUser, type TestUser } from '../support/api'
import { expectSignedIn } from '../support/app'
import { API_BASE_URL } from '../support/target'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs on desktop only: the second-factor step behaves the same at every size

const VERIFY_URL = `${API_BASE_URL}/auth/2fa/verify`

/** Sign in with the password, which opens the second-factor step for a user with TOTP */
async function reachChallenge(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)

  // Exact, or it also matches the "Confirm password" field the signup form carries
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByLabel('One-time code')).toBeVisible()
}

test('sends the code once when the challenge is submitted again while it is checked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const secret = await enrollTotp(request, user)

  // Hold the first verification, so a second submission lands while it is still in flight
  let verifyRequests = 0
  let markFirstRequest!: () => void
  const firstRequest = new Promise<void>((resolve) => { markFirstRequest = resolve })
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  await page.route(VERIFY_URL, async (route) => {
    verifyRequests += 1
    markFirstRequest()
    await released
    await route.continue()
  })

  await reachChallenge(page, user)
  await page.getByLabel('One-time code').fill(currentTotp(secret))
  await page.getByRole('button', { name: 'Verify' }).click()
  await firstRequest

  // A password manager can submit the form from a script while the first answer is pending
  await page.locator('form').evaluate((form) => (form as HTMLFormElement).requestSubmit())
  release()

  await expectSignedIn(page)
  expect(verifyRequests).toBe(1)
})
