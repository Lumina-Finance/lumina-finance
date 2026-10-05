import { expect, test } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// A semicolon file with decimal-comma amounts, the shape European bank exports take
const CSV = [
  'Date;Merchant;Amount',
  '2026-03-15;Kiosk;-12,00',
  '2026-03-16;Market;-4,50',
].join('\n')

// The Separator dropdown shows what the reader detected, reads the file again with the one chosen
// and starts the column mapping over, and a file read as one column is pointed back to it
test('reads a CSV file again with the separator chosen and imports it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'semicolons.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  const separator = page.getByRole('combobox', { name: 'Separator', exact: true })
  await expect(separator).toHaveText('Semicolon')

  await separator.click()
  await page.getByRole('option', { name: 'Pipe', exact: true }).click()
  await expect(page.getByText('Only one column was found. Choose the separator your file uses from the Separator dropdown.').first()).toBeVisible()

  await separator.click()
  await page.getByRole('option', { name: 'Semicolon', exact: true }).click()
  await expect(separator).toContainText('Semicolon')

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  await expect(page.getByRole('dialog').getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(2)
})
