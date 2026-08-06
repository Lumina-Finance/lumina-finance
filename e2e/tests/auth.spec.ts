import { expect, test } from '@playwright/test'

import { signUpUser, TEST_PASSWORD } from '../support/api'
import { logIn } from '../support/app'

// Only the signed-in shell renders the primary navigation, so this is what says a spec reached
// the app. The dashboard's own heading cannot say it: the greeting is one of five chosen by the
// hour, and asserting on the heading role alone matches the auth page, which is also an h1
const SIGNED_IN = { role: 'link' as const, name: 'Accounts' }

test('signs a new user up through the form', async ({ page }) => {
  const email = `e2e-${crypto.randomUUID()}@example.com`

  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)

  // Timezone and base currency keep the browser's own defaults, which the config pins, so the
  // form needs no answer for either. Neither could be driven anyway: both are dropdowns with
  // no accessible name

  // Submit stays disabled until the currency list arrives, which Playwright waits out
  await page.getByRole('button', { name: 'Sign up' }).click()

  // The app offers a second factor before letting anyone in, a passkey where the origin
  // supports one and an authenticator app otherwise. Both branches carry these same two
  // controls, so one path works against a domain and against a bare address alike
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'I still want to skip' }).click()

  await expect(page.getByRole(SIGNED_IN.role, { name: SIGNED_IN.name })).toBeVisible()
})

test('signs an existing user in with their password', async ({ page, request }) => {
  const user = await signUpUser(request)

  await logIn(page, user)

  await expect(page.getByRole(SIGNED_IN.role, { name: SIGNED_IN.name })).toBeVisible()
})

test('refuses a wrong password before accepting the right one', async ({ page, request }) => {
  const user = await signUpUser(request)

  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill('WrongPassw0rd!')
  await page.getByRole('button', { name: 'Log in' }).click()

  // The backend answers "Invalid credentials" and the form shows this instead, so that a
  // wrong address and a wrong password cannot be told apart
  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()
  await expect(page).toHaveURL(/\/login$/)

  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.getByRole(SIGNED_IN.role, { name: SIGNED_IN.name })).toBeVisible()
})
