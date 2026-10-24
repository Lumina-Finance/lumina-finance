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

test('savings rate average caption is shown whole at every width', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'CAD' })
  const account = await createAccount(request, user, { name: 'Savings caption account', currency: 'CAD' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100_000, currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, '/insights')

  const savingsRate = card(page, 2)
  await savingsRate.scrollIntoViewIfNeeded()
  const caption = savingsRate.getByText('Completed months with income', { exact: true })
  await expect(caption).toBeVisible()

  for (const size of WIDTHS) {
    await page.setViewportSize(size)
    await page.evaluate(() => document.fonts.ready.then(() => undefined))

    // Whole means no ellipsis and no text hidden past the caption's own box
    await expect.poll(() => caption.evaluate((element) => ({
      ellipsis: getComputedStyle(element).textOverflow === 'ellipsis',
      cutOff: element.scrollWidth > element.clientWidth,
    })), { message: `caption at ${size.width}px` }).toEqual({ ellipsis: false, cutOff: false })

    // The Average, Best and Worst boxes stay one height
    const heights = await savingsRate.locator('p', { hasText: /^(Average|Best|Worst)/ })
      .evaluateAll((labels) => labels.map((label) => Math.round(label.parentElement!.getBoundingClientRect().height)))
    expect(heights).toHaveLength(3)
    if (size.width >= 750) expect(new Set(heights).size).toBe(1)
  }
})
