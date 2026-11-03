import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { addPasskeyAuthenticator, expectSignedIn, logInViaApi, openPage, registerPasskeyOverApi } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the second-factor step behaves the same at every size

test('signs in with the password and then a passkey for a user whose second factor is a passkey', async ({ page, request }) => {
  const cdp = await addPasskeyAuthenticator(page)
  await cdp.send('Page.enable')
  const user = await signUpUser(request)

  // The only second factor is a passkey registered over the API, through the prompt the app's own settings use
  await registerPasskeyOverApi(page, cdp, request, user, 'Laptop')

  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByRole('link', { name: 'Accounts' })).toHaveCount(0)

  const verified = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/passkeys/mfa/verify` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Verify with a passkey' }).click()
  expect((await verified).status()).toBe(200)
  await expectSignedIn(page)
})

test('adds a passkey in settings and signs in with it from the login page', async ({ page, request }) => {
  await addPasskeyAuthenticator(page)
  const user = await signUpUser(request)

  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Multi-factor authentication' })
  await dialog.getByRole('button', { name: 'Add passkey' }).click()
  await dialog.getByLabel('New passkey name').fill('Laptop')
  await dialog.getByRole('button', { name: 'Add', exact: true }).click()

  // Adding a passkey asks for the password again, and the first second factor comes with recovery codes
  const stepUp = page.getByRole('dialog', { name: 'Add a passkey' })
  await stepUp.getByLabel('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Add passkey' }).click()
  await page.getByLabel("I've saved my new recovery codes").check()
  await page.getByLabel(/I understand that losing my recovery codes/).check()
  await page.getByRole('button', { name: 'Done' }).last().click()
  await expect(dialog.getByText('Laptop')).toBeVisible()

  // Leaving the session behind, the passkey alone signs in
  await page.context().clearCookies()
  await page.goto('/login')
  const signedIn = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/passkeys/authenticate` && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click()
  expect((await signedIn).status()).toBe(200)
  await expectSignedIn(page)
})
