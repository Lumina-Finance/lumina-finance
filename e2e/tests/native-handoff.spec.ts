import { createHash, randomBytes } from 'node:crypto'

import { expect, test, type APIRequestContext, type APIResponse, type Page } from '@playwright/test'

import { enrollTotp, signUpUser, TEST_PASSWORD, totpCode } from '../support/api'
import { addPasskeyAuthenticator, chooseFromDropdown } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the Apple apps open this page in a system sheet, the same at every size

/** A PKCE verifier and its S256 challenge, as the app makes them */
function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

/**
 * Waits for the page's handoff and returns the code its redirect carries into the app. Chrome cancels
 * a jump to a luminafinance:// address from a page that was never tapped, as after a provider's
 * redirect, where the system sheet needs no tap, so the server's redirect is read here instead
 */
async function waitForHandoffCode(page: Page): Promise<string> {
  const response = await new Promise<APIResponse>((resolve) => {
    void page.route(`${API_BASE_URL}/auth/native/handoff`, async (route) => {
      resolve(await route.fetch({ maxRedirects: 0 }))
      await route.fulfill({ status: 204 })
    })
  })
  expect(response.status()).toBe(303)
  const location = new URL(response.headers().location)
  expect(`${location.protocol}//${location.host}${location.pathname}`).toBe('luminafinance://auth/callback')
  return location.searchParams.get('code') ?? ''
}

/**
 * Opens the sign-in page as the app does and waits for it to show, since the page remembers the
 * app's challenge only once it has rendered, and a provider sign-in leaves before the form is used
 */
async function openNativeSignIn(page: Page, challenge: string) {
  await page.goto(`/login?native_challenge=${challenge}`)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
}

/** Signs a new user in on the server and returns the response, which a provider sign-in answers with too */
async function serverSignIn(request: APIRequestContext): Promise<{ access_token: string; user: { email: string } }> {
  const user = await signUpUser(request)
  const response = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: user.password } })
  expect(response.status()).toBe(200)
  return response.json()
}

async function exchange(request: APIRequestContext, code: string, verifier: string) {
  return request.post(`${API_BASE_URL}/auth/native/exchange`, { data: { code, code_verifier: verifier } })
}

test('hands a password sign-in to the app that opened the page', async ({ page, request }) => {
  const user = await signUpUser(request)
  const { verifier, challenge } = pkcePair()

  await page.goto(`/login?native_challenge=${challenge}`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  const code = waitForHandoffCode(page)
  await page.getByRole('button', { name: 'Log in' }).click()

  const exchanged = await exchange(request, await code, verifier)
  expect(exchanged.status()).toBe(200)
  expect((await exchanged.json()).refresh_token).toBeTruthy()
})

test('hands a sign-in finished with an authenticator code to the app', async ({ page, request }) => {
  const user = await signUpUser(request)
  const secret = await enrollTotp(request, user)
  const { verifier, challenge } = pkcePair()

  await page.goto(`/login?native_challenge=${challenge}`)
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await page.getByLabel('One-time code').fill(totpCode(secret, 1))
  const code = waitForHandoffCode(page)
  await page.getByRole('button', { name: 'Verify', exact: true }).click()

  expect((await exchange(request, await code, verifier)).status()).toBe(200)
})

test('hands a passkey sign-in to the app', async ({ page, request }) => {
  await addPasskeyAuthenticator(page)
  await signedUpWithPasskey(page)
  const { verifier, challenge } = pkcePair()

  await page.goto(`/login?native_challenge=${challenge}`)
  const code = waitForHandoffCode(page)
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()

  expect((await exchange(request, await code, verifier)).status()).toBe(200)
})

test('hands a sign-in finished with a passkey second factor to the app', async ({ page, request }) => {
  await addPasskeyAuthenticator(page)
  const email = await signedUpWithPasskey(page)
  const { verifier, challenge } = pkcePair()

  await page.goto(`/login?native_challenge=${challenge}`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Log in' }).click()
  const code = waitForHandoffCode(page)
  await page.getByRole('button', { name: 'Verify with a passkey' }).click()

  expect((await exchange(request, await code, verifier)).status()).toBe(200)
})

// No identity provider runs beside the suite, so the provider's verdict is answered with a session
// the server really started, and the page's handoff and the exchange then run for real
test('hands a single sign-on to the app', async ({ page, request }) => {
  const signIn = await serverSignIn(request)
  const { verifier, challenge } = pkcePair()
  await page.route(`${API_BASE_URL}/auth/oidc/callback`, (route) => route.fulfill({ json: signIn }))

  await openNativeSignIn(page, challenge)
  const code = waitForHandoffCode(page)
  await page.goto('/auth/oidc/callback?code=provider-code&state=provider-state')

  expect((await exchange(request, await code, verifier)).status()).toBe(200)
})

test('hands a first single sign-on to the app once its account is created', async ({ page, request }) => {
  const signIn = await serverSignIn(request)
  const { verifier, challenge } = pkcePair()
  await page.route(`${API_BASE_URL}/auth/oidc/callback`, (route) => route.fulfill({
    json: { onboarding_required: true, onboarding_token: 'onboarding', email: signIn.user.email, first_name: 'Test', last_name: null },
  }))
  await page.route(`${API_BASE_URL}/auth/oidc/signup`, (route) => route.fulfill({ status: 201, json: signIn }))

  await openNativeSignIn(page, challenge)
  await page.goto('/auth/oidc/callback?code=provider-code&state=provider-state')
  await chooseFromDropdown(page.locator('body'), 'Base currency', /CAD/)
  const code = waitForHandoffCode(page)
  await page.getByRole('button', { name: 'Create account' }).click()

  expect((await exchange(request, await code, verifier)).status()).toBe(200)
})

test('hands a sign-up to the app once its passkey is set up', async ({ page, request }) => {
  await addPasskeyAuthenticator(page)
  const { verifier, challenge } = pkcePair()

  // The sign-in page remembers the app's challenge, and the sign-up link keeps it for the tab
  await page.goto(`/login?native_challenge=${challenge}`)
  await signUpWithPasskey(page)
  const code = waitForHandoffCode(page)
  await page.getByRole('button', { name: 'Done' }).click()

  const exchanged = await exchange(request, await code, verifier)
  expect(exchanged.status()).toBe(200)
  expect((await exchanged.json()).refresh_token).toBeTruthy()
})

/** Signs up in the page with a passkey as the second factor, then signs out, and returns the email */
async function signedUpWithPasskey(page: Page): Promise<string> {
  await page.goto('/login')
  const email = await signUpWithPasskey(page)
  const done = page.getByRole('button', { name: 'Done' })
  await done.click()
  await expect(done).toBeHidden()
  await page.context().clearCookies()
  return email
}

/** Signs up from the sign-in page with a passkey as the second factor, up to the last step, and returns the email */
async function signUpWithPasskey(page: Page): Promise<string> {
  const email = `e2e-${crypto.randomUUID()}@example.com`
  await page.getByRole('button', { name: 'Sign up' }).click()
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign up' }).click()

  // The default factor follows how the browser reports passkey support, so either step may come first
  const passkeyName = page.getByLabel('New passkey name')
  const passkeyInstead = page.getByRole('button', { name: 'Use a passkey instead' })
  await expect(passkeyName.or(passkeyInstead)).toBeVisible()
  if (await passkeyInstead.isVisible()) await passkeyInstead.click()
  await passkeyName.fill('Laptop')
  await page.getByRole('button', { name: 'Set up a passkey' }).click()
  await page.getByLabel("I've saved my recovery codes").check()
  await page.getByLabel(/I understand I may be permanently locked out/).check()
  return email
}
