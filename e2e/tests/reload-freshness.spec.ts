import { expect, test, type Page, type Route } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, startOfDayInTestTimezone } from '../support/api'
import {
  logIn,
  logInViaApi,
  openPage,
  readSavedCache,
  SAVED_QUERY_CACHE_KEY,
  waitForPageReady,
  waitForSavedCache,
} from '../support/app'
import { ON_ARM64 } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what a reload restores comes from browser storage, the same at every size

const ROTATED_PASSWORD = 'R0tatedE2ePassw0rd!'

// The fake clock holds the browser's own fades, so an element leaving would never go
test.use({ reducedMotion: 'reduce' })

/** Reload the document and wait for the restored page, with no pause that would let a late write land */
async function reload(page: Page) {
  await page.reload()
  await waitForPageReady(page)
}

/**
 * Freeze the clock of every tab in this browser at the time the stored copy was last saved
 *
 * The app's once-a-second save waits for a second to pass after its last write, so from then on it
 * never writes again in the open tabs and writes only once on each new load, as when a reload lands
 * inside that second. Only the save on hiding or unloading the page can then keep the copy current
 */
async function holdTimedSaves(page: Page) {
  const savedAt = (await readSavedCache(page))?.entry.savedAt
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

/**
 * Hide the page and wait for the save that starts then to reach local storage
 *
 * Encryption is asynchronous, so a reload straight after a change can't be counted on to find it
 * saved, and leaving the page removes a copy that lacks a change. A reload that has to find the change
 * waits here first
 */
async function hideAndWaitForSave(page: Page) {
  const before = (await readSavedCache(page))?.entry.nonce
  await setVisibility(page, 'hidden')
  await expect.poll(async () => {
    const nonce = (await readSavedCache(page))?.entry.nonce
    return nonce !== undefined && nonce !== before
  }).toBe(true)
}

// The arm64 test of Caddy, a binary the image adds for the processor type. Each reload of the deep
// link /transactions is answered by Caddy with the app's page, and the data after it is proxied to the API
test('keeps a transaction recorded elsewhere through two quick reloads, in an unused search too', ON_ARM64, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const coffee = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -500, notes: 'Coffee' })
  const market = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -2000, notes: 'Market' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const rows = page.getByTestId(/^transaction-row-/)
  const search = page.getByPlaceholder('Search transactions...', { exact: true })

  // Part of a word, so the stored copy holds it only in the search's own query, which then sits
  // unused in the cache
  await search.fill('offee')
  await expect(rows).toHaveCount(1)
  await search.fill('')
  await expect(rows).toHaveCount(2)
  await waitForSavedCache(page, ['"offee"', coffee, market])
  await holdTimedSaves(page)

  // Recorded over the API, so this window only learns of it from the server on the next load
  const added = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -700, notes: 'Coffee' })
  const addedRow = page.getByTestId(`transaction-row-${added}`)
  await reload(page)
  await expect(addedRow).toBeVisible()

  await hideAndWaitForSave(page)
  await reload(page)
  await expect(rows).toHaveCount(3)
  await expect(addedRow).toBeVisible()

  // The search was only marked as changed, never fetched again, and that mark has to be saved too
  await search.fill('offee')
  await expect(addedRow).toBeVisible()
  await expect(rows).toHaveCount(2)
})

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

  // The first tab's session ends when the second user signs in, so its next request is refused and it
  // renews through the shared cookie. Another tab's save already makes it ask the change check, so
  // that request can come at any point after the second sign-in, and the listeners go up before it.
  // A renewal between the log out and the sign-in finds no cookie and carries no token, so only the
  // one that does counts
  const renewed = page.waitForResponse(async (response) =>
    response.url() === `${API_BASE_URL}/auth/refresh` && response.ok() && 'access_token' in await response.json())
  const sentWith: string[] = []
  page.on('request', (sent) => {
    if (sent.url().startsWith(API_BASE_URL)) sentWith.push(sent.headers()['authorization'] ?? '')
  })

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
  const readFlag = () => page.evaluate(() => localStorage.getItem('lumina:has_session'))
  const flagBySecond = await readFlag()
  expect(flagBySecond).not.toBeNull()

  const secondToken = (await (await renewed).json() as { access_token: string }).access_token
  expect(secondToken).toEqual(expect.any(String))

  await page.waitForURL((url) => url.pathname.startsWith('/login'))
  await setVisibility(page, 'hidden')
  expect(sentWith).not.toContain(`Bearer ${secondToken}`)

  // The second tab may save again meanwhile, so the copy is checked for whose it is rather than
  // for being the same text. Only the tab that saved it can say what it holds
  expect(await readFlag()).toBe(flagBySecond)
  const copy = await readSavedCache(other)
  expect(copy?.entry.userId).toBe(flagBySecond)
  expect(copy?.text).toContain(secondRow)
  expect(copy?.text).not.toContain(firstRow)
})

