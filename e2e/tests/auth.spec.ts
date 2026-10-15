import { expect, test, type Route } from '@playwright/test'

import { signUpUser, TEST_PASSWORD } from '../support/api'
import { expectSignedIn, logIn, waitForPageReady } from '../support/app'
import { navigate } from '../support/insights'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: signing up, in and out give the same result at every size

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

// The backend's email validator refuses reserved domains such as example.test, which the form's own
// check lets through, and the page says the address is the problem rather than that something went wrong
test('says the email address is the problem when signup refuses it', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('First name').fill('Test')
  await page.getByLabel('Email').fill(`e2e-${crypto.randomUUID()}@example.test`)
  await page.getByLabel('Password', { exact: true }).fill(TEST_PASSWORD)
  await page.getByLabel('Confirm password').fill(TEST_PASSWORD)
  await page.getByRole('button', { name: 'Sign up' }).click()

  await expect(page.getByText('Enter a valid email address', { exact: true })).toBeVisible()
  await expect(page.getByText('Something went wrong. Please try again.', { exact: true })).toHaveCount(0)
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
  const readSessionFlag = () => page.evaluate(() => localStorage.getItem('lumina:has_session'))
  const session = await readSessionFlag()
  expect(session).not.toBeNull()

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
  expect(await readSessionFlag()).toBe(session)
  await expect(page.getByText("The app can't reach the server right now. Reload once your connection is back.")).toBeVisible()

  // A reload while the server is still down lands on the same screen, the session still kept
  await reload.click()
  await expect.poll(() => restores).toBe(4)
  await expect(reload).toBeVisible()
  expect(await readSessionFlag()).toBe(session)

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

// A tab left open past its sign-in's 15-minute lifetime renews once before its next page's requests,
// rather than sending each with a sign-in the server would refuse. The server's own clock doesn't move
// here, so this sees only the renewal; the client's unit tests cover the requests it saves
test('renews a sign-in that aged out while the tab sat open, once, before the next page loads', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const openedAt = Date.now()
  await page.clock.setFixedTime(openedAt)
  await logIn(page, user)

  const renewals: string[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/auth/refresh`) renewals.push(sent.method())
  })
  await page.clock.setFixedTime(openedAt + 20 * 60_000)
  // The page can show what it already holds as ready before its own requests go out, so the renewal
  // is awaited rather than read straight after
  const renewed = page.waitForRequest(`${API_BASE_URL}/auth/refresh`)
  await navigate(page, 'Transactions')
  await renewed
  await waitForPageReady(page)

  expect(renewals).toEqual(['POST'])
})
