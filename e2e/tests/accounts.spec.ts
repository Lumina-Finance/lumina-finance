import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { chooseFromDropdown, logIn, openModal } from '../support/app'

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

  const dialog = await openModal(page, 'Add Account', 'Add Account')
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

  const dialog = await openModal(page, 'Add Transaction', 'Add Transaction')
  await chooseFromDropdown(dialog, 'Account', new RegExp(account.name))
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await dialog.getByLabel('Amount').fill('42.50')
  await dialog.getByRole('button', { name: 'Add Transaction' }).click()

  await expect(dialog).toBeHidden()

  // The row is queried by role rather than by text because it renders its amount once per
  // responsive layout and all of them sit in the DOM at once. Only the rendered one counts
  // towards the accessible name. The leading minus is the assertion: an expense recorded with
  // the wrong sign still reads $42.50, and would pass a check that only looked for the number
  await expect(page.getByRole('button', { name: /-\$42\.50/ })).toBeVisible()
})

test('shows a transaction seeded over the API', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
  })

  await logIn(page, user)
  await page.goto('/transactions')

  await expect(page.getByRole('button', { name: /-\$42\.50/ })).toBeVisible()
})