// A load waits on its session before restoring the saved copy, and opens it only for the user that
// session belongs to. Another user signing in in a second tab meanwhile makes that session theirs, so
// the first user's copy must not show under it
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

// Changing the password ends the user's other sessions and raises their key number, while this
// browser keeps its own. Its next renewal returns the new number. The copy it saved under the
// old one no longer matches, so the copy is dropped unread rather than shown as fresh
test('drops the saved copy once the key number rises, and saves again under the new one', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Rotating Key Savings' })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const main = page.locator('#app-page-content')
  await expect(main.getByText('Rotating Key Savings').first()).toBeVisible()
  await waitForSavedCache(page, ['Rotating Key Savings'])
  const before = (await readSavedCache(page))!.entry
  expect(before.keyNumber).toBe(0)

  await openPage(page, '/settings')
  const security = page.locator('#security')
  await security.getByLabel('Current password', { exact: true }).fill(user.password)
  await security.getByLabel('New password', { exact: true }).fill(ROTATED_PASSWORD)
  await security.getByLabel('Confirm new password', { exact: true }).fill(ROTATED_PASSWORD)
  const changed = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/auth/password` && response.request().method() === 'PATCH')
  await security.getByRole('button', { name: 'Save', exact: true }).click()
  expect((await changed).ok()).toBe(true)

  // The accounts request is held, so anything on screen from it can only have come from the copy
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  let isHeld = false
  await page.route(`${API_BASE_URL}/accounts`, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    isHeld = true
    await released
    return route.fallback()
  })
  await page.goto('/accounts')
  await expect.poll(() => isHeld).toBe(true)
  await expect(main.getByText('Rotating Key Savings')).toHaveCount(0)
  expect((await readSavedCache(page))?.entry.nonce).not.toBe(before.nonce)

  release()
  await expect(main.getByText('Rotating Key Savings').first()).toBeVisible()
  await waitForSavedCache(page, ['Rotating Key Savings'])
  expect((await readSavedCache(page))!.entry.keyNumber).toBe(1)
})

/** Answer a request with a status the browser can read, as a server that is up and refusing does */
function answerWith(status: number) {
  return (route: Route) => route.fulfill({
    status,
    headers: {
      'Access-Control-Allow-Origin': route.request().headers()['origin'],
      'Access-Control-Allow-Credentials': 'true',
    },
    body: '',
  })
}

test('settles the restore and shows the reload screen when the renewal is unavailable', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Unavailable Renewal Savings' })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  await waitForSavedCache(page, ['Unavailable Renewal Savings'])

  // A copy in the plain-text form an earlier version saved needs no key to be removed
  await page.evaluate(([storageKey]) => localStorage.setItem(storageKey, '{"buster":"old","clientState":{}}'), [SAVED_QUERY_CACHE_KEY])
  await page.route('**/auth/refresh', answerWith(503))
  await page.route('**/version', answerWith(503))
  await page.goto('/accounts')

  await expect(page.getByRole('button', { name: 'Reload', exact: true })).toBeVisible()
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), SAVED_QUERY_CACHE_KEY)).toBeNull()
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('lumina:has_session'))).not.toBeNull()
})

test('settles the restore and shows the login page when the renewal is refused', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Refused Renewal Savings' })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  await waitForSavedCache(page, ['Refused Renewal Savings'])

  await page.route('**/auth/refresh', answerWith(401))
  await page.goto('/accounts')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  expect(await page.evaluate((storageKey) => localStorage.getItem(storageKey), SAVED_QUERY_CACHE_KEY)).toBeNull()
})

test('opens the login page at once on a load with no session', async ({ page }) => {
  let renewals = 0
  await page.route('**/auth/refresh', (route) => {
    renewals += 1
    return route.fallback()
  })
  await page.goto('/accounts')

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  expect(renewals).toBe(0)
})

test('settles the restore when the renewal lost a rotation to another tab', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Rotated Renewal Savings' })
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  await waitForSavedCache(page, ['Rotated Renewal Savings'])

  await page.route('**/auth/refresh', (route) => route.fulfill({
    status: 409,
    contentType: 'application/json',
    headers: {
      'Access-Control-Allow-Origin': route.request().headers()['origin'],
      'Access-Control-Allow-Credentials': 'true',
    },
    body: JSON.stringify({ detail: 'Refresh token was already rotated' }),
  }))
  await page.goto('/accounts')

  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
})

// What a load that finds nothing changed may still ask for: the session renewal, the two checks and
// the answers no check covers (they fetch as before). Bank sync data is among them, since a screen
// reads it again whenever it mounts
const ALLOWED_ON_UNCHANGED_OPEN = new Set([
  '/auth/refresh',
  '/me/cache-status',
  '/me/rates-status',
  '/version',
  '/currencies',
  '/bank-sync/links',
  '/bank-sync/providers',
  '/bank-review/items',
  '/bank-review/backlogs',
  '/bank-sync/holds',
  '/bank-sync/pending',
])

/** The path of an API request below the API's own prefix, such as `/me/cache-status` for `/api/me/cache-status` */
function apiPath(url: string) {
  const prefix = new URL(API_BASE_URL).pathname.replace(/\/+$/, '')
  return new URL(url).pathname.slice(prefix.length)
}

/**
 * Wait until the first check of the session and the rates check after it have been recorded and the
 * refetch they start has finished, and the saved copy holds both
 *
 * Hiding the page saves only what changed since the last save, so the wait is for the copy's text to
 * hold the rates digest rather than for a new save
 */
async function waitForRecordedCheck(page: Page) {
  await page.waitForLoadState('networkidle')
  await setVisibility(page, 'hidden')
  await expect.poll(async () => (await readSavedCache(page))?.entry.observedAt).toEqual(expect.any(Number))
  await expect.poll(async () => (await readSavedCache(page))?.text ?? '').toContain('"ratesDigest":"')
  await setVisibility(page, 'visible')
}

// Opening with a restored copy asks the server's change check before any screen shows, and when it
// finds nothing different and the copy's last difference is under 30 days old, the restored answers
// are used as they are. The exchange-rate check follows without holding the screen back
test('requests no data beyond the checks when nothing changed since the saved copy', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Unchanged Savings' })
  const row = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000 })
  // The real time, pulled back only when the reopen ten minutes on would land on the next day in the
  // user's zone. The transactions overview is keyed on today, so a new day has nothing saved and the
  // app rightly fetches it. The page clock never runs ahead of the real time, so the server's own
  // times are never in its future
  const startOfTomorrow = startOfDayInTestTimezone(daysFromTodayInTestTimezone(1)).getTime()
  const openedAt = Math.min(Date.now(), startOfTomorrow - 11 * 60_000)
  await logInViaApi(page, user)
  await page.clock.install({ time: openedAt })
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${row}`)).toBeVisible()
  await waitForSavedCache(page, [row])
  await waitForRecordedCheck(page)

  const sent: string[] = []
  page.on('request', (event) => {
    if (event.url().startsWith(API_BASE_URL)) sent.push(apiPath(event.url()))
  })
  const ratesAnswered = page.waitForResponse((response) => response.url() === `${API_BASE_URL}/me/rates-status`)

  // Ten minutes on, so every restored answer is older than its five minutes and only the check's
  // answer keeps it from being fetched again
  await page.clock.setFixedTime(openedAt + 10 * 60_000)
  await page.goto('/transactions')
  await waitForPageReady(page)
  await expect(page.getByTestId(`transaction-row-${row}`)).toBeVisible()

  // The rate check's answer is the last one that can start a fetch, so the fence follows it
  await ratesAnswered
  const fence = '/version'
  await page.evaluate((url) => fetch(url), `${API_BASE_URL}${fence}`)
  const beforeFence = sent.slice(0, sent.lastIndexOf(fence))
  expect(beforeFence).toContain('/me/cache-status')
  expect(beforeFence).toContain('/me/rates-status')
  expect(beforeFence.filter((path) => !ALLOWED_ON_UNCHANGED_OPEN.has(path))).toEqual([])
})

