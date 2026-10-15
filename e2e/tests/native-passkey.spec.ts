import { expect, test, type CDPSession, type Page } from '@playwright/test'

import { asUser, signUpUser } from '../support/api'
import { addPasskeyAuthenticator } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the Apple apps open this page in a system sheet, the same at every size

/**
 * Runs the page's passkey prompt with the server's options and returns the credential it sends the
 * app. Chrome won't open a luminafinance:// address, so the page's request to go there is read instead
 */
async function runNativeCeremony(page: Page, cdp: CDPSession, ceremony: 'create' | 'get', options: string) {
  const callback = new Promise<URL>((resolve) => {
    const listener = ({ url }: { url: string }) => {
      if (!url.startsWith('luminafinance:')) return
      cdp.off('Page.frameRequestedNavigation', listener)
      resolve(new URL(url))
    }
    cdp.on('Page.frameRequestedNavigation', listener)
  })
  // Each sheet opens the page afresh, where a change of fragment alone wouldn't load it again
  await page.goto('about:blank')
  await page.goto(`/native/passkey#${new URLSearchParams({ ceremony, options })}`)
  const credential = (await callback).searchParams.get('credential')
  expect(credential).toBeTruthy()
  return JSON.parse(credential ?? '') as unknown
}

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
