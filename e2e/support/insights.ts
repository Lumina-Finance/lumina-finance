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
  // Sent together, since one after another they take most of a busy host's time limit for the test,
  // and the ranking orders the merchants by their amounts rather than by when they were made
  await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const response = await request.post(`${API_BASE_URL}/merchants`, {
      headers, data: { name: `Insights ${index} long descriptive merchant for household shopping and services` },
    })
    expect(response.status()).toBe(201)
    const merchant = await response.json() as { id: string }
    await Promise.all([-10000 - index * 100, 500].map(async (amount) => {
      const transaction = await request.post(`${API_BASE_URL}/transactions`, {
        headers, data: {
          account_id: index % 2 === 0 ? account.id : second.id, category_id: categoryId,
          merchant_id: merchant.id, dt: todayInTestTimezone(), amount, currency: 'CAD',
        },
      })
      expect(transaction.status()).toBe(201)
    }))
  }))
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
  // Every card is read in one call. A round trip per card and per check, repeated for each state and
  // width a test measures, adds up on a busy host to more than the whole test's time limit
  const read = () => page.evaluate((calculations) => {
    const wideBodies = matchMedia('(min-width: 750px)').matches
    const wideMerchants = matchMedia('(min-width: 1300px)').matches
    const boxes = calculations.map((calculation, index) => {
      const cards = [...document.querySelectorAll('.app-card')]
        .filter((element) => element.querySelector(`button[aria-label="${calculation} calculation"]`))
      const targets = cards.length !== 1 ? []
        : index < 3 ? [...cards[0].querySelectorAll(':scope > [data-tooltip-bounds] > div:first-child > div')] : cards
      if (targets.length !== 1) return { shown: false, height: 0, top: 0 }
      const box = targets[0].getBoundingClientRect()
      const shown = box.width > 0 && box.height > 0 && getComputedStyle(targets[0]).visibility !== 'hidden'
      return { shown, height: box.height, top: box.top }
    })
    return { wideBodies, wideMerchants, boxes }
  }, CARDS.map((contract) => contract.calculation))
  type Reading = Awaited<ReturnType<typeof read>>
  const fixedHeights = ({ wideBodies, wideMerchants }: Reading) =>
    [360, 390, wideBodies ? 430 : null, 560, wideMerchants ? 560 : null]
  const problems = (reading: Reading) => {
    const fixed = fixedHeights(reading)
    const found = reading.boxes.flatMap(({ shown, height }, index) => {
      if (!shown) return [`${CARDS[index].calculation} is not shown`]
      if (fixed[index] !== null && Math.abs(height - fixed[index]) > 1) {
        return [`${CARDS[index].calculation} is ${height}px tall rather than ${fixed[index]}px`]
      }
      return []
    })
    const [distribution, ranking] = reading.boxes.slice(3)
    if (reading.wideMerchants && Math.abs(distribution.top - ranking.top) > 1) found.push('The merchant cards do not share a row')
    return found
  }
  let reading!: Reading
  await expect.poll(async () => problems(reading = await read())).toEqual([])
  const fixed = fixedHeights(reading)
  return reading.boxes.map(({ height }, index) => (fixed[index] === null ? null : height))
}

/**
 * Verify recovery controls fit their outer card and every intermediate clipping ancestor
 * @param control - Actual error heading or recovery button, inside its outer card
 * @throws When the control is hidden or extends beyond its paint bounds
 */
export async function expectContained(control: Locator): Promise<void> {
  await expect(control).toBeVisible()
  // The card is found from the control inside the page, which saves a round trip for its handle and one
  // to release it on every check
  await expect.poll(() => control.evaluate((element) => {
    const cardElement = element.closest('.app-card')
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
  })).toEqual([])
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
