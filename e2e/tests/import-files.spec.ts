import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

const CSV = ['Date,Amount,Category,Merchant', '2024-03-15,-12.34,Groceries,Unknown'].join('\n')

// The upload card goes away once the file is staged, so a keyboard user would otherwise be left on
// the page body. Focus moves to the control that replaced it
test('moves focus to Remove once a CSV file chosen from the keyboard is staged', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')

  const uploadCard = page.getByRole('button', { name: /^Upload CSV file/ })
  await expect(uploadCard).toBeEnabled()
  await uploadCard.focus()
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles({ name: 'transactions.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  await expect(uploadCard).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove transactions.csv', exact: true })).toBeFocused()
})
