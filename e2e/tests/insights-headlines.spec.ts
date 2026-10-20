/**
 * The Net Cash Flow headline once wrapped a very large total at phone width, leaving its minus sign
 * alone on the line above the amount. The Period Glance headline, which shares its fitting, once ran
 * past its panel's right edge at phone width with a very large total
 */
import { expect, test, type APIResponse, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { card, createExpenseInApp, matchesApi, navigate } from '../support/insights'

// Runs on desktop only: each case sets the width it checks itself

const PHONE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

// The size the Net Cash Flow headline takes whenever its total fits, `text-3xl`
const FULL_FONT_SIZE_PX = 30

// The Period Glance headline's full size, `text-5xl`, and the smallest it once shrank to, `text-3xl`,
// which a desktop has always had room for
const PERIOD_GLANCE_FULL_FONT_SIZE_PX = 48
const PERIOD_GLANCE_DESKTOP_MIN_FONT_SIZE_PX = 30

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

/**
 * Reads a headline's font size once its fitting has settled. The fitting measures in an animation
 * frame after the font loads and renders its size on the next, so the size read any sooner can
 * still be the full size the headline starts at
 */
async function readSettledFontSize(page: Page, headline: Locator) {
  await page.evaluate(() => document.fonts.ready.then(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })))
  return headline.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
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
      expect(await readSettledFontSize(page, headline)).toBe(FULL_FONT_SIZE_PX)
    }
  })
}

// A balance the account opens with, which is not cash flow, so the Net Worth card's "Ending Net
// Worth" figure differs from the Period Glance headline. The signed net worth changes can't match,
// since no headline pattern allows a plus sign
const PERIOD_GLANCE_STARTING_BALANCE = 100_000

// The headline is income minus expenses. Each pair differs from its headline, so neither the Income
// nor the Expenses figure can match the headline's text. The smallest size each headline may settle
// at is its full size where the amount fits, and the old smallest size on a desktop
const PERIOD_GLANCE_CASES = [
  { name: 'a very large total on a phone', currency: 'IQD', income: 1_246_913_569_002, expense: 1, text: /^IQD\s1,246,913,569\.001$/, viewport: PHONE, minFontSizePx: undefined },
  { name: 'a very large overspend on a phone', currency: 'IQD', income: 1, expense: 1_246_913_569_002, text: /^\(IQD\s1,246,913,569\.001\)$/, viewport: PHONE, minFontSizePx: undefined },
  { name: 'an ordinary total on a phone', currency: 'CAD', income: 525_000, expense: 5_000, text: /^(CA)?\$5,200\.00$/, viewport: PHONE, minFontSizePx: PERIOD_GLANCE_FULL_FONT_SIZE_PX },
  { name: 'a very large total on a desktop', currency: 'IQD', income: 1_246_913_569_002, expense: 1, text: /^IQD\s1,246,913,569\.001$/, viewport: DESKTOP, minFontSizePx: PERIOD_GLANCE_DESKTOP_MIN_FONT_SIZE_PX },
]

for (const example of PERIOD_GLANCE_CASES) {
  test(`period glance headline fits its panel on one line for ${example.name}`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: example.currency })
    const account = await createAccount(request, user, {
      name: 'Period glance headline account', currency: example.currency, startingBalance: PERIOD_GLANCE_STARTING_BALANCE,
    })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Salary', amount: example.income, currency: example.currency,
    })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Groceries', amount: -example.expense, currency: example.currency,
    })
    await page.setViewportSize(example.viewport)
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    const headline = page.getByRole('paragraph').filter({ hasText: example.text })
    await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })

    if (example.minFontSizePx !== undefined) {
      expect(await readSettledFontSize(page, headline)).toBeGreaterThanOrEqual(example.minFontSizePx)
    }
  })
}

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
  expect(await readSettledFontSize(page, headline)).not.toBe(FULL_FONT_SIZE_PX)
})
