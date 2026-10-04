import { expect, test } from '@playwright/test'

import { asUser, countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// One row has no category, one moves money to savings with no category, and one names a category the
// user already holds as income while its amount reads as an expense
const CSV = [
  'Date,Amount,Category,Merchant,Transfer Account',
  '2024-03-15,-42.50,Groceries,Market,',
  '2024-03-16,-12.00,,Kiosk,',
  '2024-03-17,-30.00,Salary,Studio,',
  '2024-03-18,-100.00,,Bank,Rainy day savings',
].join('\n')

// The answers the CSV screen holds for its categories reach the preview and the import: a row with no
// category is filed under Miscellaneous, or under Transfer where it names a transfer account, and a
// new category whose name another type holds takes the name the user types
test('files CSV rows with no category under Miscellaneous or Transfer and imports a renamed new category', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await createAccount(request, user, { name: 'Rainy day savings', accountType: 'savings' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'categories.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  await expect(page.getByRole('combobox', { name: 'Existing Category (no category)', exact: true })).toContainText('Miscellaneous')
  await expect(page.getByRole('combobox', { name: 'Existing Category (transfer, no category)', exact: true })).toContainText('Transfer')

  await page.getByRole('combobox', { name: 'Existing Category Salary', exact: true }).click()
  await page.getByRole('option', { name: 'Create new category' }).click()
  const newName = page.getByRole('textbox', { name: 'Name for the new category from Salary' })
  await expect(newName).toHaveValue('Salary (CSV)')
  await newName.fill('Studio costs')

  // Held to the preview step, since the file panel beside the steps also counts its rows under Rows
  const preview = page.locator('section').filter({ has: page.getByText('Preview and Commit', { exact: true }) })
  await expect(preview.getByRole('paragraph').filter({ hasText: /^(Rows|Will Create|New Accounts|New Categories|\d+)$/ }))
    .toHaveText(['Rows', '4', 'Will Create', '4', 'New Accounts', '0', 'New Categories', '1'])

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('4 transactions imported · 0 accounts created · 1 category created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(4)

  const categories = await request.get(`${API_BASE_URL}/categories`, { headers: asUser(user) })
  expect(categories.status()).toBe(200)
  expect((await categories.json() as { name: string }[]).map((category) => category.name)).toContain('Studio costs')
})
