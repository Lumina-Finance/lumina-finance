import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, findReferenceId, signUpUser, todayInTestTimezone } from './api'
import { chooseFromDropdown, openModal } from './app'
import { API_BASE_URL } from './target'

export const CARDS = [
  { calculation: 'Net Worth', subject: 'Net worth', path: '/insights/net-worth', loading: 'Loading net worth', bodyHeight: 360 },
  { calculation: 'Cash Flow', subject: 'Cash flow', path: '/insights/cash-flow', loading: 'Loading cash flow', bodyHeight: 390 },
  { calculation: 'Savings Rate Trend', subject: 'Savings rate trend', path: '/insights/savings-rate-trend', loading: 'Loading savings rate trend', bodyHeight: 430 },
  { calculation: 'Merchant Distribution', subject: 'Spending distribution by merchant', path: '/insights/merchants', loading: 'Loading merchant spending distribution' },
  { calculation: 'Merchant Ranking', subject: 'Merchant ranking', path: '/insights/merchants', loading: 'Loading merchant ranking' },
] as const
export const PATHS = [...new Set(CARDS.map((contract) => contract.path))]

/**
 * Locate the real outer card by its uniquely named calculation button, independent of height CSS
 * @param page - Insights page holding the card
 * @param index - Card position in the shared contracts
 * @returns The outer card locator
 */
export function card(page: Page, index: number): Locator {
  return page.locator('.app-card').filter({ has: page.getByRole('button', { name: `${CARDS[index].calculation} calculation`, exact: true }) })
}

/** Locate the body through the tooltip boundary and shared loading-content wrapper */
function body(page: Page, index: number): Locator {
  return card(page, index).locator(':scope > [data-tooltip-bounds] > div:first-child > div')
}

/**
 * Recognize only the configured API origin and complete prefixed path
 * @param url - Actual browser request address
 * @param path - Endpoint relative to the configured API base
 * @returns Whether origin and pathname both match
 */
export function matchesApi(url: string, path: string): boolean {
  const actual = new URL(url)
  const expected = new URL(`${API_BASE_URL}${path}`)
  return actual.origin === expected.origin && actual.pathname === expected.pathname
}

/**
 * Seed genuine recent income, partial refunds and enough merchants to fill the ranking
 * @param request - Request context used for the synthetic API fixture
 * @returns Fresh user and the account used for the later application mutation
 * @throws When an actual creation request does not succeed
 */
export async function seedRichInsights(request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Insights geometry active checking account', startingBalance: 250000 })
  const second = await createAccount(request, user, { name: 'Insights geometry savings account', accountType: 'savings', startingBalance: 150000 })
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const categoryId = await findReferenceId(request, user, 'categories', 'Groceries')
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 400000 })
  for (let index = 0; index < 8; index += 1) {
    const response = await request.post(`${API_BASE_URL}/merchants`, {
      headers, data: { name: `Insights ${index} long descriptive merchant for household shopping and services` },
    })
    expect(response.status()).toBe(201)
    const merchant = await response.json() as { id: string }
    for (const amount of [-10000 - index * 100, 500]) {
      const transaction = await request.post(`${API_BASE_URL}/transactions`, {
        headers, data: {
          account_id: index % 2 === 0 ? account.id : second.id, category_id: categoryId,
          merchant_id: merchant.id, dt: todayInTestTimezone(), amount, currency: 'CAD',
        },
      })
      expect(transaction.status()).toBe(201)
    }
  }
  return { user, account }
}

/**
 * Reveal lazy cards and wait for their actual successful requests and loading transitions
 * @param page - Insights page to scroll
 * @param successfulPaths - Endpoint paths observed succeeding for this user
 * @throws When a request or its loading transition does not settle
 */
