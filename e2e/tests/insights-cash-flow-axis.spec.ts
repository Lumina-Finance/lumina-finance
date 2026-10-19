import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { card, navigate } from '../support/insights'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the issue reports the clipping in the phone layout and names no width, so the
// phone and tablet projects check their own widths rather than a width written into the test

const CASES = [
  // Its largest label reaches 3px past the chart when the axis width is worked out from the label's
  // number of characters
  { name: 'a total beyond the old width limit', minorUnits: -1_246_913_569_001 },

  // Fit before, and has to keep fitting
  { name: 'a total that already fit', minorUnits: -12_345_678_901 },
]

for (const example of CASES) {
  test(`cash flow axis labels stay inside the chart for ${example.name}`, AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: 'IQD' })
    const account = await createAccount(request, user, { name: 'Cash flow axis account', currency: 'IQD' })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Groceries', amount: example.minorUnits, currency: 'IQD',
    })
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    // The card loads once it is scrolled into view
    const cashFlow = card(page, 1)
    await cashFlow.scrollIntoViewIfNeeded()
    const amountLabels = cashFlow.locator('svg text').filter({ hasText: /IQD/ })
    await expect(amountLabels.first()).toBeVisible()

    // The axis is fitted in the loaded font, so the labels are read only after it has arrived
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await expect.poll(() => amountLabels.evaluateAll((labels) => labels.flatMap((label) => {
      const chart = (label as SVGTextElement).ownerSVGElement!
      const overhang = chart.getBoundingClientRect().left - label.getBoundingClientRect().left
      return overhang > 0 ? [`${label.textContent} reaches ${overhang}px past the chart`] : []
    }))).toEqual([])
  })
}
