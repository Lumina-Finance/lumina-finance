import { expect, test } from '@playwright/test'

import {
  budgetPeriodStart,
  createAccount,
  createMonthlyBudget,
  createTransaction,
  signUpUser,
} from '../support/api'
import { logIn } from '../support/app'

test('counts seeded spending against the budget limit', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })

  await createMonthlyBudget(request, user, {
    name: 'Monthly Food',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
  })

  // Dated where the period starts, so both fall inside it whatever day the suite runs. A
  // transaction outside the period is not counted and not complained about, which would leave
  // the card reading $0.00 used and the assertion below blaming the total
  for (const amount of [-4250, -1000]) {
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount,
      date: budgetPeriodStart(),
    })
  }

  await logIn(page, user)
  await page.goto('/budgets')

  await expect(page.getByRole('heading', { name: 'Monthly Food' })).toBeVisible()
  await expect(page.getByText('$52.50 used of $500.00')).toBeVisible()
})
