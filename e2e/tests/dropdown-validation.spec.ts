import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { openPage, chooseFromDropdown, logInViaApi, openModal } from '../support/app'

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
