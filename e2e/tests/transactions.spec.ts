import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { openPage, chooseFromDropdown, filterByCategory, logIn, openModal } from '../support/app'
import { expectPendingAction, expectTransactionRow, whileApiRequestHeld } from '../support/selectors'

test('filters the list down to one category', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })

  const ids: string[] = []
  for (const seed of [
    { categoryName: 'Groceries', amount: -1000 },
    { categoryName: 'Groceries', amount: -2000 },
    { categoryName: 'Dining', amount: -3000 },
  ]) {
    ids.push(await createTransaction(request, user, { accountId: account.id, ...seed }))
  }

  await logIn(page, user)
  await openPage(page, '/transactions')

  const groceries = ids.slice(0, 2).map((id) => page.getByTestId(`transaction-row-${id}`))
  const dining = page.getByTestId(`transaction-row-${ids[2]}`)
  const rows = page.getByTestId(/^transaction-row-/)
  await expect(rows).toHaveCount(3)
  for (const [index, amount] of ['-$10.00', '-$20.00', '-$30.00'].entries()) {
    await expectTransactionRow(page, ids[index], amount)
  }

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

test('keeps transaction account controls identifiable as transfer labels change', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Transfer source' })
  await createAccount(request, user, { name: 'Transfer destination' })
  await logIn(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const account = dialog.getByTestId('transaction-account')
  const counterparty = dialog.getByTestId('transaction-counterparty-account')

  await expect(account).toHaveRole('combobox')
  await expect(account).toHaveAccessibleName('Account')
  await expect(counterparty).toHaveCount(0)
  await dialog.getByRole('tab', { name: 'Transfer', exact: true }).click()
  await chooseFromDropdown(dialog, 'Category', 'Transfer')
  await expect(account).toHaveAccessibleName('Recorded in')
  await expect(counterparty).toHaveRole('combobox')
  await expect(counterparty).toHaveAccessibleName('Money went to')
  await dialog.getByRole('tab', { name: 'Credit', exact: true }).click()
  await expect(counterparty).toHaveAccessibleName('Money came from')
  await dialog.getByRole('checkbox', { name: /Record in both accounts/ }).check()
  await expect(account).toHaveAccessibleName('From account')
  await expect(counterparty).toHaveAccessibleName('Money went to')
  await dialog.getByRole('checkbox', { name: /Record in both accounts/ }).uncheck()
  await chooseFromDropdown(dialog, 'Category', 'Balance Adjustment')
  await expect(account).toHaveAccessibleName('Account')
  await expect(counterparty).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
})

test('preserves transaction action names through save and delete confirmation', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Action account' })
  const id = await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -4250,
  })
  await logIn(page, user)
  await openPage(page, '/transactions')
  await expectTransactionRow(page, id, '-$42.50')
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit Transaction', exact: true })
  await dialog.getByLabel('Amount').fill('43.50')
  const submit = dialog.getByTestId('transaction-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Save')
  await whileApiRequestHeld(page, 'PATCH', `/transactions/${id}`,
    () => submit.click(), () => expectPendingAction(submit, 'Save'))
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, '-$43.50')

  await page.getByTestId(`transaction-row-${id}`).click()
  const remove = dialog.getByTestId('transaction-delete')
  await expect(remove).toHaveRole('button')
  await expect(remove).toHaveAccessibleName('Delete')
  await remove.click()
  await expect(remove).toHaveAccessibleName('Yes, delete')
  await dialog.getByLabel('Amount').click()
  await expect(remove).toHaveAccessibleName('Delete')
  await remove.click()
  await expect(remove).toHaveAccessibleName('Yes, delete')
  await whileApiRequestHeld(page, 'DELETE', `/transactions/${id}`,
    () => remove.click(), () => expectPendingAction(remove, 'Yes, delete'))
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeHidden()
})
