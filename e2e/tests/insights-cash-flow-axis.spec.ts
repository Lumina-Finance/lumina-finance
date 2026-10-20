import { expect, test, type Locator } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { card } from '../support/insights'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the issue reports the clipping in the phone layout and names no width, so the
// phone and tablet projects check their own widths rather than a width written into the test

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
