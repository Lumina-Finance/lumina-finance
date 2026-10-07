import { expect, test } from '@playwright/test'

import { createAccount, createGroup, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Two of three rows are ticked and deleted after the confirmation, the third stays, and the balance
// already on screen drops back by what the deleted rows had taken out, without a reload
test('deletes the selected transactions and brings the balance back', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  const kept = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-3) })
  const deletedDates = [daysFromTodayInTestTimezone(-2), daysFromTodayInTestTimezone(-1)]
  const deleted = [
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -2500, date: deletedDates[0] }),
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4000, date: deletedDates[1] }),
  ]

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await expect(page.getByText('$25.00', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  for (const date of deletedDates) await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${date}$`) }).check()
  await page.getByRole('button', { name: 'Delete the selected transactions', exact: true }).click()

  const confirm = page.getByRole('dialog', { name: 'Delete 2 transactions?', exact: true })
  await expect(confirm.getByText("This can't be undone.", { exact: true })).toBeVisible()
  await confirm.getByRole('button', { name: 'Delete', exact: true }).click()

  await expect(confirm).toBeHidden()
  await expect(page.getByText('2 transactions deleted.', { exact: true })).toBeVisible()
  for (const id of deleted) await expect(page.getByTestId(`transaction-row-${id}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${kept}`)).toBeVisible()
  await expect(page.getByText('$90.00', { exact: true }).first()).toBeVisible()
})

// Group accounts are left out of bulk delete, so a selection reaching one turns Delete off with why
test('turns Delete off while a group account row is ticked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const groupId = await createGroup(request, user, 'Household')
  const shared = await createAccount(request, user, { name: 'Shared chequing', groupId })
  await createTransaction(request, user, { accountId: shared.id, categoryName: 'Groceries', amount: -1500, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${shared.id}`)
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${daysFromTodayInTestTimezone(-1)}$`) }).check()

  const deleteAction = page.getByRole('button', { name: 'Delete the selected transactions', exact: true })
  await expect(deleteAction).toBeDisabled()
  await expect(deleteAction).toHaveAttribute('title', "Transactions in group accounts can't be deleted in bulk")
})

// The confirmation opens on Cancel so a stray Enter deletes nothing, reads its warning with the title,
// and Tab moves through the actions the way they are drawn, Delete on the left and Cancel on the right
test('opens the delete confirmation on Cancel and tabs through its actions as drawn', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const date = daysFromTodayInTestTimezone(-1)
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${date}$`) }).check()
  await page.getByRole('button', { name: 'Delete the selected transactions', exact: true }).click()

  const confirm = page.getByRole('dialog', { name: 'Delete 1 transaction?', exact: true })
  const cancel = confirm.getByRole('button', { name: 'Cancel', exact: true })
  const remove = confirm.getByRole('button', { name: 'Delete', exact: true })
  await expect(confirm).toHaveAccessibleDescription(/This can't be undone\./)
  await expect(cancel).toBeFocused()

  const [removeBox, cancelBox] = [await remove.boundingBox(), await cancel.boundingBox()]
  expect(removeBox!.x).toBeLessThan(cancelBox!.x)

  await page.keyboard.press('Shift+Tab')
  await expect(remove).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(confirm.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(cancel).toBeFocused()
})
