/**
 * Guards the "Sign out of all other devices" control in Security settings: that a password confirms it,
 * that an account with no way to confirm cannot start it, that a provider reauth finishes it once, and
 * that focus returns to the button once its dialogue closes, although the dialogue's password field
 * takes focus as it opens
 */
import { expect, test, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { expectSignedIn, logInViaApi, openPage, waitForPageReady, waitForRequestsSoFar } from '../support/app'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only: the control and its dialogue behave the same at every size

const END_OTHERS_URL = `${API_BASE_URL}/auth/sessions/end-others`
const BUTTON_NAME = 'Sign out of all other devices'

/**
 * Counts the sign-out requests the page sends from here on
 */
function countEndOthersRequests(page: Page): () => number {
  let count = 0
  page.on('request', (sent) => {
    if (sent.url() === END_OTHERS_URL && sent.method() === 'POST') count += 1
  })
  return () => count
}

/**
 * Answers the account's linked providers, as an account that signs in without a password has them
 */
async function stubIdentities(page: Page, providers: string[]) {
  await page.route(`${API_BASE_URL}/auth/oidc/identities`, (route) => route.fulfill({
    json: {
      has_password: false,
      identities: providers.map((slug) => ({
        id: `identity-${slug}`,
        provider_slug: slug,
        provider_display_name: slug,
        email: 'someone@example.com',
        created_at: new Date().toISOString(),
        last_login_at: null,
      })),
    },
  }))
}

test('confirms signing out of other devices with the password and stays signed in', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  await page.locator('#security').getByRole('button', { name: BUTTON_NAME }).click()
  const dialog = page.getByRole('dialog', { name: BUTTON_NAME })
  await dialog.getByLabel('Current password').fill(user.password)
  const ended = page.waitForResponse((response) => response.url() === END_OTHERS_URL && response.request().method() === 'POST')
  await dialog.getByRole('button', { name: 'Sign out', exact: true }).click()
  expect((await ended).status()).toBe(204)

  await expect(dialog).toHaveCount(0)
  // The button shows its check mark now, so the result is its name
  await expect(page.locator('#security').getByRole('button', { name: 'Signed out of all other devices' })).toBeFocused()
  await expectSignedIn(page)

  // This browser's own session survives, so a fresh load is still signed in
  await openPage(page, '/settings#security')
  await expectSignedIn(page)
})

test('returns focus to the button when its dialogue closes without signing out', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const button = page.locator('#security').getByRole('button', { name: BUTTON_NAME })
  const dialog = page.getByRole('dialog', { name: BUTTON_NAME })
  // The close button shows only on a phone, and both ways out end through the same close
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(dialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(button).toBeFocused()
})

test('sends no sign-out request from the held-off button for an account with no way to confirm', async ({ page, request }) => {
  const user = await signUpUser(request)
  const endOthersRequests = countEndOthersRequests(page)
  // Answered here in place of an account left with only a passkey. Building one takes a provider sign-in
  // and a passkey ceremony
  await stubIdentities(page, [])
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const button = page.locator('#security').getByRole('button', { name: BUTTON_NAME })
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  // Forced, since the button says it is unavailable and a plain click would wait for it to be enabled
  await button.click({ force: true })
  await button.focus()
  await page.keyboard.press('Enter')

  await waitForRequestsSoFar(page)
  expect(endOthersRequests()).toBe(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('finishes a passwordless sign-out once after the provider reauth and not again on reload', async ({ page, request }) => {
  const user = await signUpUser(request)
  const endOthersRequests = countEndOthersRequests(page)
  await stubIdentities(page, ['stub-provider'])

  // The reauth is stubbed end to end, with the provider's page replaced by its return to the app
  await page.route(`${API_BASE_URL}/auth/oidc/reauth`, (route) => route.fulfill({
    json: { authorization_url: `${BASE_URL}/auth/oidc/callback?code=stub-code&state=stub-state` },
  }))
  await page.route(`${API_BASE_URL}/auth/oidc/reauth/callback`, (route) => route.fulfill({ status: 204 }))
  await page.route(END_OTHERS_URL, (route) => route.fulfill({ status: 204 }))

  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: BUTTON_NAME }).click()

  await expect.poll(endOthersRequests).toBe(1)
  await waitForPageReady(page)
  await waitForRequestsSoFar(page)
  expect(endOthersRequests()).toBe(1)

  await page.reload()
  await waitForPageReady(page)
  await waitForRequestsSoFar(page)
  expect(endOthersRequests()).toBe(1)
})
