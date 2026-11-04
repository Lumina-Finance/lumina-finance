import { expect, test } from '@playwright/test'

import { createCategory, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only. A settings row button named for its row, such as "Edit Groceries", is also described
// by what it does, so a screen reader announces "Edit category" after the name, as the tooltip says it

test('describes a category row button by the hint its tooltip shows', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCategory(request, user, { name: 'Greenhouse supplies' })
  await logInViaApi(page, user)
  await openPage(page, '/settings#categories')

  // Categories are grouped and each group starts collapsed, so the group holding the new one is opened first
  await page.locator('#categories').getByRole('button', { name: /^Expense/ }).first().click()
  const edit = page.getByRole('button', { name: 'Edit Greenhouse supplies', exact: true })
  const remove = page.getByRole('button', { name: 'Delete Greenhouse supplies', exact: true })
  await expect(edit).toBeVisible()
  await expect(edit).toHaveAccessibleDescription('Edit category')
  await expect(remove).toHaveAccessibleDescription('Delete category')
})
