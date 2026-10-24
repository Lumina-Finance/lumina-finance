import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { card } from '../support/insights'

// Runs on desktop only: the axis is fitted to the width of its labels in the loaded font, which is the
// same at every screen width

// Income of one cent against expenses of a thousand dollars puts the month's rate far below the
// -999% bound, so the uncapped axis draws "below −999%" on its ticks
test('savings rate axis fits its longest label for a rate beyond the bound', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'CAD' })
  const account = await createAccount(request, user, { name: 'Savings axis account', currency: 'CAD' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 1, currency: 'CAD' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -100_000, currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, '/insights')

  // The card loads once it is scrolled into view, and it opens uncapped
  const savingsRate = card(page, 2)
  await savingsRate.scrollIntoViewIfNeeded()
  const boundedLabels = savingsRate.locator('svg text').filter({ hasText: /^below/ })
  await expect(boundedLabels.first()).toBeVisible()

  // The axis is fitted in the loaded font, so the labels are read only after it has arrived
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // Every label is drawn whole: none reaches past the chart's left edge or wraps onto a second line.
  // On the fixed 52px axis this label is wider than the axis and reaches past that edge
  await expect.poll(() => boundedLabels.evaluateAll((labels) => labels.flatMap((label) => {
    const chart = (label as SVGTextElement).ownerSVGElement!
    const overhang = chart.getBoundingClientRect().left - label.getBoundingClientRect().left
    return [
      ...(overhang > 0 ? [`${label.textContent} reaches ${overhang}px past the chart`] : []),
      ...(label.querySelectorAll('tspan').length > 1 ? [`${label.textContent} is drawn on more than one line`] : []),
    ]
  }))).toEqual([])
})
