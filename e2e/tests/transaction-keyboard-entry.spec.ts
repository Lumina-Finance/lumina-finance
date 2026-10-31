// Entering a transaction from the keyboard alone: every dropdown chooses and closes by key. Every key is a real key press
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the keys are the same at every size

/** Signs up a user with two accounts and a tag, signs in and opens the Add transaction dialogue */
async function openAddDialogue(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday Chequing' })
  await createAccount(request, user, { name: 'Holiday Savings' })
  const tag = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name: 'Holiday' } })
  expect(tag.status()).toBe(201)

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  return { user, dialog, everyday }
}

test('picks a tag with the keyboard from a list opened by a click', async ({ page, request }) => {
  const { dialog } = await openAddDialogue(page, request)

  await dialog.getByRole('combobox', { name: 'Account' }).click()
  await dialog.getByRole('option', { name: 'Everyday Chequing', exact: true }).click()
  await dialog.getByRole('combobox', { name: 'Tags' }).click()
  await expect(dialog.getByPlaceholder('Search tags...')).toBeFocused()
  await page.keyboard.type('Holi')
  await expect(dialog.getByRole('option', { name: 'Holiday', exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Remove Holiday' })).toBeVisible()
})
