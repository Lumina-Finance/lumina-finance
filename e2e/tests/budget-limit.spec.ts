import { expect, test } from '@playwright/test'

import { createMonthlyBudget, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// A person keeps at most 100 budgets, so one with 100 sees the add control held off with its reason
const MAX_BUDGETS = 100
const REASON = 'You can keep up to 100 budgets. Please delete one to add another.'

test('holds New budget off at 100 budgets, and a click or Enter opens nothing', async ({ page, request }) => {
  test.setTimeout(240_000)
  const user = await signUpUser(request)
  const budgetIds: string[] = []
  for (let index = 0; index < MAX_BUDGETS; index += 1) {
    budgetIds.push(
      await createMonthlyBudget(request, user, {
        name: `Budget ${index}`,
        categoryNames: ['Groceries'],
        overallLimit: 10_000,
      }),
    )
  }

  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  const add = page.getByRole('button', { name: 'New budget', exact: true })
  await expect(add).toHaveAttribute('aria-disabled', 'true')
  await expect(add).toHaveAccessibleDescription(REASON)

  // Playwright treats a button held off with aria-disabled as one it cannot click, and a real user can
  await add.click({ force: true })
  await add.press('Enter')

  // A dialogue follows a press that runs, so opening a budget afterwards is the fence: once its dialogue
  // is up, anything the presses opened would be up as well
  await page.getByTestId(`budget-card-${budgetIds[0]}`).click()
  await expect(page.getByRole('dialog', { name: 'Budget 0', exact: true })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await expect(page.getByRole('dialog', { name: 'Add budget' })).toHaveCount(0)
})
