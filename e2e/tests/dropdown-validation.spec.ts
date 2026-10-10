import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { openPage, chooseFromDropdown, logInViaApi, openModal } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop only, apart from the Category message test, which runs at every size: where the
// message sits depends on the width

test('exposes and clears an invalid dropdown with its inline validation alert', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  const dialog = await openModal(page, ['Add Account', 'Add account'], 'Add Account')
  await dialog.getByRole('textbox', { name: 'Account Name', exact: true }).fill('Validation account')
  const type = dialog.getByRole('combobox', { name: 'Account Type', exact: true })
  await dialog.getByRole('button', { name: 'Create Account', exact: true }).click()
  await expect(type).toHaveAttribute('aria-invalid', 'true')
  const error = dialog.getByRole('alert').filter({ hasText: 'Select an account type' })
  await expect(error).toBeVisible()
  await expect(error).toHaveText('Select an account type')

  await chooseFromDropdown(dialog, 'Account Type', 'Checking')
  await expect(type).not.toHaveAttribute('aria-invalid', 'true')
  await expect(error).toBeHidden()
  await expect(type).toHaveAccessibleName('Account Type')
  await expect(type).toHaveText('Checking')
})

test('keeps the transaction Category message on its label line without moving the field', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Validation account' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const category = dialog.getByRole('combobox', { name: 'Category', exact: true })
  // Read from the label in one go, since the dialog may still be sliding in
  const belowLabel = () => category.evaluate((field) => {
    const label = document.getElementById(field.getAttribute('aria-labelledby')!)!
    return field.getBoundingClientRect().top - label.getBoundingClientRect().top
  })
  const gap = await belowLabel()

  await dialog.getByRole('button', { name: 'Add Transaction', exact: true }).click()
  const error = dialog.getByRole('alert').filter({ hasText: 'Select a category' })
  await expect(error).toBeVisible()
  // On the label's line, and the field as far below the label as before the message showed
  const labelId = (await category.getAttribute('aria-labelledby'))!
  const besideLabel = await error.evaluate((message, id) =>
    message.getBoundingClientRect().top - document.getElementById(id)!.getBoundingClientRect().top, labelId)
  expect(Math.abs(besideLabel)).toBeLessThan(2)
  // Within 2px, since the dialog's opening scale can still be settling when the first reading is taken
  expect(Math.abs(await belowLabel() - gap)).toBeLessThan(2)
})
