import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { openPage, chooseFromDropdown, logInViaApi, openModal } from '../support/app'
import { expectPendingAction, whileApiRequestHeld } from '../support/selectors'

// Runs on desktop only: creating, recording and editing accounts give the same result at every size

const ACCOUNT_NAME = 'Everyday Chequing'

test('starts a new user with no accounts and creates one through the modal', async ({ page, request }) => {
  const user = await signUpUser(request)

  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  // Both halves are needed before the empty state means anything. The list is given no error to
  // show, so a failed accounts request renders the same empty label a new user sees. Waiting for
  // the summary's placeholder to go says the request settled, and the summary label is there
  // only when it settled without an error, since a failure replaces the whole summary
  await expect(page.getByRole('status', { name: 'Loading net worth value' })).toBeHidden()
  await expect(page.getByText('Net worth')).toBeVisible()

  // A fresh user sees this even against a database holding other people's records, so the
  // assertion also fails if row-level security ever stops separating one user from another
  await expect(page.getByText('No asset accounts')).toBeVisible()

  const dialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(dialog, 'Account type', 'Checking')
  await dialog.getByLabel('Account name').fill(ACCOUNT_NAME)

  // Currency is left alone: it already holds the base currency chosen at signup
  await dialog.getByRole('button', { name: 'Create account' }).click()

  await expect(dialog).toBeHidden()
  await expect(page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) })).toBeVisible()
})

test('refuses over-long notes in Add account and scrolls long notes by keyboard', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const createDialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(createDialog, 'Account type', 'Checking')
  await createDialog.getByLabel('Account name').fill(ACCOUNT_NAME)
  await createDialog.getByLabel('Notes').fill('x'.repeat(2001))
  await createDialog.getByLabel('Account name').focus()
  await expect(createDialog.getByRole('alert')).toHaveText('Notes must be 2000 characters or less.')
  await createDialog.getByLabel('Notes').fill(Array.from({ length: 40 }, (_, line) => `Line ${line + 1}`).join('\n'))
  await createDialog.getByRole('button', { name: 'Create account' }).click()
  await expect(createDialog).toBeHidden()

  await page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) }).click()
  const notes = page.getByRole('region', { name: 'Notes' })
  await expect(notes).toContainText('Line 40')
  await notes.focus()
  await expect(notes).toBeFocused()
  await page.keyboard.press('End')
  await expect.poll(() => notes.evaluate((node) => node.scrollTop)).toBeGreaterThan(0)
})

test('keeps the notes written for an account, shows them on its page and clears them', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')

  const createDialog = await openModal(page, ['Add account'], 'Add account')
  await chooseFromDropdown(createDialog, 'Account type', 'Checking')
  await createDialog.getByLabel('Account name').fill(ACCOUNT_NAME)
  await createDialog.getByLabel('Notes').fill('Account 123-456\nCustomer 42')
  await createDialog.getByRole('button', { name: 'Create account' }).click()
  await expect(createDialog).toBeHidden()

  await page.getByRole('link', { name: new RegExp(ACCOUNT_NAME) }).click()
  const notes = page.getByText('Customer 42')
  await expect(notes).toHaveText('Account 123-456\nCustomer 42')

  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const editDialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  const field = editDialog.getByLabel('Notes')
  await expect(field).toHaveValue('Account 123-456\nCustomer 42')
  await field.fill('x'.repeat(2001))
  await editDialog.getByTestId('account-submit').click()
  await expect(editDialog.getByRole('alert')).toHaveText('Notes must be 2000 characters or less.')
  await expect(field).toHaveAttribute('aria-invalid', 'true')

  await field.fill('')
  await editDialog.getByTestId('account-submit').click()
  await expect(editDialog).toBeHidden()
  await expect(notes).toHaveCount(0)
  await expect(page.getByText('Notes', { exact: true })).toHaveCount(0)
})

test('records an expense through the modal and shows it as money out', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
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
  await expect(submit).toHaveAccessibleName('Add transaction')
  await whileApiRequestHeld(page, 'POST', '/transactions',
    () => submit.click(), () => expectPendingAction(submit, 'Add transaction'),
    { account_id: account.id })

  await expect(dialog).toBeHidden()

  const row = page.getByTestId(/^transaction-row-/)
  await expect(row).toHaveCount(1)
  await expect(row).toHaveRole('button')
  await expect(row).toHaveAccessibleName(/−\$42\.50/)
  await expect(row.getByTestId('transaction-amount').filter({ visible: true })).toHaveText('−$42.50')
})

test('keeps the account save action named while an edit is pending', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Account before edit' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByLabel('Account name').fill('Account after edit')
  const submit = dialog.getByTestId('account-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Save changes')
  await whileApiRequestHeld(page, 'PATCH', `/accounts/${account.id}`,
    () => submit.click(), () => expectPendingAction(submit, 'Save changes'))
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Account after edit', exact: true })).toBeVisible()
})

// A deleted account's page stays on screen while it animates out, and nothing on it may ask the server
// about the account again, which answers every such request with not found
test('asks nothing more about an account once it is deleted from its page', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: ACCOUNT_NAME })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -500 })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  await dialog.getByRole('button', { name: 'Continue', exact: true }).click()
  const confirmation = dialog.getByLabel(`Type "${ACCOUNT_NAME}" to delete.`, { exact: true })
  await confirmation.fill(ACCOUNT_NAME)

  const isAboutAccount = (url: string) => url.includes(account.id)
  let deleted = false
  const askedAfterDelete: string[] = []
  page.on('response', (response) => {
    if (response.request().method() === 'DELETE' && isAboutAccount(response.url()) && response.ok()) deleted = true
  })
  page.on('request', (sent) => {
    if (deleted && isAboutAccount(sent.url())) askedAfterDelete.push(`${sent.method()} ${sent.url()}`)
  })
  await confirmation.press('Enter')

  await expect(page).toHaveURL(/\/accounts$/)
  await expect(page.getByRole('heading', { name: 'My accounts', exact: true })).toBeVisible()
  // The account's page fades out over the list, and a request it sent late in that fade would still count
  await expect(page.getByRole('heading', { name: ACCOUNT_NAME, exact: true })).toHaveCount(0)
  expect(deleted).toBe(true)
  expect(askedAfterDelete).toEqual([])
})
