import { expect, test, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import {
  logIn,
  logInViaApi,
  openPage,
  SAVED_QUERY_CACHE_KEY,
  waitForPageReady,
  waitForSavedCache,
} from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what a reload restores comes from browser storage, the same at every size

// The fake clock holds the browser's own fades, so an element leaving would never go
test.use({ reducedMotion: 'reduce' })

/**
 * Freeze the clock of every tab in this browser at the time the stored copy was last saved
 *
 * The app's once-a-second save waits for a second to pass after its last write, so from then on it
 * never writes again in the open tabs and writes only once on each new load, as when a reload lands
 * inside that second. Only the save on hiding or unloading the page can then keep the copy current
 */
async function holdTimedSaves(page: Page) {
  const savedAt = await page.evaluate((key) => {
    const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { timestamp?: number } | null
    return saved?.timestamp
  }, SAVED_QUERY_CACHE_KEY)
  expect(savedAt).toEqual(expect.any(Number))
  await page.clock.setFixedTime(savedAt!)
}

/** Show or hide the page as switching tabs does, which a headless browser's tabs never do themselves */
async function setVisibility(page: Page, state: 'visible' | 'hidden') {
  const shown = await page.evaluate((next) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => next === 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    return document.visibilityState
  }, state)
  expect(shown).toBe(state)
}

test('starts the next user from nothing after a sign-out and a reload', async ({ page, request }) => {
  const first = await signUpUser(request)
  const firstAccount = await createAccount(request, first, { name: 'First user chequing' })
  const firstRow = await createTransaction(request, first, { accountId: firstAccount.id, categoryName: 'Groceries', amount: -1000 })
  const second = await signUpUser(request)
  const secondAccount = await createAccount(request, second, { name: 'Second user chequing' })
  const secondRow = await createTransaction(request, second, { accountId: secondAccount.id, categoryName: 'Dining', amount: -2000 })

  // Signed in through the form, so no script puts the session flag back on the signed-out reload
  await logIn(page, first)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${firstRow}`)).toBeVisible()
  await waitForSavedCache(page, [firstRow])
  await holdTimedSaves(page)
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await page.waitForURL((url) => url.pathname.startsWith('/login'))
  await page.reload()

  await logInViaApi(page, second)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${secondRow}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${firstRow}`)).toHaveCount(0)
})

// Every tab shares the refresh cookie, so once another user signs in in a second tab, a renewal in the
// first returns that user's session. The first tab signs out rather than switch to them, and leaves the
// second user's session flag and saved copy alone
test('signs a tab out when its renewal returns a user signed in since in another tab', async ({ page, context, request }) => {
  const first = await signUpUser(request)
  const firstAccount = await createAccount(request, first, { name: 'First user chequing' })
  const firstRow = await createTransaction(request, first, { accountId: firstAccount.id, categoryName: 'Groceries', amount: -1000 })
  const second = await signUpUser(request)
  const secondAccount = await createAccount(request, second, { name: 'Second user chequing' })
  const secondRow = await createTransaction(request, second, { accountId: secondAccount.id, categoryName: 'Dining', amount: -2000 })

  await logIn(page, first)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${firstRow}`)).toBeVisible()

  // The second user signs in in another tab, which then saves its copy
  const other = await context.newPage()
  await openPage(other, '/transactions')
  await other.getByRole('button', { name: 'Log out', exact: true }).click()
  await other.waitForURL((url) => url.pathname.startsWith('/login'))
  await logIn(other, second)
  await openPage(other, '/transactions')
  await expect(other.getByTestId(`transaction-row-${secondRow}`)).toBeVisible()
  await setVisibility(other, 'hidden')
  await waitForSavedCache(other, [secondRow])
  const readStored = () => page.evaluate((key) =>
    [localStorage.getItem('lumina:has_session'), localStorage.getItem(key)], SAVED_QUERY_CACHE_KEY)
  const storedBySecond = await readStored()
  expect(storedBySecond[0]).not.toBeNull()

  // The first tab's next request is refused as expired, so it renews through the shared cookie
  const renewed = page.waitForResponse(`${API_BASE_URL}/auth/refresh`)
  const isSearch = (url: URL) => url.href.startsWith(`${API_BASE_URL}/transactions`) && url.search.includes('offee')
  await page.route(isSearch, (route) => route.fulfill({
    status: 401,
    headers: {
      'Access-Control-Allow-Origin': route.request().headers()['origin'],
      'Access-Control-Allow-Credentials': 'true',
      'Access-Control-Expose-Headers': 'WWW-Authenticate',
      'WWW-Authenticate': 'Bearer',
    },
    contentType: 'application/json',
    body: JSON.stringify({ detail: 'Token is not active' }),
  }), { times: 1 })
  const sentWith: string[] = []
  page.on('request', (sent) => {
    if (sent.url().startsWith(API_BASE_URL)) sentWith.push(sent.headers()['authorization'] ?? '')
  })
  await page.getByPlaceholder('Search transactions...', { exact: true }).fill('offee')
  const secondToken = (await (await renewed).json() as { access_token: string }).access_token
  expect(secondToken).toEqual(expect.any(String))

  await page.waitForURL((url) => url.pathname.startsWith('/login'))
  await setVisibility(page, 'hidden')
  expect(sentWith).not.toContain(`Bearer ${secondToken}`)

  // The second tab may save again meanwhile, so the copy is checked for whose it is rather than
  // for being the same text
  const [flag, copy] = await readStored()
  expect(flag).toBe(storedBySecond[0])
  expect(copy).toMatch(new RegExp(`"buster":"[^"]*:${flag}"`))
  expect(copy).toContain(secondRow)
  expect(copy).not.toContain(firstRow)
})

