import { expect, test } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Account details above the table and a summary below it, wider than the table, as bank exports have
const CSV = [
  'Account: 12-3456-7890, Everyday',
  'Date;Description;Amount',
  '2026-03-15;Kiosk;-12.00',
  '2026-03-16;Market;-4.50',
  'Latest transactions;2;CAD;-16.50;closing',
  'Printed;2026-03-17;page;1;of 1',
].join('\n')

// The header is found below the account details, the summary is refused until the user skips it,
// a header row chosen afterwards keeps the skip, and the skipped lines are left out of what is imported
test('imports a CSV file once the lines around its table are skipped', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  await expect(page.getByLabel('Header row', { exact: true })).toHaveValue('2')
  await expect(page.getByText(/set Skip last rows to 2/).first()).toBeVisible()

  const skipLastRows = page.getByLabel('Skip last rows', { exact: true })
  await expect(skipLastRows).toHaveAttribute('aria-invalid', 'true')
  await skipLastRows.fill('2')
  await skipLastRows.press('Enter')

  const preview = page.getByRole('list', { name: 'First and last lines of the file' })
  await expect(preview.getByRole('listitem').filter({ hasText: 'Skipped' })).toHaveCount(3)
  await expect(skipLastRows).toBeFocused()

  const headerRow = page.getByLabel('Header row', { exact: true })
  for (const [row, skippedCount] of [['1', 2], ['2', 3]] as const) {
    await headerRow.fill(row)
    await headerRow.press('Enter')
    await expect(preview.getByRole('listitem').filter({ hasText: 'Skipped' })).toHaveCount(skippedCount)
    await expect(skipLastRows).toHaveValue('2')
  }

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  await expect(page.getByRole('dialog').getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(2)
})
