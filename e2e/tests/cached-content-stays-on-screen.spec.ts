/**
 * Guards every page holding saved data against fading that data away behind its loading animation
 * while it fetches a newer copy, so a fresh load shows it, hides it and shows it again
 */
import { expect, test, type Page, type Route } from '@playwright/test'

import { createAccount, createMonthlyBudget, createTransaction, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: whether a page has anything to show doesn't depend on its size

const EMPTY_BUDGETS_MESSAGE = 'No budgets to display'

/** Records, on every frame from the moment the page loads, which loading animations are showing */
async function recordLoadingFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = window as unknown as { loadingFrames: string[][]; frameCount: number }
    state.loadingFrames = []
    state.frameCount = 0
    const sample = () => {
      state.frameCount += 1
      const shown = [...document.querySelectorAll('[role="status"]')]
        .map((status) => status.getAttribute('aria-label') ?? status.textContent ?? '')
        .filter((label) => label.startsWith('Loading'))
      if (shown.length > 0) state.loadingFrames.push(shown)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
}

/** Forgets the frames so far, so only what follows counts */
async function clearLoadingFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { loadingFrames: string[][] }).loadingFrames = []
  })
}

/** Every loading animation seen since the last clear, once a further frame has been drawn */
async function readLoadingFrames(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve) => {
    const state = window as unknown as { loadingFrames: string[][] }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve([...new Set(state.loadingFrames.flat())])))
  }))
}

