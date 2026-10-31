import { expect, test } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { addPasskeyAuthenticator, runNativeCeremony } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the Apple apps open this page in a system sheet, the same at every size

test('creates a passkey and signs in with it for the app that opened the page', async ({ page, request }) => {
  const cdp = await addPasskeyAuthenticator(page)
  await cdp.send('Page.enable')
  const user = await signUpUser(request)
  const headers = asUser(user)

  const registerOptions = await request.post(`${API_BASE_URL}/auth/passkeys/register/options`, {
    headers,
    data: { step_up: { password: user.password } },
  })
  const created = await runNativeCeremony(page, cdp, 'create', await registerOptions.text())
  const registered = await request.post(`${API_BASE_URL}/auth/passkeys/register`, {
    headers,
    data: { name: 'Phone', credential: created },
  })
  expect(registered.status()).toBe(201)
  expect((await registered.json()).recovery_codes).toBeTruthy()
  expect((await request.post(`${API_BASE_URL}/auth/passkeys/register/confirm`, { headers })).status()).toBe(204)

  const signInOptions = await request.post(`${API_BASE_URL}/auth/passkeys/authenticate/options`)
  const asserted = await runNativeCeremony(page, cdp, 'get', await signInOptions.text())
  const signedIn = await request.post(`${API_BASE_URL}/auth/passkeys/authenticate`, {
    headers: { 'X-Lumina-Client': 'native' },
    data: { credential: asserted },
  })
  expect(signedIn.status()).toBe(200)
  expect((await signedIn.json()).refresh_token).toBeTruthy()
})
