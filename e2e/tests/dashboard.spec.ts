import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createMonthlyBudget, findReferenceId, signUpUser, todayInTestTimezone, TEST_TIMEZONE, type TestUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { API_BASE_URL, BASE_URL } from '../support/target'

// These are the outer-card contracts, independent of their CSS implementation
const CARDS = [
  { label: 'Net Worth', height: 248 },
  { label: 'Credit', slotText: 'Used', height: 248 },
  { label: 'Savings Rate', height: 248 },
  { label: 'Runway', height: 248 },
  { label: 'Spending comparison', slotText: 'Month', height: 470 },
  { label: 'Spending breakdown', slotText: 'Spending', height: 470 },
  { label: 'Top Budgets', height: 410 },
  { label: 'Recent Activity', height: 410 },
] as const

const FAILURE_TIERS = [
  { index: 1, path: '/dashboard/credit', subject: 'Credit usage', loading: 'Loading credit' },
  { index: 5, path: '/dashboard/spending-breakdown', subject: 'Spending breakdown', loading: 'Loading spending breakdown' },
  { index: 6, path: '/budgets/latest-utilizations', subject: 'Top budgets', loading: 'Loading top budgets' },
] as const

/** Find the actual widget wrapper through its header label, without depending on a height class */
function card(page: Page, index: number): Locator {
  const contract = CARDS[index]

  // Slot-machine labels repeat their visual text in hidden measuring and animation spans
  // Their single accessible text span is stable throughout the animation and failure states
  const label = 'slotText' in contract
    ? page.locator('.app-label').filter({ has: page.locator('.sr-only').filter({ hasText: new RegExp(`^${contract.slotText}$`) }) })
    : page.locator('.app-label').filter({ hasText: contract.label })
  return page.locator('.app-card').filter({ has: label })
}

/** Match browser API traffic by both configured origin and complete prefixed pathname */
function matchesApi(url: string, path: string): boolean {
  const actual = new URL(url)
  const expected = new URL(`${API_BASE_URL}${path}`)
  return actual.origin === expected.origin && actual.pathname === expected.pathname
}

/** Measure every fixed outer wrapper after real scrolling and font readiness */
async function expectCardHeights(page: Page): Promise<number[]> {
  const heights: number[] = []
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  for (let index = 0; index < CARDS.length; index += 1) {
    const widget = card(page, index)
    await expect(widget).toHaveCount(1)
    await widget.scrollIntoViewIfNeeded()
    await expect(widget).toBeVisible()
    await expect.poll(async () => Math.abs((await widget.boundingBox())!.height - CARDS[index].height)).toBeLessThanOrEqual(1)
    heights.push((await widget.boundingBox())!.height)
  }
  return heights
}

/** Seed a single-currency dashboard with enough genuine rows to exceed visible list limits */
async function seedRichDashboard(request: APIRequestContext): Promise<TestUser> {
  const user = await signUpUser(request)
  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const accounts = []
  for (let index = 0; index < 3; index += 1) {
    accounts.push(await createAccount(request, user, {
      name: `Dashboard ${index} account with a long descriptive financial label`, startingBalance: 250000,
    }))
  }
  const credit = await createAccount(request, user, {
    name: 'Dashboard revolving credit account with a long descriptive label',
    accountKind: 'revolving', accountType: 'credit_card', startingBalance: -45000,
  })
  const creditResponse = await request.patch(`${API_BASE_URL}/accounts/${credit.id}`, { headers, data: { credit_limit: 200000 } })
  expect(creditResponse.status()).toBe(200)
  const today = todayInTestTimezone()
  const incomeCategory = await findReferenceId(request, user, 'categories', 'Salary')
  const unknownMerchant = await findReferenceId(request, user, 'merchants', 'Unknown')
  const income = await request.post(`${API_BASE_URL}/transactions`, {
    headers, data: { account_id: accounts[0].id, dt: today, category_id: incomeCategory, merchant_id: unknownMerchant, amount: 600000, currency: 'CAD' },
  })
  expect(income.status()).toBe(201)
  for (let index = 0; index < 8; index += 1) {
    const name = `Dashboard ${index} long descriptive category for household financial spending`
    const categoryResponse = await request.post(`${API_BASE_URL}/categories`, { headers, data: { name, kind: 'expense' } })
    expect(categoryResponse.status()).toBe(201)
    const category = await categoryResponse.json() as { id: string }
    const merchantResponse = await request.post(`${API_BASE_URL}/merchants`, {
      headers, data: { name: `Dashboard ${index} merchant with a long descriptive shopping and service label` },
    })
    expect(merchantResponse.status()).toBe(201)
    const merchant = await merchantResponse.json() as { id: string }
    for (const amount of [-12000 - index * 100, -3500, 500]) {
      const response = await request.post(`${API_BASE_URL}/transactions`, {
        headers, data: {
          account_id: index === 0 ? credit.id : accounts[index % accounts.length].id,
          dt: today, category_id: category.id, merchant_id: merchant.id, amount, currency: 'CAD',
          notes: 'Recent household purchase or partial refund for dashboard layout coverage',
        },
      })
      expect(response.status()).toBe(201)
    }
    await createMonthlyBudget(request, user, {
      name: `Dashboard ${index} long descriptive household budget name`,
      categoryNames: [name], overallLimit: 20000 + index * 1000, periodStart: `${today.slice(0, 7)}-01`,
    })
  }
  return user
}