/** Holds the GET requests to one API path until the returned function is called */
async function holdRequest(page: Page, path: string): Promise<{ intercepted: () => boolean; release: () => void }> {
  let release!: () => void
  let intercepted = false
  const released = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}${path}`, async (route: Route) => {
    if (route.request().method() !== 'GET') return route.fallback()
    intercepted = true
    await released
    return route.fallback()
  })
  return { intercepted: () => intercepted, release }
}

/** A user with one account, one transaction and one budget tracking it, signed in with the frame recorder on */
async function seedSignedInUser(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user: TestUser = await signUpUser(request)
  const accountId = await createAccount(request, user, { name: 'Everyday Chequing' })
    .then((account) => account.id)
  const budgetId = await createMonthlyBudget(request, user, {
    name: 'Monthly Food',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
  })
  const spend = (amount: number) => createTransaction(request, user, { accountId, categoryName: 'Groceries', amount })
  await spend(-1000)
  await recordLoadingFrames(page)
  await logInViaApi(page, user)
  return { accountId, budgetId, spend }
}

test('keeps a budget on screen through a fresh load then a visit to Budgets, updating it in place', async ({ page, request }) => {
  const { budgetId, spend } = await seedSignedInUser(page, request)
  const card = page.getByTestId(`budget-card-${budgetId}`)
  await openPage(page, '/')
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Budgets', exact: true }).first().click()
  await expect(card).toContainText('$10.00 used')
  await expect(page.getByRole('status', { name: 'Loading budgets' })).toHaveCount(0)

  // Recorded over the API, so the next load learns of it from the server and marks the budget out of date
  await spend(-700)
  // Held from before the load, since a page on the way to Budgets may ask for the newer copy first
  const refetch = await holdRequest(page, '/budgets/latest-utilizations')
  const checked = page.waitForResponse(`${API_BASE_URL}/me/cache-status`)
  await page.goto('/')
  await checked
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)

  await clearLoadingFrames(page)
  await page.getByRole('link', { name: 'Budgets', exact: true }).first().click()
  await expect(card).toContainText('$10.00 used')
  await expect.poll(refetch.intercepted).toBe(true)
  expect(await readLoadingFrames(page)).toEqual([])

  refetch.release()
  await expect(card).toContainText('$17.00 used')
  expect(await readLoadingFrames(page)).toEqual([])
})

test('keeps Insights on screen through a fresh load then a visit to it', async ({ page, request }) => {
  const { spend } = await seedSignedInUser(page, request)
  const glance = page.getByText('This period at a glance').first()
  await openPage(page, '/')
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)
  await page.getByRole('link', { name: 'Insights', exact: true }).first().click()
  await expect(glance).toBeVisible()
  await expect(page.getByRole('status', { name: 'Loading period at a glance' })).toHaveCount(0)

  await spend(-700)
  const checked = page.waitForResponse(`${API_BASE_URL}/me/cache-status`)
  await page.goto('/')
  await checked
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0)

  await clearLoadingFrames(page)
  const answered = page.waitForResponse((response) => response.url().includes('/insights/period-glance'))
  await page.getByRole('link', { name: 'Insights', exact: true }).first().click()
  await expect(glance).toBeVisible()
  await answered
  expect(await readLoadingFrames(page)).toEqual([])
})

const SAVED_DATA_PAGES = [
  { name: 'Dashboard', path: () => '/', content: 'Monthly Food', refetch: () => '/budgets/latest-utilizations' },
  { name: 'Accounts', path: () => '/accounts', content: 'Everyday Chequing', refetch: () => '/dashboard/savings-rate' },
  {
    name: 'an account',
    path: (accountId: string) => `/accounts/${accountId}`,
    content: 'Everyday Chequing',
    refetch: (accountId: string) => `/accounts/${accountId}/snapshots`,
  },
  { name: 'Insights', path: () => '/insights', content: 'This period at a glance', refetch: () => '/insights/period-glance' },
  { name: 'Transactions', path: () => '/transactions', content: 'Everyday Chequing', refetch: () => '/transactions/overview' },
  { name: 'Budgets', path: () => '/budgets', content: 'Monthly Food', refetch: () => '/base-budgets' },
]

for (const { name, path, content, refetch } of SAVED_DATA_PAGES) {
  test(`keeps ${name} on screen when the check for changes answers after the page has drawn`, async ({ page, request }) => {
    const { accountId, spend } = await seedSignedInUser(page, request)
    const main = page.locator('#app-page-content')
    await openPage(page, path(accountId))
    await expect(main.getByText(content).first()).toBeVisible()
    await expect(main.getByRole('status').filter({ visible: true })).toHaveCount(0)

    await spend(-700)
    const check = await holdRequest(page, '/me/cache-status')
    await page.reload()
    await expect(main.getByText(content).first()).toBeVisible()
    await expect.poll(check.intercepted).toBe(true)
    await clearLoadingFrames(page)

    const refetched = refetch(accountId)
    const answered = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(refetched))
    check.release()
    await answered
    await expect(main.getByText(content).first()).toBeVisible()
    expect(await readLoadingFrames(page)).toEqual([])
  })
}

test('shows only the loading animation on a first visit until a budget is complete, then the budget once', async ({ page, request }) => {
  const { budgetId } = await seedSignedInUser(page, request)
  const utilizations = await holdRequest(page, '/budgets/latest-utilizations')
  const loading = page.getByRole('status', { name: 'Loading budgets' })
  const card = page.getByTestId(`budget-card-${budgetId}`)

  // Answered by now, so a card drawn from them would already be on the page
  const definitions = page.waitForResponse(`${API_BASE_URL}/base-budgets`)
  const periods = page.waitForResponse(`${API_BASE_URL}/budgets`)
  await page.goto('/budgets')
  await Promise.all([definitions, periods])
  await expect(loading).toBeVisible()
  await expect.poll(utilizations.intercepted).toBe(true)
  await expect(card).toHaveCount(0)

  utilizations.release()
  await expect(card).toContainText('$10.00 used')
  await expect(loading).toHaveCount(0)
  await clearLoadingFrames(page)
  await expect(card).toBeVisible()
  expect(await readLoadingFrames(page)).toEqual([])
})

test('shows the loading animation until a first visit with no budgets has settled, then the empty message', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  const definitions = await holdRequest(page, '/base-budgets')
  const loading = page.getByRole('status', { name: 'Loading budgets' })
  const empty = page.getByText(EMPTY_BUDGETS_MESSAGE)

  await page.goto('/budgets')
  await expect(loading).toBeVisible()
  await expect.poll(definitions.intercepted).toBe(true)
  await expect(empty).toHaveCount(0)

  definitions.release()
  await expect(empty).toBeVisible()
  await expect(loading).toHaveCount(0)
})
