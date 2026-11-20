import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { addPasskeyAuthenticator, expectSavedCacheEntry, expectSignedIn, registerPasskeyOverApi } from '../support/app'
import { ON_ARM64 } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the login page's passkey button behaves the same at every size

// The arm64 test of passkeys, with signatures checked by cryptography and data read by cbor2, both
// compiled for the processor type
test("signs in with the login page's passkey button", ON_ARM64, async ({ page, request }) => {
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
  // Confirming the first passkey turned on two-factor and so moved the key on once
  await expectSavedCacheEntry(page, 1)
})
