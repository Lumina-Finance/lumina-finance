import { expect, test } from '@playwright/test'

import { createAccount, findReferenceId, signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// A transaction can be recorded in a currency its account does not hold, and a move keeps that
// currency, so a selection in a currency none of the user's accounts holds has nowhere to move and
// the panel has to say which accounts it looked for
test('says why a selection in a currency no account holds cannot move', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  const [category, merchant] = await Promise.all([
    findReferenceId(request, user, 'categories', 'Groceries'),
    findReferenceId(request, user, 'merchants', 'Unknown'),
  ])
  const response = await request.post(`${API_BASE_URL}/transactions`, {
    headers: { Authorization: `Bearer ${user.accessToken}` },
    data: {
      account_id: account.id, category_id: category, merchant_id: merchant,
      dt: todayInTestTimezone(), amount: -2500, currency: 'USD', fx_rate: 1.35,
    },
  })
  expect(response.status(), await response.text()).toBe(201)
  const { id } = await response.json() as { id: string }

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeVisible()
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await page.getByRole('checkbox', { name: /^Select the transactions shown on / }).first().check()
  await page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).click()

  const edit = page.getByRole('dialog', { name: 'Edit 1 transaction', exact: true })
  await expect(edit).toBeVisible()
  await expect(edit.locator('#bulk-account')).toBeDisabled()
  await expect(edit.locator('#bulk-account')).toContainText('No account to move to')

  const reason = edit.getByRole('button', { name: 'No account for this currency', exact: true })
  await reason.click()
  await expect(reason).toHaveAttribute('aria-expanded', 'true')
  await expect(edit.getByText('No unarchived account holds this currency.', { exact: true }))
    .toBeVisible()
})
