import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { addPasskeyAuthenticator, expectSignedIn, registerPasskeyOverApi } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the login page's passkey button behaves the same at every size

test("signs in with the login page's passkey button", async ({ page, request }) => {
  const cdp = await addPasskeyAuthenticator(page)
  await cdp.send('Page.enable')
  const user = await signUpUser(request)

  // A passkey registered over the API, through the same prompt the app's own settings use
  await registerPasskeyOverApi(page, cdp, request, user, 'Laptop')

  await page.goto('/login')
  const signedIn = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/passkeys/authenticate` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  expect((await signedIn).status()).toBe(200)

  await expectSignedIn(page)
})
