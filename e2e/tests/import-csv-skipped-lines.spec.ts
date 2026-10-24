import { expect, test } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { commitImport, logInViaApi, openPage } from '../support/app'

// Runs on desktop only: how the file is read is the same at every size

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

  await commitImport(page)

  await expect(page.getByRole('dialog').getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(2)
})

// Reading every staged file again with a new header row gives a file other headings than the first, and
// it stays staged with the reason in the import's errors
test('keeps a staged file whose columns no longer match after the header row changes, with its error', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const statement = (month: string) => ({
    name: `${month}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(['Date,Amount,Notes', `2026-${month}-15,-1.00,First`, `2026-${month}-16,-2.00,Second`].join('\n')),
  })
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles([statement('03'), statement('04')])
  await expect(page.getByRole('button', { name: 'Remove 04.csv', exact: true })).toBeVisible()

  const headerRow = page.getByLabel('Header row', { exact: true })
  await headerRow.fill('2')
  await headerRow.press('Enter')

  await expect(page.getByText('"04.csv" can\'t be imported. Its columns don\'t match the first file.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 04.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 03.csv', exact: true })).toBeVisible()
})

// A Total line closing the first file is left out of that file only: the file staged with it, which
// has no such line, keeps every transaction
test('leaves out a closing Total line only from the file that has one', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const statement = (name: string, days: [string, string], closing: string[]) => ({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(['Date;Description;Amount', `2026-03-${days[0]};Kiosk;-12.00`, `2026-03-${days[1]};Market;-4.50`, ...closing].join('\n')),
  })
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles([statement('first.csv', ['15', '16'], ['Total;;-16.50']), statement('second.csv', ['17', '18'], [])])
  await expect(page.getByRole('button', { name: 'Remove second.csv', exact: true })).toBeVisible()

  await commitImport(page)

  await expect(page.getByRole('dialog').getByText('4 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(4)
})
