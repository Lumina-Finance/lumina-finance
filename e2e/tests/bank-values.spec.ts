import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { answerAsBankImported, BANK_SOURCE, type BankSource } from '../support/bankSync'
import { expectPendingAction, expectTransactionRow, MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// The edit modal of a bank-imported transaction shows the bank's description and, under each field
// the user edited, the bank's value with Restore bank value. Nothing links an account on the server
// for a sync to import a transaction, so each test answers the app's reads with the source the server
// attaches, and answers a restore by writing the bank's value to the real transaction, as the server
// does, then answering with the source as the restore left it
const BANK_DESCRIPTION = 'HARBOUR CAFE #12 VANCOUVER'
const RESTORE_FAILED = 'Could not restore the bank value. Please try again.'

/** A bank source sending these values, with these fields edited in the ledger */
function bankSource(values: Partial<BankSource['bank_values']>, editedFields: BankSource['edited_fields']): BankSource {
  return {
    ...BANK_SOURCE,
    bank_values: { ...BANK_SOURCE.bank_values, description: BANK_DESCRIPTION, ...values },
    edited_fields: editedFields,
  }
}

/**
 * Answers a restore of the transaction by writing the bank's value for the field to it through the
 * real server and taking the field out of its source's edited ones, so every later read agrees. The
 * answer waits on the returned release, for a test that looks at the modal while it restores
 */
async function answerRestores(
  page: Page,
  request: APIRequestContext,
  user: TestUser,
  sources: Record<string, BankSource>,
  id: string,
): Promise<() => void> {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    const { field } = route.request().postDataJSON() as { field: 'date' | 'amount' }
    await held

    const { bank_values: bank } = sources[id]
    const response = await request.patch(`${API_BASE_URL}/transactions/${id}`, {
      headers: asUser(user),
      data: field === 'date' ? { dt: bank.date } : { amount: bank.amount },
    })
    expect(response.ok(), `writing the bank's ${field} answered ${response.status()}: ${await response.text()}`).toBe(true)
    sources[id] = { ...sources[id], edited_fields: sources[id].edited_fields.filter((edited) => edited !== field) }
    await route.fulfill({ json: { ...await response.json(), bank_source: sources[id] } })
  })
  return release
}

/** Opens the edit modal of the transaction from its row */
async function openTransaction(page: Page, id: string): Promise<Locator> {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The restore action under the date or the amount, found by the bank value it is described by */
function restoreAction(dialog: Locator, field: 'date' | 'amount'): Locator {
  return dialog.locator(`button[aria-describedby="txn-${field}-bank-value"]`)
}

/** Assert the first box sits below the second and starts within its left and right edges */
async function expectUnder(caption: Locator, field: Locator): Promise<void> {
  const [captionBox, fieldBox] = [(await caption.boundingBox())!, (await field.boundingBox())!]
  expect(captionBox.y).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height - 1)
  expect(captionBox.x).toBeGreaterThanOrEqual(fieldBox.x - 1)
  expect(captionBox.x).toBeLessThan(fieldBox.x + fieldBox.width)
}

// A stand-in can still be fetching for the page when a test ends, which would otherwise surface as an
// error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('restores the bank amount under an edited amount, bringing back its sign and direction', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })

  // The bank sent money out, which the user turned into money in
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: 4210,
    date: BANK_SOURCE.bank_values.date,
  })
  const sources = { [id]: bankSource({ amount: -4210 }, ['amount']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(`transaction-row-${id}`).getByTestId('bank-edited-dot').filter({ visible: true })).toBeVisible()

  // The provider and the bank's description head the form, read-only
  const dialog = await openTransaction(page, id)
  await expect(dialog.getByText('From SimpleFIN', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('definition').filter({ hasText: BANK_DESCRIPTION })).toBeVisible()
  await expect(dialog.getByRole('term').filter({ hasText: 'Bank description' })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Bank description' })).toHaveCount(0)

  // The bank's amount shows under the amount alone, the date left as it was
  const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })
  const caption = dialog.locator('#txn-amount-bank-value')
  await expect(caption).toHaveText(`Bank: ${MINUS}$42.10`)
  await expectUnder(caption, amount)
  await expect(dialog.locator('#txn-date-bank-value')).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Restore bank value' })).toHaveCount(1)
  await expect(amount).toHaveValue('42.10')
  await expect(dialog.getByRole('tab', { name: 'Credit', exact: true })).toHaveAttribute('aria-selected', 'true')

  // While it restores, the action says so and the modal takes no save
  const restore = restoreAction(dialog, 'amount')
  await expect(restore).toHaveAccessibleName('Restore bank value')
  await restore.click()
  await expectPendingAction(restore, 'Restoring')
  await expect(dialog.getByTestId('transaction-submit')).toBeDisabled()
  release()

  // The amount reads the bank's, money out again, and nothing is left to restore
  await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(amount).toHaveValue('42.10')
  await expect(caption).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: /Restor/ })).toHaveCount(0)
  await expect(dialog.getByText(RESTORE_FAILED)).toHaveCount(0)
  await expect(dialog.getByTestId('transaction-submit')).toBeEnabled()

  // The restore was saved, so the row has the bank's amount and loses its edited dot
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$42.10`)
  await expect(page.getByTestId(`transaction-row-${id}`).getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(0)
})

test('saves an edit made after a restore in the same modal, compared with the restored value', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: 4210,
    date: BANK_SOURCE.bank_values.date,
  })
  const sources = { [id]: bankSource({ amount: -4210 }, ['amount']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  release()
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  await restoreAction(dialog, 'amount').click()
  await expect(dialog.getByRole('tab', { name: 'Debit', exact: true })).toHaveAttribute('aria-selected', 'true')

  // Turning it back into money in matches the transaction as the modal opened, but not as the restore
  // saved it, so the save still sends it
  await dialog.getByRole('tab', { name: 'Credit', exact: true }).click()
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, '+$42.10')
})

test('restores the bank date under an edited date, which stays restored once the modal reopens', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: BANK_SOURCE.bank_values.amount!,
    date: '2026-01-13',
  })
  const sources = { [id]: bankSource({}, ['date']) }
  await answerAsBankImported(page, sources)
  const release = await answerRestores(page, request, user, sources, id)
  release()
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  const date = dialog.getByRole('group', { name: 'Date' })
  const caption = dialog.locator('#txn-date-bank-value')
  await expect(caption).toHaveText('Bank: Jan 15, 2026')
  await expectUnder(caption, date)
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveCount(0)
  await expect(date.getByRole('textbox', { name: 'Day' })).toHaveValue('13')

  await restoreAction(dialog, 'date').click()
  await expect(date.getByRole('textbox', { name: 'Day' })).toHaveValue('15')
  await expect(caption).toHaveCount(0)

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  const reopened = await openTransaction(page, id)
  await expect(reopened.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Day' })).toHaveValue('15')
  await expect(reopened.getByRole('button', { name: 'Restore bank value' })).toHaveCount(0)
})

test('says a restore failed, leaving the field and its bank value to try again', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4000,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [id]: bankSource({ amount: -4210 }, ['amount']) })
  await page.route(`${API_BASE_URL}/bank-sync/transaction-sources/${id}/restore`, (route) =>
    route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } }))
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openTransaction(page, id)
  const restore = restoreAction(dialog, 'amount')
  await restore.click()
  await expect(dialog.getByText(RESTORE_FAILED, { exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('40.00')
  await expect(dialog.locator('#txn-amount-bank-value')).toHaveText(`Bank: ${MINUS}$42.10`)
  await expect(restore).toHaveAccessibleName('Restore bank value')
  await expect(restore).toBeEnabled()
})
