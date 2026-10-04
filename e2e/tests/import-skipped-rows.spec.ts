import { expect, test } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// The second row names a day February doesn't have, so it can't be imported under any date format
const CSV = [
  'Date,Amount,Category,Merchant,Notes',
  '2024-03-15,-42.50,Groceries,Market,Weekly shop',
  '2024-02-31,-9.99,Groceries,Market,No such day',
  '2024-03-17,-18.25,Groceries,Market,Top-up',
].join('\n')

// A row the import can't bring in is listed with its reason and left out, and the rest of the file
// imports, as the imports from other apps already do
test('imports the rest of a CSV file and lists the row it leaves out', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'skipped.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  await expect(page.getByText('1 row will not be imported', { exact: true })).toBeVisible()
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await expect(overlay.getByText('2 transactions imported · 0 accounts created · 0 categories created · 1 skipped', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(2)

  await overlay.getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  await expect(page.getByText('1 row was not imported', { exact: true })).toBeVisible()
  // The column mapping's examples also quote the cell, so the row is the one carrying its reason
  await expect(page.getByRole('row')
    .filter({ hasText: 'No such day' })
    .filter({ hasText: 'The date is not a real date in the format chosen above.' })).toBeVisible()
})
