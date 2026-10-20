import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { card } from '../support/insights'
import { AT_EVERY_SIZE } from '../support/sizes'

// The overhang tests run at every size, since the axis width they check changes with the screen's
// width. The tick and sign tests run on desktop only, since the chart draws the same ticks at every width

const LARGE_AMOUNT = -1_246_913_569_001

/** Open Insights and return the cash flow card's amount labels, once the chart has drawn them */
async function openCashFlowLabels(page: Parameters<typeof openPage>[0]): Promise<Locator> {
  await openPage(page, '/insights')

  // The card loads once it is scrolled into view
  const cashFlow = card(page, 1)
  await cashFlow.scrollIntoViewIfNeeded()
  const amountLabels = cashFlow.locator('svg text').filter({ hasText: /IQD/ })
  await expect(amountLabels.first()).toBeVisible()

  // The axis is fitted in the loaded font, so the labels are read only after it has arrived
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return amountLabels
}

/** What is wrong with the labels: any reaching past the chart's left edge, or drawn on more than one line */
function problemsWith(amountLabels: Locator) {
  return amountLabels.evaluateAll((labels) => labels.flatMap((label) => {
    const chart = (label as SVGTextElement).ownerSVGElement!
    const overhang = chart.getBoundingClientRect().left - label.getBoundingClientRect().left
    const lines = label.querySelectorAll('tspan').length
    return [
      ...(overhang > 0 ? [`${label.textContent} reaches ${overhang}px past the chart`] : []),
      ...(lines > 1 ? [`${label.textContent} is drawn on ${lines} lines`] : []),
    ]
  }))
}

async function seedIqdAccount(request: Parameters<typeof signUpUser>[0]): Promise<{ user: TestUser, accountId: string }> {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, { name: 'Cash flow axis account', currency: 'IQD' })
  return { user, accountId: account.id }
}

const TICK_CASES = [
  // Five evenly spaced ticks between zero and one minor unit print as the same amount several times
  { name: 'a two-decimal net of one cent', currency: 'CAD', minorUnits: 1, count: 2, first: '0.00', last: '0.01' },
  { name: 'a three-decimal net of one fils', currency: 'IQD', minorUnits: 1, count: 2, first: '0.000', last: '0.001' },

  // An ordinary net keeps all five ticks
  { name: 'an ordinary net', currency: 'CAD', minorUnits: 125_000, count: 5, first: '0.00', last: '1,250.00' },
]

// A net is an amount that moved, so its labels are signed like the card's headline, never written in
// the parentheses a held balance takes
const SIGN_CASES = [
  { name: 'a net of minus 1,250 dollars', minorUnits: -125_000, sign: '-', extreme: '-$1,250.00' },
  { name: 'a net of plus 1,250 dollars', minorUnits: 125_000, sign: '+', extreme: '+$1,250.00' },
]

/**
 * Records one transaction in the given currency and opens the Insights page on the Cash flow card,
 * returning its amount labels, which have decimals that the dates along the bottom never do
 */
async function openCashFlowAxis(page: Page, request: APIRequestContext, currency: string, minorUnits: number) {
  const user = await signUpUser(request, { baseCurrency: currency })
  const account = await createAccount(request, user, { name: 'Cash flow axis account', currency })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: minorUnits < 0 ? 'Groceries' : 'Salary', amount: minorUnits, currency,
  })
  await logInViaApi(page, user)
  await openPage(page, '/insights')

  // The card loads once it is scrolled into view
  const cashFlow = card(page, 1)
  await cashFlow.scrollIntoViewIfNeeded()
  const amountLabels = cashFlow.locator('svg text').filter({ hasText: /\d\.\d/ })
  await expect(amountLabels.first()).toBeVisible()
  return amountLabels
}

for (const example of SIGN_CASES) {
  test(`cash flow axis signs the amounts for ${example.name}`, async ({ page, request }) => {
    const amountLabels = await openCashFlowAxis(page, request, 'CAD', example.minorUnits)

    // Recharts picks the ticks between zero and the net, so only their sign is pinned
    await expect.poll(async () => {
      const labels = await amountLabels.allTextContents()
      return {
        hasExtreme: labels.includes(example.extreme),
        unsigned: labels.filter((label) => label !== '$0.00' && !label.startsWith(example.sign)),
      }
    }).toEqual({ hasExtreme: true, unsigned: [] })
  })
}

for (const example of TICK_CASES) {
  test(`cash flow axis shows each amount once for ${example.name}`, async ({ page, request }) => {
    const amountLabels = await openCashFlowAxis(page, request, example.currency, example.minorUnits)

    // Only the amount is compared, since the currency's symbol is not what repeats
    await expect.poll(async () => {
      const amounts = (await amountLabels.allTextContents())
        .map((label) => label.replace(/[^\d.,]/g, ''))
        .sort((a, b) => Number(a.replace(/,/g, '')) - Number(b.replace(/,/g, '')))
      return { count: amounts.length, distinct: new Set(amounts).size, first: amounts[0], last: amounts.at(-1) }
    }).toEqual({ count: example.count, distinct: example.count, first: example.first, last: example.last })
  })
}

// On the axis width that was worked out from the label's number of characters, this label reached 3px
// past the chart's left edge at every size
test('cash flow axis labels stay inside the chart for a total beyond the old width limit', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, accountId } = await seedIqdAccount(request)
  await createTransaction(request, user, {
    accountId, categoryName: 'Groceries', amount: LARGE_AMOUNT, currency: 'IQD',
  })
  await logInViaApi(page, user)

  const amountLabels = await openCashFlowLabels(page)
  await expect.poll(() => problemsWith(amountLabels)).toEqual([])
})

test('cash flow axis refits when the range changes from short labels to very long ones', AT_EVERY_SIZE, async ({ page, request }) => {
  const { user, accountId } = await seedIqdAccount(request)
  await createTransaction(request, user, {
    accountId, categoryName: 'Groceries', amount: -1000, currency: 'IQD',
  })
  await createTransaction(request, user, {
    accountId, categoryName: 'Groceries', amount: LARGE_AMOUNT, currency: 'IQD', date: daysFromTodayInTestTimezone(-60),
  })
  await logInViaApi(page, user)

  // The opening range holds only the small amount, so its axis is fitted to short labels first
  const amountLabels = await openCashFlowLabels(page)
  await expect(amountLabels.filter({ hasText: '1,246,913' })).toHaveCount(0)
  await expect.poll(() => problemsWith(amountLabels)).toEqual([])

  // Widening the range after load brings the large amount in, with no reload to fit the axis again
  await page.getByRole('button', { name: /^Insights date range: / }).filter({ visible: true }).click()
  await page.getByRole('tab', { name: '90D', exact: true }).click()
  await expect(amountLabels.filter({ hasText: '1,246,913' }).first()).toBeVisible()
  await expect.poll(() => problemsWith(amountLabels)).toEqual([])
})
