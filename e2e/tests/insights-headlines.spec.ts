/**
 * The Net Cash Flow headline once wrapped a very large total at phone width, leaving its minus sign
 * alone on the line above the amount. The Period Glance headline shares its fitting and is checked
 * beside it
 */
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { card, createExpenseInApp, matchesApi, navigate } from '../support/insights'

// Runs on desktop only: each case sets the width it checks itself

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

// The size the Net Cash Flow headline takes whenever its total fits, `text-3xl`
const FULL_FONT_SIZE = '30px'

// The Period Glance headline's full size, `text-5xl`
const PERIOD_GLANCE_FULL_FONT_SIZE_PX = 48

const CASES = [
  { name: 'a very large negative total on a phone', currency: 'IQD', categoryName: 'Groceries', minorUnits: -1_246_913_569_001, text: /^-IQD\s1,246,913,569\.001$/, viewport: PHONE, fullSize: false },
  { name: 'an ordinary negative total on a phone', currency: 'CAD', categoryName: 'Groceries', minorUnits: -520_000, text: /^-\S*\$5,200\.00$/, viewport: PHONE, fullSize: true },
  { name: 'a very large positive total on a phone', currency: 'IQD', categoryName: 'Salary', minorUnits: 1_246_913_569_001, text: /^\+IQD\s1,246,913,569\.001$/, viewport: PHONE, fullSize: false },
  { name: 'a very large negative total on a desktop', currency: 'IQD', categoryName: 'Groceries', minorUnits: -1_246_913_569_001, text: /^-IQD\s1,246,913,569\.001$/, viewport: DESKTOP, fullSize: true },
]

/**
 * Reads how many lines a headline takes and whether it runs past its own width, once the font the
 * headline is fitted in has loaded
 */
async function measureHeadline(page: Page, headline: Locator) {
  await expect(headline).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return headline.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const lineTops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
    return { lines: lineTops.size, overflows: element.scrollWidth > element.clientWidth }
  })
}

for (const example of CASES) {
  test(`net cash flow headline stays on one line for ${example.name}`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: example.currency })
    const account = await createAccount(request, user, { name: 'Cash flow headline account', currency: example.currency })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: example.categoryName, amount: example.minorUnits, currency: example.currency,
    })
    await page.setViewportSize(example.viewport)
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    // The card loads once it is scrolled into view
    const cashFlow = card(page, 1)
    await cashFlow.scrollIntoViewIfNeeded()

    // A paragraph, so an axis label with the same text can't match
    const headline = cashFlow.getByRole('paragraph').filter({ hasText: example.text })
    await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })

    if (example.fullSize) {
      await expect(headline).toHaveCSS('font-size', FULL_FONT_SIZE)
    }
  })
}

test('period glance headline shrinks onto one line for a very large total on a phone', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, { name: 'Period glance headline account', currency: 'IQD' })

  // The small expense keeps the income figure's text apart from the headline's
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Salary', amount: 1_246_913_569_002, currency: 'IQD',
  })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -1, currency: 'IQD',
  })
  await page.setViewportSize(PHONE)
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  const headline = page.getByRole('paragraph').filter({ hasText: /^IQD\s1,246,913,569\.001$/ })

  // Only the line count is checked, since this total runs past the panel at phone width even at the
  // headline's smallest size
  await expect.poll(async () => (await measureHeadline(page, headline)).lines).toBe(1)
  await expect.poll(() => headline.evaluate((element) => parseFloat(getComputedStyle(element).fontSize)))
    .toBeLessThan(PERIOD_GLANCE_FULL_FONT_SIZE_PX)
})

test('net cash flow headline is fitted again when its card recovers from a failed refetch', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, { name: 'Cash flow recovery account', currency: 'IQD' })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -1_246_913_569_001, currency: 'IQD',
  })
  // The refetch must ask for the same range as the first load, so the date is held still
  await page.clock.setFixedTime(new Date())
  let failRefetch = false
  let firstResponse: APIResponse | undefined
  // The reload after the failure is answered with the first load's data, so the recovered headline
  // reads exactly what it did before the failure, even though the page made an expense in between
  await page.route((url) => matchesApi(url.href, '/insights/cash-flow'), async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (failRefetch) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic failure' }) })
    }
    firstResponse ??= await route.fetch()
    return route.fulfill({ response: firstResponse })
  })
  await page.setViewportSize(PHONE)
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  const cashFlow = card(page, 1)
  await cashFlow.scrollIntoViewIfNeeded()
  const headline = cashFlow.getByRole('paragraph').filter({ hasText: /^-IQD\s1,246,913,569\.001$/ })
  await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })

  // The page opens on a failed refetch, so the headline is absent while the cached total is held
  await navigate(page, 'Transactions')
  failRefetch = true
  await createExpenseInApp(page, 'Cash flow recovery account')
  await navigate(page, 'Insights')
  await cashFlow.scrollIntoViewIfNeeded()
  await expect(cashFlow.getByRole('heading', { name: 'Cash flow could not load', exact: true })).toBeVisible()
  await expect(headline).toHaveCount(0)

  // The card recovers without a reload when the connection comes back, and the headline returns with
  // the same text it held before the failure, so only its element tells the fitting to measure again
  failRefetch = false
  await page.context().setOffline(true)
  await page.context().setOffline(false)
  await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })
  await expect(headline).not.toHaveCSS('font-size', FULL_FONT_SIZE)
})
