import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser, TEST_PASSWORD } from '../support/api'
import { expectSignedIn, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

const RESTART_MESSAGE = 'Oops, something went wrong. Please start again.'

/**
 * Accept any code at confirm and refuse the final step, as the server does once a staged setup has
 * expired. Only the response decides what the screen shows, so the real secret and code don't matter
 */
async function failFinishingAuthenticatorSetup(page: Page): Promise<void> {
  await page.route(`${API_BASE_URL}/auth/2fa/confirm`, (route) =>
    route.fulfill({ json: { recovery_codes: Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-cccc-dddd-${i}000`) } }))
  await page.route(`${API_BASE_URL}/auth/2fa/complete`, (route) =>
    route.fulfill({ status: 400, json: { detail: 'Confirm an authenticator code first' } }))
}

/**
 * Enter a code, acknowledge the recovery codes and try to finish, which the routes above refuse. The
 * scope is the screen holding the setup, since settings keeps its own Done button behind the dialog
 */
async function reachFailedFinish(screen: Locator): Promise<void> {
  await screen.getByLabel('One-time code').pressSequentially('123456')
  await screen.getByRole('button', { name: 'Confirm' }).click()
  await screen.getByLabel("I've saved my recovery codes").check()
  await screen.getByLabel(/I understand I may be permanently locked out/).check()
  await screen.getByRole('button', { name: 'Done' }).click()

  await expect(screen.getByRole('alert')).toHaveText(RESTART_MESSAGE)
  await expect(screen.getByRole('button', { name: 'Done' })).toHaveCount(0)
  await expect(screen.getByRole('button', { name: 'Start again' })).toBeFocused()
}

test('starts sign-up authenticator setup over with a fresh secret when finishing fails', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill(`e2e-${crypto.randomUUID()}@example.com`)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign up' }).click()

  // A passkey is offered first where the origin supports one, with the authenticator one link away
  const authenticatorInstead = page.getByRole('button', { name: 'Use an authenticator app instead' })
  const setupHeading = page.getByRole('heading', { name: 'Set up two-factor authentication' })
  await expect(authenticatorInstead.or(setupHeading)).toBeVisible()
  if (await authenticatorInstead.isVisible()) await authenticatorInstead.click()

  const secret = page.getByRole('button', { name: 'Copy key' })
  const firstSecret = await secret.textContent()
  await failFinishingAuthenticatorSetup(page)
  await reachFailedFinish(page.locator('body'))

  // A restart that can't mint a new secret offers to retry rather than showing the abandoned one
  const setupUrl = `${API_BASE_URL}/auth/2fa/setup`
  await page.route(setupUrl, (route) => route.fulfill({ status: 400, json: { detail: 'Setup unavailable' } }))
  await page.getByRole('button', { name: 'Start again' }).click()
  const retry = page.getByRole('button', { name: "Couldn't start setup. Try again" })
  await expect(retry).toBeVisible()
  await expect(secret).toHaveCount(0)

  await page.unroute(setupUrl)
  await retry.click()
  await expect(setupHeading).toBeVisible()
  await expect(secret).not.toHaveText(firstSecret ?? '')

  await page.unrouteAll()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'I still want to skip' }).click()
  await expectSignedIn(page)
})

test('reopens the settings step-up when finishing authenticator setup fails', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()
  await page.getByPlaceholder('Current password').fill(user.password)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('heading', { name: 'Set up two-factor authentication' })).toBeVisible()

  await failFinishingAuthenticatorSetup(page)
  await reachFailedFinish(page.getByRole('dialog', { name: /Set up two-factor authentication|Save your recovery codes/ }))

  // Settings minted the secret behind its own prompt, so starting again asks to confirm it's you again
  await page.getByRole('button', { name: 'Start again' }).click()
  await expect(page.getByRole('heading', { name: 'Turn on two-factor authentication' })).toBeVisible()
  await expect(page.getByPlaceholder('Current password')).toHaveValue('')
})

test('reopens the regenerate step-up when saving new recovery codes fails', async ({ page, request }) => {
  const user = await signUpUser(request)

  // Report an authenticator as on and stand in for the server's step-up, so the account needs no real
  // factor, then refuse saving the new codes as the server does once the batch has expired
  await page.route(`${API_BASE_URL}/auth/2fa/status`, (route) => route.fulfill({ json: { totp_enabled: true } }))
  await page.route(`${API_BASE_URL}/auth/2fa/recovery-codes`, (route) =>
    route.fulfill({ json: { recovery_codes: Array.from({ length: 10 }, (_, i) => `aaaa-bbbb-cccc-dddd-${i}000`) } }))
  await page.route(`${API_BASE_URL}/auth/2fa/recovery-codes/confirm`, (route) =>
    route.fulfill({ status: 400, json: { detail: 'No pending recovery codes to confirm' } }))

  await logInViaApi(page, user)
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Regenerate' }).click()
  const stepUp = page.getByRole('dialog', { name: 'Regenerate recovery codes' })
  await stepUp.getByPlaceholder('Current password').fill(user.password)
  await stepUp.getByRole('button', { name: 'Continue' }).click()
  await stepUp.getByLabel('One-time code').pressSequentially('123456')
  await stepUp.getByRole('button', { name: 'Regenerate' }).click()

  const codes = page.getByRole('dialog', { name: 'Your new recovery codes' })
  await codes.getByLabel("I've saved my new recovery codes").check()
  await codes.getByLabel(/I understand that losing my recovery codes/).check()
  await codes.getByRole('button', { name: 'Done' }).click()
  await expect(codes.getByRole('alert')).toHaveText(RESTART_MESSAGE)
  await expect(codes.getByRole('button', { name: 'Done' })).toHaveCount(0)

  await codes.getByRole('button', { name: 'Start again' }).click()
  await expect(stepUp.getByPlaceholder('Current password')).toHaveValue('')
  await expect(codes).toHaveCount(0)
})

test('returns sign-up passkey setup to naming the passkey when activating it fails', async ({ page }) => {
  // A virtual authenticator answers the browser's passkey prompt, so registration runs for real
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true },
  })

  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill(`e2e-${crypto.randomUUID()}@example.com`)
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

  // Refuse activation as the server does once the staged passkey has expired
  await page.route(`${API_BASE_URL}/auth/passkeys/register/confirm`, (route) =>
    route.fulfill({ status: 400, json: { detail: 'No passkey awaiting confirmation' } }))
  await page.getByLabel("I've saved my recovery codes").check()
  await page.getByLabel(/I understand I may be permanently locked out/).check()
  await page.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByRole('alert')).toHaveText(RESTART_MESSAGE)
  await expect(page.getByRole('button', { name: 'Done' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Start again' }).click()
  await expect(page.getByRole('heading', { name: 'Protect your account with a passkey' })).toBeVisible()
  await expect(passkeyName).toBeVisible()
})
