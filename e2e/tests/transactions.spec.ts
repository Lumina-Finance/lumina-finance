import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { filterByCategory, logIn } from '../support/app'

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

  // Every row carries its amount in its own name, so this counts rows and nothing else
  const rows = page.getByRole('button', { name: /-\$\d+\.\d\d/ })

  await expect(rows).toHaveCount(3)

  await filterByCategory(page, 'Groceries')

  // The list holds the rows it had before Apply for a second, so anything asserted first would
  // be reading the unfiltered list. Waiting for the Dining row to go is what says the filtered
  // result has arrived, and only then does what survived mean anything
  await expect(dining).toBeHidden()

  // Counted as well as named, or a filter that wrongly matched nothing would leave an empty
  // list that satisfies every assertion about what should have gone
  await expect(rows).toHaveCount(2)
  for (const row of groceries) {
    await expect(row).toBeVisible()
  }

  // Nothing here asserts on the filter controls themselves. A collapsed panel keeps its
  // children in the DOM without inert or aria-hidden, so a check that the Groceries box is
  // visible passes whether or not the panel ever opened
})
