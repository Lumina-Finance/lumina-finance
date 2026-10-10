import { expect, test, type Route } from '@playwright/test'

import { signUpUser, TEST_PASSWORD } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'

test('signs a new user up through the form', async ({ page }) => {
  const email = `e2e-${crypto.randomUUID()}@example.com`

  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)

  // Timezone and base currency keep the browser's own defaults, which the config pins, so the
  // form needs no answer for either. Their existing native labels also leave both controls
  // addressable when another test needs to change those defaults

  // Submit stays disabled until the currency list arrives, which Playwright waits out
  await page.getByRole('button', { name: 'Sign up' }).click()

  // The app offers a second factor before letting anyone in, a passkey where the origin
  // supports one and an authenticator app otherwise. Both branches carry these same two
  // controls, so one path works against a domain and against a bare address alike
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.getByRole('button', { name: 'I still want to skip' }).click()

  await expectSignedIn(page)
})

test('signs an existing user in with their password', async ({ page, request }) => {
  const user = await signUpUser(request)

  await logIn(page, user)

  await expectSignedIn(page)
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

  await expectSignedIn(page)
})

test('keeps the session through a load the server cannot answer, and restores it on reload', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logIn(page, user)

  // The server answers the restore and the reachability probe with 503, as it does while restarting.
  // The headers let the browser read the status, so the app sees a server error rather than a
  // dropped request
  let restores = 0
  const answerUnavailable = async (route: Route) => {
    if (route.request().url().endsWith('/auth/refresh')) restores += 1
    await route.fulfill({
      status: 503,
      headers: {
        'Access-Control-Allow-Origin': route.request().headers()['origin'],
        'Access-Control-Allow-Credentials': 'true',
      },
      body: '',
    })
  }
  await page.route('**/auth/refresh', answerUnavailable)
  await page.route('**/version', answerUnavailable)
  await page.goto('/')

  const reload = page.getByRole('button', { name: 'Reload', exact: true })
  await expect(reload).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/')
  expect(restores).toBe(2)
  expect(await page.evaluate(() => localStorage.getItem('lumina:has_session'))).toBe('1')
  await expect(page.getByText("The app can't reach the server right now. Reload once your connection is back.")).toBeVisible()

  // A reload while the server is still down lands on the same screen, the session still kept
  await reload.click()
  await expect.poll(() => restores).toBe(4)
  await expect(reload).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('lumina:has_session'))).toBe('1')

  // Once the server is back, the kept session restores on the reload the screen offers
  await page.unroute('**/auth/refresh')
  await page.unroute('**/version')
  await reload.click()

  await expectSignedIn(page)
})

test('signs the user out when the server refuses the session on load', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logIn(page, user)

  // A session revoked on another device is refused with 401, which no retry or reload can change
  await page.route('**/auth/refresh', (route) => route.fulfill({
    status: 401,
    headers: {
      'Access-Control-Allow-Origin': route.request().headers()['origin'],
      'Access-Control-Allow-Credentials': 'true',
    },
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Session is not active' }),
  }))
  await page.goto('/')

  await page.waitForURL((url) => url.pathname === '/login')
  expect(await page.evaluate(() => localStorage.getItem('lumina:has_session'))).toBeNull()
})
