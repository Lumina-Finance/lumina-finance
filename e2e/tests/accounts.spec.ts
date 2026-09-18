import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { chooseFromDropdown, logIn, openModal } from '../support/app'
import { expectPendingAction, expectTransactionRow, whileApiRequestHeld } from '../support/selectors'

const ACCOUNT_NAME = 'Everyday Chequing'

test('starts a new user with no accounts and creates one through the modal', async ({ page, request }) => {
  const user = await signUpUser(request)

  await logIn(page, user)
  await page.goto('/accounts')

  // Both halves are needed before the empty state means anything. The list is given no error to
  // show, so a failed accounts request renders the same empty label a new user sees. Waiting for
  // the summary's placeholder to go says the request settled, and the summary label is there
  // only when it settled without an error, since a failure replaces the whole summary
  await expect(page.getByRole('status', { name: 'Loading net worth value' })).toBeHidden()
  await expect(page.getByText('Net Worth')).toBeVisible()

  // A fresh user sees this even against a database holding other people's records, so the
  // assertion also fails if row-level security ever stops separating one user from another
  await expect(page.getByText('No asset accounts')).toBeVisible()

  const dialog = await openModal(page, ['Add Account', 'Add account'], 'Add Account')
  await chooseFromDropdown(dialog, 'Account Type', 'Checking')
  await dialog.getByLabel('Account Name').fill(ACCOUNT_NAME)

  // Currency is left alone: it already holds the base currency chosen at signup
  await dialog.getByRole('button', { name: 'Create Account' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) })).toBeVisible()
})

test('records an expense through the modal and shows it as money out', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })

  await logIn(page, user)
  await page.goto('/transactions')

  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const accountControl = dialog.getByTestId('transaction-account')
  await expect(accountControl).toHaveRole('combobox')
  await expect(accountControl).toHaveAccessibleName('Account')
  await accountControl.click()
  await dialog.getByRole('option', { name: new RegExp(account.name) }).click()
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await dialog.getByLabel('Amount').fill('42.50')
  const submit = dialog.getByTestId('transaction-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Add Transaction')
  await whileApiRequestHeld(page, 'POST', '/transactions',
    () => submit.click(), () => expectPendingAction(submit, 'Add Transaction'),
    { account_id: account.id })

  await expect(dialog).toBeHidden()

  const row = page.getByTestId(/^transaction-row-/)
  await expect(row).toHaveCount(1)
  await expect(row).toHaveRole('button')
  await expect(row).toHaveAccessibleName(/-\$42\.50/)
  await expect(row.getByTestId('transaction-amount').filter({ visible: true })).toHaveText('-$42.50')
})

test('shows a transaction seeded over the API', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
  })

  await logIn(page, user)
  await page.goto('/transactions')

  await expectTransactionRow(page, id, '-$42.50')
})

test('keeps the account save action named while an edit is pending', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Account before edit' })
  await logIn(page, user)
  await page.goto(`/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
  await dialog.getByLabel('Account Name').fill('Account after edit')
  const submit = dialog.getByTestId('account-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Save Changes')
  await whileApiRequestHeld(page, 'PATCH', `/accounts/${account.id}`,
    () => submit.click(), () => expectPendingAction(submit, 'Save Changes'))
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Account after edit', exact: true })).toBeVisible()
})
