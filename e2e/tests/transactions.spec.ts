import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logIn } from '../support/app'

test('filters the list down to one category', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })

  for (const seed of [
    { categoryName: 'Groceries', amount: -1000 },
    { categoryName: 'Groceries', amount: -2000 },
    { categoryName: 'Dining', amount: -3000 },
  ]) {
    await createTransaction(request, user, { accountId: account.id, ...seed })
  }

  await logIn(page, user)
  await page.goto('/transactions')

  // Each row is found by its own amount, which is what makes the assertions below say which
  // transactions survived rather than only how many did
  const groceries = [
    page.getByRole('button', { name: /-\$10\.00/ }),
    page.getByRole('button', { name: /-\$20\.00/ }),
  ]
  const dining = page.getByRole('button', { name: /-\$30\.00/ })

  await expect(dining).toBeVisible()

  await page.getByRole('button', { name: 'Transaction filters' }).click()
  await page.getByRole('tab', { name: 'Category' }).click()
  await page.getByRole('checkbox', { name: 'Groceries' }).click()
  await page.getByRole('button', { name: 'Apply filters' }).click()

  // Nothing here asserts on the filter controls themselves. A collapsed panel keeps its
  // children in the DOM without inert or aria-hidden, so a check that the Groceries box is
  // visible passes whether or not the panel ever opened
  for (const row of groceries) {
    await expect(row).toBeVisible()
  }
  await expect(dining).toBeHidden()
})
