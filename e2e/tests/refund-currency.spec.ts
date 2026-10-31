// A refund goes only to an account in the currency of its expense: the Refund form lists no other, the Refund button is
// held off with its reason when there is none, and the server's refusal shows if a request reaches it anyway.
// Runs on desktop only: the form and the button are the same markup at every size, and the sizes are covered by the
// visual spec
import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

const REFUSED = 'A refund can only be linked to an expense in its own currency'

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

// Everyday and Savings in the test currency beside a Euro account, with a $50.00 expense in Everyday
async function expenseBesideEuroAccount(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const savings = await createAccount(request, user, { name: 'Savings', startingBalance: 50000 })
  const euro = await createAccount(request, user, { name: 'Euro account', currency: 'EUR', startingBalance: 50000 })
  const expenseId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -5000,
    date: daysFromTodayInTestTimezone(-3),
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openRow(page, expenseId)
  await dialog.getByTestId('transaction-refund').click()
  const refund = page.getByRole('dialog', { name: 'Add refund', exact: true })
  await expect(refund).toBeVisible()
  return { user, savings, euro, expenseId, dialog, refund }
}

test('lists only accounts in the currency of the expense in the Refund form, and saves to one chosen', async ({ page, request }) => {
  const { user, savings, expenseId, dialog, refund } = await expenseBesideEuroAccount(page, request)

  await expect(refund.getByRole('combobox', { name: 'Account' })).toContainText('Everyday')
  await refund.getByRole('combobox', { name: 'Account' }).click()
  await expect(refund.getByRole('option')).toHaveText(['Everyday', 'Savings'])
  await refund.getByRole('option', { name: 'Savings' }).click()
  await refund.getByRole('button', { name: 'Add refund' }).click()
  await expect(refund).toBeHidden()
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeHidden()

  // Read back, since the row on screen doesn't say which account took the refund
  const headers = asUser(user)
  const expense = await (await request.get(`${API_BASE_URL}/transactions/${expenseId}`, { headers })).json()
  expect(expense.refund_transaction_ids).toHaveLength(1)
  const saved = await (await request.get(`${API_BASE_URL}/transactions/${expense.refund_transaction_ids[0]}`, { headers })).json()
  expect(saved.account_id).toBe(savings.id)
})

// The form can't choose such an account, so the request is changed on its way out and the real server answers it
test('shows the refusal of the server when a refund in another currency reaches it anyway', async ({ page, request }) => {
  const { euro, dialog, refund } = await expenseBesideEuroAccount(page, request)
  await page.route(`${API_BASE_URL}/transactions`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    return route.continue({ postData: { ...route.request().postDataJSON(), account_id: euro.id, currency: 'EUR' } })
  })

  await refund.getByRole('button', { name: 'Add refund' }).click()
  await expect(refund).toBeHidden()
  await dialog.getByTestId('transaction-submit').click()

  await expect(dialog.getByText(REFUSED)).toBeVisible()
  await expect(dialog).toBeVisible()
})

// Only a direct request can record an expense in a currency no account holds, and the button then says why it is held off
test('holds the Refund button off with its reason when no account is in the currency of the expense', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const expenseId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -5000,
    currency: 'EUR',
    fxRate: 1.5,
    date: daysFromTodayInTestTimezone(-3),
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openRow(page, expenseId)
  const button = dialog.getByTestId('transaction-refund')

  await expect(button).toHaveAttribute('aria-disabled', 'true')
  await expect(button).toHaveAccessibleDescription('You have no account in EUR to hold this refund')

  // Held off by aria-disabled, so neither a press nor Enter may open the form
  await button.click({ force: true })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Add refund', exact: true })).toHaveCount(0)
})