test('fetches again on opening because the check found a change made through the API since the saved copy', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Changed Savings' })
  const first = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${first}`)).toBeVisible()
  await waitForSavedCache(page, [first])
  await waitForRecordedCheck(page)

  const added = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -700 })
  const refetched = page.waitForRequest((sent) => {
    return sent.url().startsWith(API_BASE_URL) && apiPath(sent.url()) === '/transactions'
  })
  await page.goto('/transactions')
  await waitForPageReady(page)

  await refetched
  await expect(page.getByTestId(`transaction-row-${added}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${first}`)).toBeVisible()
})

// Another tab that finds a change records it in the saved entry, and the storage event that write
// fires makes a tab already open check too, so it shows the change with no reload
test('shows a change in a tab that stayed open when another tab found it on opening', async ({ page, context, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Two Tab Savings' })
  const first = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${first}`)).toBeVisible()
  await waitForSavedCache(page, [first])
  await waitForRecordedCheck(page)

  const other = await context.newPage()
  await openPage(other, '/transactions')
  await setVisibility(other, 'visible')
  await expect(other.getByTestId(`transaction-row-${first}`)).toBeVisible()
  await other.waitForLoadState('networkidle')

  const added = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -700 })
  await page.goto('/transactions')
  await waitForPageReady(page)
  await expect(page.getByTestId(`transaction-row-${added}`)).toBeVisible()

  await expect(other.getByTestId(`transaction-row-${added}`)).toBeVisible()
})
