import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL } from '../support/target'

// Runs on desktop only: a closed instance hides sign-up and refuses newcomers the same way at every size

const CLOSED_DETAIL = 'Registration is closed on this instance'

/**
 * Answer the login page's status check as an instance with registration turned off. The suite can't
 * change the server's setting per test, and only this answer decides what the page offers
 */
async function closeRegistration(page: Page): Promise<void> {
  await page.route(`${API_BASE_URL}/auth/registration`, (route) => route.fulfill({ json: { enabled: false } }))
}

test('offers no sign-up on the login page while registration is closed', async ({ page }) => {
  await closeRegistration(page)
  const statusAnswered = page.waitForResponse(`${API_BASE_URL}/auth/registration`)

  await page.goto('/login')
  await statusAnswered

  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign up' })).toHaveCount(0)
})

test('sends the sign-up address to the login page while registration is closed', async ({ page }) => {
  await closeRegistration(page)

  await page.goto('/signup')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
})

test('returns a refused first-time provider sign-in to the login page with the reason', async ({ page }) => {
  // The callback is refused as the server refuses a newcomer on a closed instance, so no real
  // provider round trip is needed
  await page.route(`${API_BASE_URL}/auth/oidc/callback`, (route) =>
    route.fulfill({ status: 403, json: { detail: CLOSED_DETAIL } }))

  await page.goto('/auth/oidc/callback?code=any&state=any')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText('Registration is closed on this instance.')).toBeVisible()
})
