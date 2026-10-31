import { expect, test } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { addPasskeyAuthenticator, expectSignedIn, runNativeCeremony } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the login page's passkey button behaves the same at every size

test("signs in with the login page's passkey button", async ({ page, request }) => {
  const cdp = await addPasskeyAuthenticator(page)
  await cdp.send('Page.enable')
  const user = await signUpUser(request)
  const headers = asUser(user)

  // A passkey registered over the API, through the same prompt the app's own settings use
  const registerOptions = await request.post(`${API_BASE_URL}/auth/passkeys/register/options`, {
    headers,
    data: { step_up: { password: user.password } },
  })
  const created = await runNativeCeremony(page, cdp, 'create', await registerOptions.text())
  const registered = await request.post(`${API_BASE_URL}/auth/passkeys/register`, {
    headers,
    data: { name: 'Laptop', credential: created },
  })
  expect(registered.status()).toBe(201)
  expect((await request.post(`${API_BASE_URL}/auth/passkeys/register/confirm`, { headers })).status()).toBe(204)

  await page.goto('/login')
  const signedIn = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/passkeys/authenticate` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  expect((await signedIn).status()).toBe(200)

  await expectSignedIn(page)
})
