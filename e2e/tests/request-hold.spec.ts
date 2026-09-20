import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { whileApiRequestHeld } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// Keep a real response in flight after dispatch to expose premature post-save assertions
const NETWORK_LATENCY_MS = 1_000

test('waits for a held mutation response on a slow connection', async ({ page, request }) => {
  const user = await signUpUser(request)
  const path = '/auth/login'
  let completed = false
  page.on('response', (response) => {
    if (response.url() === `${API_BASE_URL}${path}` && response.request().method() === 'POST') completed = true
  })
  await page.goto('/login')
  await page.setContent('<button>Save</button>')
  await page.evaluate(({ url, email, password }) => {
    document.querySelector('button')!.onclick = () => {
      void fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }).catch(() => {})
    }
  }, { url: `${API_BASE_URL}${path}`, email: user.email, password: user.password })
  const connection = await page.context().newCDPSession(page)
  await connection.send('Network.enable')
  await connection.send('Network.emulateNetworkConditions', {
    offline: false, latency: NETWORK_LATENCY_MS, downloadThroughput: -1, uploadThroughput: -1,
  })

  await whileApiRequestHeld(page, 'POST', path,
    () => page.getByRole('button', { name: 'Save' }).click(),
    async () => { expect(completed).toBe(false) })

  expect(completed, 'The server response must finish before post-save assertions begin').toBe(true)
})
