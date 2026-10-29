// Runs on desktop only: the modal and the pickers are the same markup at every size, and the sizes are
// covered by the visual spec
import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// The link icon a list row shows on a refund and on the expense it refunds
function linkIcon(page: Page, id: string) {
  return page.getByTestId(`transaction-row-${id}`).getByTestId('transaction-refund-link').filter({ visible: true })
}

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

// The Refund button opens a second transaction prefilled as money coming back, and saving it links the
// two, which both rows then show without a reload, and Unlink takes the link off both again
test('refunds an expense from its modal and shows the link on both rows', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const expenseId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4200,
    date: daysFromTodayInTestTimezone(-2),
  })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByTestId('transaction-refund').click()

  const refund = page.getByRole('dialog', { name: 'Add refund', exact: true })
  await expect(refund.getByLabel('Amount')).toHaveValue('42.00')
  await refund.getByTestId('transaction-submit').click()
  await expect(refund).toBeHidden()

  // Saving the refund closes the edit window too, back on the list where both rows show the link
  await expect(expense).toBeHidden()
  await expect(linkIcon(page, expenseId)).toHaveAccessibleName('Refunded once')

  // Unlinking from the expense's modal takes the icon off both rows at once
  const reopened = await openRow(page, expenseId)
  await expect(reopened.getByTestId('linked-transaction')).toHaveCount(1)
  await reopened.getByRole('button', { name: /^Unlink / }).click()
  await expect(reopened.getByTestId('linked-transaction')).toHaveCount(0)
  await expect(page.getByTestId('transaction-refund-link').filter({ visible: true })).toHaveCount(0)
})

// Delete on a linked transaction asks what happens to the other side. The default keeps it and removes
// only the link, and ticking the box deletes both
test('asks whether deleting a linked expense also deletes its refund', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const kept = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-4) })
  const keptRefund = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1000, date: daysFromTodayInTestTimezone(-3) })
  const gone = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -2000, date: daysFromTodayInTestTimezone(-2) })
  const goneRefund = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: 2000, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  for (const [refundId, expenseId] of [[keptRefund, kept], [goneRefund, gone]]) {
    await openRow(page, refundId)
    await page.getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: 'Link to an expense', exact: true })
    const amount = refundId === keptRefund ? '$10.00' : '$20.00'
    await picker.getByTestId('link-candidate').filter({ hasText: amount }).getByRole('button', { name: /^Link / }).click()
    await expect(picker).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'Edit transaction', exact: true })).toBeHidden()
    await expect(linkIcon(page, expenseId)).toBeVisible()
  }

  // Leaving the choice alone keeps the refund and removes the link
  const keptDialog = await openRow(page, kept)
  await keptDialog.getByTestId('transaction-delete').click()
  const keepConfirm = page.getByRole('dialog', { name: 'Delete this transaction?', exact: true })
  await expect(keepConfirm.getByRole('checkbox', { name: 'Also delete the 1 linked transaction' })).not.toBeChecked()
  await expect(keepConfirm.getByRole('status')).toHaveCount(0)
  await keepConfirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByTestId(`transaction-row-${kept}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${keptRefund}`)).toBeVisible()
  await expect(linkIcon(page, keptRefund)).toHaveCount(0)

  // Ticking the box takes the refund along
  const goneDialog = await openRow(page, gone)
  await goneDialog.getByTestId('transaction-delete').click()
  const takeConfirm = page.getByRole('dialog', { name: 'Delete this transaction?', exact: true })
  const box = takeConfirm.getByRole('checkbox', { name: 'Also delete the 1 linked transaction' })

  // The tick is drawn all along and eases in with the fill, so the box never changes size
  const tick = box.locator('svg')
  await expect(tick).toHaveCSS('opacity', '0')
  await expect(tick).toHaveCSS('transition-property', 'opacity, scale')
  await expect(box).toHaveCSS('width', '20px')
  await expect(box).toHaveCSS('height', '20px')
  await box.check()
  await expect(tick).toHaveCSS('opacity', '1')
  await expect(box).toHaveCSS('width', '20px')
  await expect(box).toHaveCSS('height', '20px')
  await takeConfirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByTestId(`transaction-row-${gone}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${goneRefund}`)).toHaveCount(0)

  // The server agrees after a reload, not only the cached list
  await page.reload()
  await expect(page.getByTestId(`transaction-row-${keptRefund}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${gone}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${goneRefund}`)).toHaveCount(0)
})

// A link the server refuses leaves the picker and the edit window open with the reason, instead of closing on a
// link that was not made
test('keeps the picker and the edit window open when the link is refused', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3000, date: daysFromTodayInTestTimezone(-3) })
  const otherExpenseId = await createTransaction(request, user, { ...row, amount: -2000, date: daysFromTodayInTestTimezone(-4) })
  const refundId = await createTransaction(request, user, { ...row, amount: 1200, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await picker.getByTestId('link-candidate').getByRole('button').click()

  // The refund is linked elsewhere before the press, so the server refuses this link
  const linked = await request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
    headers: asUser(user),
    data: { original_transaction_id: otherExpenseId },
  })
  expect(linked.ok()).toBe(true)
  await picker.getByRole('button', { name: 'Link', exact: true }).click()

  await expect(picker.getByRole('alert')).toBeVisible()
  await expect(picker).toBeVisible()
  await expect(expense).toBeVisible()
})

// The picker lists only what linking would accept, so an expense is offered money that came in and a
// search narrows it
test('links an existing refund to an expense from the picker', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -3000, date: daysFromTodayInTestTimezone(-3) })
  const refundId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1200, date: daysFromTodayInTestTimezone(-1), notes: 'Store credit' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -800, date: daysFromTodayInTestTimezone(-2) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()

  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await expect(picker.getByTestId('link-candidate')).toHaveCount(1)
  await picker.getByPlaceholder('Search by merchant or note…').fill('nothing like this')
  await expect(picker.getByText('Nothing matches that search.', { exact: true })).toBeVisible()
  await picker.getByPlaceholder('Search by merchant or note…').fill('Store credit')
  await picker.getByRole('button', { name: /^Link .+ on / }).click()

  // The picker and the edit window close together, back on the list where both rows show the link
  await expect(picker).toBeHidden()
  await expect(expense).toBeHidden()
  await expect(linkIcon(page, refundId)).toHaveAccessibleName('Refund of an expense')
  await expect(linkIcon(page, expenseId)).toBeVisible()
})
