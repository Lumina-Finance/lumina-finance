import { expect, test } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size, though only on a phone does the list start off screen, which reviewing has to
// bring into view. A tablet or desktop screen holds the list and Commit import together, and the
// preview never shows more than five rows, so more rows in the file can't push the list away there

// The second row names a day February doesn't have, so it can't be imported under any date format. The
// rows after it fill the preview, so Commit import sits far enough below the list to scroll it away
const CSV = [
  'Date,Amount,Category,Merchant,Notes',
  '2024-03-15,-42.50,Groceries,Market,Weekly shop',
  '2024-02-31,-9.99,Groceries,Market,No such day',
  '2024-03-17,-18.25,Groceries,Market,Top-up',
  '2024-03-18,-6.40,Groceries,Bakery,Bread',
  '2024-03-19,-11.75,Groceries,Market,Fruit',
  '2024-03-20,-3.10,Groceries,Bakery,Coffee',
  '2024-03-21,-27.80,Groceries,Market,Weekly shop',
].join('\n')

// A row the import can't bring in is listed with its reason and left out, and the rest of the file
// imports, as the imports from other apps already do
test('imports the rest of a CSV file and shows the row it leaves out on review', AT_EVERY_SIZE, async ({ page, request }, testInfo) => {
  // A short phone, so the list sits well above Commit import however compact the preview rows are
  if (testInfo.project.name === 'phone') await page.setViewportSize({ width: page.viewportSize()!.width, height: 640 })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'skipped.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  await expect(page.getByText('1 row will not be imported', { exact: true })).toBeVisible()
  // Closed before the import, so reviewing has to open it again
  await page.getByRole('button', { name: 'Collapse skipped rows', exact: true }).click()
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await expect(overlay.getByText('6 transactions imported · 0 accounts created · 0 categories created · 1 skipped', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(6)

  // On a phone, clicking Commit import scrolled the page down to it, past the list. A tablet or desktop
  // screen holds both
  if (testInfo.project.name === 'phone') {
    await expect(page.getByRole('button', { name: 'Expand skipped rows', exact: true })).not.toBeInViewport()
  }
  await overlay.getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  // The list opens where it can be read, with its title and headings on screen, and holds focus so a
  // keyboard user lands on it rather than back on Commit import
  await expect(page.getByRole('button', { name: 'Collapse skipped rows', exact: true })).toBeFocused()
  await expect(page.getByText('1 row was not imported', { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(page.getByRole('columnheader', { name: 'Row', exact: true })).toBeInViewport({ ratio: 1 })
  // The column mapping's examples also quote the cell, so the table is the one carrying its reason
  await expect(page.getByRole('table')
    .filter({ hasText: 'No such day' })
    .filter({ hasText: 'The date is not a real date in the format chosen above.' })).toBeVisible()
})