/** Check actual error controls against their card and each ancestor that clips their paint */
async function expectContained(control: Locator, widget: Locator): Promise<void> {
  await expect(control).toBeVisible()
  const widgetHandle = await widget.elementHandle()
  expect(widgetHandle).not.toBeNull()
  await expect.poll(() => control.evaluate((element, outer) => {
    const target = element.getBoundingClientRect()
    const violations: string[] = []
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const rect = ancestor.getBoundingClientRect()
      const style = getComputedStyle(ancestor)
      const clipsX = ancestor === outer || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowX)
      const clipsY = ancestor === outer || ['hidden', 'clip', 'scroll', 'auto'].includes(style.overflowY)
      if ((clipsX && (target.left < rect.left - 1 || target.right > rect.right + 1))
        || (clipsY && (target.top < rect.top - 1 || target.bottom > rect.bottom + 1))) {
        violations.push(`${ancestor.tagName}.${ancestor.className}: ${JSON.stringify({ target: target.toJSON(), ancestor: rect.toJSON() })}`)
      }
      if (ancestor === outer) break
    }
    return violations
  }, widgetHandle!)).toEqual([])
  await widgetHandle!.dispose()
}

test('dashboard outer heights match across sparse, loading and rich real data', async ({ page, browser, request }, testInfo) => {
  const sparseUser = await signUpUser(request)
  const richUser = await seedRichDashboard(request)
  const sparseContext = await browser.newContext({
    baseURL: BASE_URL, viewport: page.viewportSize(), locale: 'en-CA', timezoneId: TEST_TIMEZONE,
    isMobile: testInfo.project.name !== 'desktop', hasTouch: testInfo.project.name !== 'desktop',
  })
  let release = () => {}
  try {
    const sparsePage = await sparseContext.newPage()
    await logIn(sparsePage, sparseUser)
    await expectSignedIn(sparsePage)
    await expect(sparsePage.getByText('No budgets', { exact: true })).toBeVisible()
    await expect(sparsePage.getByText('No recent transactions', { exact: true })).toBeVisible()
    await expect(sparsePage.getByText('No expense activity in this range', { exact: true })).toBeVisible()
    await expect(sparsePage.getByRole('status', { name: /^Loading / })).toHaveCount(0)
    const sparseHeights = await expectCardHeights(sparsePage)

    const gate = new Promise<void>((resolve) => { release = resolve })
    const held = new Set<string>()
    await page.route((url) => FAILURE_TIERS.some((tier) => matchesApi(url.href, tier.path)), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      const response = await route.fetch()
      held.add(new URL(route.request().url()).pathname)
      await gate
      await route.fulfill({ response })
    })
    await logIn(page, richUser)
    await expectSignedIn(page)
    for (const tier of FAILURE_TIERS) {
      await expect(card(page, tier.index).getByRole('status', { name: tier.loading, exact: true })).toBeVisible()
    }
    await expect.poll(() => held.size).toBe(3)
    const loadingHeights = await expectCardHeights(page)
    release()
    for (const tier of FAILURE_TIERS) {
      await expect(card(page, tier.index).getByRole('status', { name: tier.loading, exact: true })).toHaveCount(0)
    }
    await expect(card(page, 1).getByRole('button', { name: 'Show credit remaining', exact: true })).toBeVisible()
    await expect(card(page, 6).getByRole('link', { name: /^Open Dashboard .* budget$/ })).toHaveCount(3)
    await expect(card(page, 7).getByRole('link', { name: 'View all transactions', exact: true })).toBeVisible()
    await expect(card(page, 5).getByText(/^Dashboard \d long descriptive category/, { exact: false }).first()).toBeVisible()
    await expect(page.getByRole('status', { name: /^Loading / })).toHaveCount(0)
    const richHeights = await expectCardHeights(page)
    for (let index = 0; index < CARDS.length; index += 1) {
      expect(Math.abs(richHeights[index] - sparseHeights[index])).toBeLessThanOrEqual(1)
      expect(Math.abs(loadingHeights[index] - sparseHeights[index])).toBeLessThanOrEqual(1)
    }
  } finally {
    release()
    await sparseContext.close()
  }
})

for (const detail of [
  'The synthetic dashboard request could not be completed',
  Array.from({ length: 60 }, () => 'The synthetic dashboard service could not complete this request; the account data remains unchanged').join(' '),
]) {
  test(`dashboard errors retain each height tier and visible recovery controls (${detail.length > 100 ? 'long' : 'ordinary'} detail)`, async ({ page, request }) => {
    const user = await signUpUser(request)
    const failures = new Set<string>()
    await page.route((url) => FAILURE_TIERS.some((tier) => matchesApi(url.href, tier.path)), async (route) => {
      if (route.request().method() !== 'GET') return route.continue()
      failures.add(new URL(route.request().url()).pathname)
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail }) })
    })
    await logIn(page, user)
    await expectSignedIn(page)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    for (const tier of FAILURE_TIERS) {
      const widget = card(page, tier.index)
      await widget.scrollIntoViewIfNeeded()
      const heading = widget.getByRole('heading', { name: `${tier.subject} could not load`, exact: true })
      await expect(heading).toBeVisible()
      const alert = widget.getByRole('alert')
      await expect(alert).toContainText(detail)
      await expect.poll(async () => Math.abs((await widget.boundingBox())!.height - CARDS[tier.index].height)).toBeLessThanOrEqual(1)
      await expectContained(heading, widget)
      await expectContained(alert.getByRole('button', { name: 'Reload', exact: true }), widget)
    }
    expect(failures.size).toBe(3)
    await expectCardHeights(page)
  })
}