// A load restores the copy of the user the flag names, then waits on its session. Another user
// signing in in a second tab meanwhile makes that session theirs, so the restored copy must not
// show under it
test('drops a restored copy when the session that arrives belongs to another user', async ({ page, context, request }) => {
  const first = await signUpUser(request)
  const firstAccount = await createAccount(request, first, { name: 'First user chequing' })
  const firstRow = await createTransaction(request, first, { accountId: firstAccount.id, categoryName: 'Groceries', amount: -1000 })
  const second = await signUpUser(request)
  const secondAccount = await createAccount(request, second, { name: 'Second user chequing' })
  const secondRow = await createTransaction(request, second, { accountId: secondAccount.id, categoryName: 'Dining', amount: -2000 })

  await logIn(page, first)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${firstRow}`)).toBeVisible()
  await setVisibility(page, 'hidden')
  await waitForSavedCache(page, [firstRow])

  // The next load's session request waits until the second user has signed in elsewhere, then goes
  // out with the cookie the browser holds by then, which is theirs
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}/auth/refresh`, async (route) => {
    await released
    const renewed = await page.request.post(`${API_BASE_URL}/auth/refresh`)
    await route.fulfill({
      status: renewed.status(),
      headers: {
        'Access-Control-Allow-Origin': route.request().headers()['origin'],
        'Access-Control-Allow-Credentials': 'true',
        'Content-Type': 'application/json',
      },
      body: await renewed.body(),
    })
  })
  // A refetch could replace the first user's rows soon after they show, so the load records
  // whether they ever appeared
  await page.addInitScript((testId) => {
    new MutationObserver(() => {
      if (document.querySelector(`[data-testid="${testId}"]`)) Object.assign(window, { sawFirstUserRow: true })
    }).observe(document, { childList: true, subtree: true })
  }, `transaction-row-${firstRow}`)
  const restoring = page.waitForRequest(`${API_BASE_URL}/auth/refresh`)
  await page.goto('/transactions')
  await restoring

  const other = await context.newPage()
  await openPage(other, '/transactions')
  await other.getByRole('button', { name: 'Log out', exact: true }).click()
  await other.waitForURL((url) => url.pathname.startsWith('/login'))
  await logIn(other, second)

  release()
  await waitForPageReady(page)
  await expect(page.getByTestId(`transaction-row-${secondRow}`)).toBeVisible()
  expect(await page.evaluate(() => 'sawFirstUserRow' in window)).toBe(false)
})
