import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { card } from '../support/insights'

// Runs on desktop only: it resizes the window itself to each width it checks

const WIDTHS = [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
]

test('savings rate average has no line under it, its tooltip says what it counts, and the three boxes line up', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'CAD' })
  const account = await createAccount(request, user, { name: 'Savings caption account', currency: 'CAD' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, '/insights')

  const savingsRate = card(page, 2)
  await savingsRate.scrollIntoViewIfNeeded()
  await expect(savingsRate.locator('p', { hasText: /^Average/ })).toBeVisible()

  // What the Average counts sits behind its question mark, not in a line that wraps or cuts off on the card
  await expect(savingsRate.getByText('Completed months with income', { exact: true })).toHaveCount(0)
  await savingsRate.getByRole('button', { name: 'Average savings rate calculation', exact: true }).hover()
  await expect(page.getByText(/Average savings rate across completed months with income/)).toBeVisible()

  for (const size of WIDTHS) {
    await page.setViewportSize(size)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    // The Average, Best and Worst boxes stay one height
    await expect.poll(async () => {
      const heights = await savingsRate.locator('p', { hasText: /^(Average|Best|Worst)/ })
        .evaluateAll((labels) => labels.map((label) => Math.round(label.parentElement!.getBoundingClientRect().height)))
      return heights.length === 3 && new Set(heights).size === 1
    }, { message: `boxes at ${size.width}px` }).toBe(true)
  }
})