export async function expectLoaded(page: Page, successfulPaths: Set<string>): Promise<void> {
  for (let index = 0; index < CARDS.length; index += 1) {
    const widget = card(page, index)
    await expect(widget).toHaveCount(1)
    await widget.scrollIntoViewIfNeeded()
    await expect.poll(() => successfulPaths.has(CARDS[index].path)).toBe(true)
    await expect(widget.getByRole('status', { name: CARDS[index].loading, exact: true })).toHaveCount(0)
    await expect(widget.getByRole('alert')).toHaveCount(0)
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

/**
 * Assert explicit fixed dimensions while allowing the documented content-sized states to grow
 * @param page - Insights page at the width being measured
 * @returns Fixed dimension vector, with null for content-sized states
 * @throws When a fixed dimension or wide merchant row alignment differs
 */
export async function expectGeometry(page: Page): Promise<(number | null)[]> {
  const wideBodies = await page.evaluate(() => matchMedia('(min-width: 750px)').matches)
  const wideMerchants = await page.evaluate(() => matchMedia('(min-width: 1300px)').matches)
  const measured: (number | null)[] = []
  for (let index = 0; index < CARDS.length; index += 1) {
    const widget = card(page, index)
    await expect(widget).toHaveCount(1)
    await widget.scrollIntoViewIfNeeded()
    const target = index < 3 ? body(page, index) : widget
    await expect(target).toHaveCount(1)
    await expect(target).toBeVisible()
    const fixed = index === 0 ? 360 : index === 1 ? 390 : index === 2 ? (wideBodies ? 430 : null)
      : index === 3 ? 560 : (wideMerchants ? 560 : null)
    if (fixed === null) {
      expect((await target.boundingBox())!.height).toBeGreaterThan(0)
      measured.push(null)
    } else {
      await expect.poll(async () => Math.abs((await target.boundingBox())!.height - fixed)).toBeLessThanOrEqual(1)
      measured.push((await target.boundingBox())!.height)
    }
  }
  if (wideMerchants) {
    const distribution = (await card(page, 3).boundingBox())!
    const ranking = (await card(page, 4).boundingBox())!
    expect(Math.abs(distribution.y - ranking.y)).toBeLessThanOrEqual(1)
    expect(Math.abs(distribution.height - ranking.height)).toBeLessThanOrEqual(1)
  }
  return measured
}

/**
 * Verify recovery controls fit their outer card and every intermediate clipping ancestor
 * @param control - Actual error heading or recovery button
 * @param widget - Its outer card
 * @throws When the control is hidden or extends beyond its paint bounds
 */
export async function expectContained(control: Locator, widget: Locator): Promise<void> {
  await expect(control).toBeVisible()
  const outer = await widget.elementHandle()
  expect(outer).not.toBeNull()
  try {
    await expect.poll(() => control.evaluate((element, cardElement) => {
      const target = element.getBoundingClientRect()
      const violations: string[] = []
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const rect = ancestor.getBoundingClientRect()
        const style = getComputedStyle(ancestor)
        const clipsX = ancestor === cardElement || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)
        const clipsY = ancestor === cardElement || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)
        if ((clipsX && (target.left < rect.left - 1 || target.right > rect.right + 1))
          || (clipsY && (target.top < rect.top - 1 || target.bottom > rect.bottom + 1))) {
          violations.push(JSON.stringify({ tag: ancestor.tagName, target: target.toJSON(), bounds: rect.toJSON() }))
        }
        if (ancestor === cardElement) break
      }
      return violations
    }, outer!)).toEqual([])
  } finally {
    await outer!.dispose()
  }
}

/**
 * Use real responsive shell links so navigation preserves the in-memory query cache
 * @param page - Signed-in application page
 * @param name - Primary navigation destination
 * @throws When the destination does not open
 */
export async function navigate(page: Page, name: 'Transactions' | 'Insights'): Promise<void> {
  const menu = page.getByRole('button', { name: 'Open navigation menu', exact: true })
  if (await menu.isVisible()) await menu.click()
  await page.getByRole('navigation', { name: 'Primary', exact: true }).getByRole('link', { name, exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}$`))
}

/**
 * Create an expense through the actual form and wait for the real mutation to settle
 * @param page - Transaction list where the form opens
 * @param accountName - Fresh fixture account to receive the expense
 * @throws When creation does not answer 201 or the modal does not close
 */
export async function createExpenseInApp(page: Page, accountName: string): Promise<void> {
  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  await chooseFromDropdown(dialog, 'Account', accountName)
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await dialog.getByLabel('Amount', { exact: true }).fill('12.34')
  const committed = page.waitForResponse((response) => matchesApi(response.url(), '/transactions') && response.request().method() === 'POST')
  await dialog.getByTestId('transaction-submit').click()
  expect((await committed).status()).toBe(201)
  await expect(dialog).toBeHidden()
}
