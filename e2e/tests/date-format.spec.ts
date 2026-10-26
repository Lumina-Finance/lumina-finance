import { expect, test } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop alone: the setting changes text, which reads the same at every size

test('writes every date in the format chosen in Settings, without a reload and after one', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -4250, date: '2026-03-14',
  })
  await logInViaApi(page, user)

  await openPage(page, '/transactions')
  await expect(page.getByText('March 14, 2026', { exact: true })).toBeVisible()

  await openPage(page, '/settings#profile')
  await page.getByRole('combobox', { name: 'Date format' }).click()
  await page.getByText('24 Sep 2026', { exact: true }).click()
  await page.locator('#profile').getByRole('button', { name: 'Save', exact: true }).click()

  // The profile page stays mounted long enough to show that the save went through
  await expect(page.locator('#profile').getByLabel('Saved')).toBeVisible()

  // Moving to another page by its link keeps the session, so this is the change reaching a screen
  // the setting was not saved on
  await page.getByRole('link', { name: 'Transactions', exact: true }).first().click()
  await expect(page.getByText('14 March 2026', { exact: true })).toBeVisible()

  await openPage(page, '/transactions')
  await expect(page.getByText('14 March 2026', { exact: true })).toBeVisible()
})
