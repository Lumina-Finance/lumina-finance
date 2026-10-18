import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { openPage, chooseFromDropdown, logInViaApi } from '../support/app'

// Runs on desktop only: accessible names and labels are the same at every size

test('associates profile inputs with their visible labels', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const firstName = page.getByRole('textbox', { name: 'First name', exact: true })
  await expect(firstName).toBeVisible()
  await expect(firstName).toHaveValue(user.firstName)
  await expect(page.getByRole('textbox', { name: 'Last name', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Timezone', exact: true })).toBeVisible()
  const currency = page.getByRole('textbox', { name: 'Base currency', exact: true })
  await expect(currency).toBeVisible()
  await expect(currency).toBeDisabled()
})

test('names the import file-picker entry without opening a picker', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Import audit account' })
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  const generic = page.getByRole('button', { name: /^Upload CSV file/ })
  await expect(generic).toBeVisible()
  await expect(generic).toHaveAccessibleName('Upload CSV files Every file needs the same columns.')
  await chooseFromDropdown(page.locator('body'), 'Data source', /Firefly III/)
  const transactions = page.getByRole('button', { name: /^Upload transactions CSV/ })
  const budgets = page.getByRole('button', { name: /^Upload budgets CSV/ })
  await expect(transactions).toBeVisible()
  await expect(transactions).toHaveAccessibleName('Upload transactions CSV The journal rows to import.')
  await expect(budgets).toBeVisible()
  await expect(budgets).toHaveAccessibleName('Upload budgets CSV Without it, create budgets by hand after the import.')
  const accounts = page.getByRole('button', { name: /^Upload accounts CSV/ })
  await expect(accounts).toHaveAccessibleName('Upload accounts CSV Without it, each new asset account is created as an active checking account unless you choose another type.')
})
