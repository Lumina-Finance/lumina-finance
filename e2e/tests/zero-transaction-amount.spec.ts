import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { expectTransactionRow } from '../support/selectors'
import { AT_EVERY_SIZE } from '../support/sizes'

// The first test runs at every size because the row has a grid layout and a stacked phone layout,
// and each renders its own copy of the amount

test('shows a zero transaction amount unsigned beside signed ones', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const zeroId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 0 })
  const spentId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000 })
  const refundId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1000 })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  await expectTransactionRow(page, zeroId, '$0.00')
  await expectTransactionRow(page, spentId, '−$10.00')
  await expectTransactionRow(page, refundId, '+$10.00')
})

// Runs on desktop only: the dashboard card renders one layout at every width, so a phone and a
// tablet would show the same text and colour
test('shows a zero transaction amount unsigned and neutral in the dashboard recent activity', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 0 })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000 })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 1000 })

  await logInViaApi(page, user)
  await openPage(page, '/')

  const amounts = page.getByTestId('recent-activity-amount')
  const zero = amounts.filter({ hasText: /^\$0\.00$/ })
  const expense = amounts.filter({ hasText: /^−\$10\.00$/ })
  const income = amounts.filter({ hasText: /^\+\$10\.00$/ })
  await expect(zero).toHaveCount(1)
  await expect(expense).toHaveCount(1)
  await expect(income).toHaveCount(1)

  // A zero in an income category stays neutral, the colour of the expense, and not the green of the income
  const colour = (amount: typeof zero) => amount.evaluate((element) => getComputedStyle(element).color)
  const neutral = await colour(expense)
  expect(await colour(income)).not.toBe(neutral)
  expect(await colour(zero)).toBe(neutral)
})
