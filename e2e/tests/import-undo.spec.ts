import { expect, test } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { commitImport, logInViaApi, openPage, showImportSetup } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what undoing an import removes is the same at every size

test('undoes the last import, deleting everything it added and keeping the account it went into', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const csv = [
    'Date,Amount,Category,Merchant,Notes',
    '2024-03-15,-12.50,Groceries,Unknown,Undo test out',
    '2024-03-16,40.00,Salary,Unknown,Undo test in',
  ].join('\n')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'undo-test.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  expect((await commitImport(page)).status()).toBe(201)

  // Opened afresh, as a user coming back to undo a test import would
  await openPage(page, `/settings/imports?account=${account.id}`)
  const lastImport = page.getByRole('region', { name: 'Last import' })
  await expect(lastImport).toContainText(/CSV\s·\s.+\s·\s2\stransactions/)
  await expect(lastImport).toContainText('Can be undone until')
  await page.getByRole('button', { name: 'Undo import of undo-test.csv' }).click()

  const dialog = page.getByRole('dialog', { name: 'Undo this import?' })
  await expect(dialog).toContainText('This deletes everything undo-test.csv added: 2 transactions')
  const undone = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/undo$/.test(response.url()))
  await dialog.getByRole('button', { name: 'Undo import', exact: true }).click()
  expect((await undone).status()).toBe(200)
  await expect(dialog).toBeHidden()
  await expect(lastImport).toBeHidden()

  // Nothing is staged on a page opened afresh, so the importer starts empty and the pop-up says to upload again
  await expect(page.getByRole('status').filter({ hasText: 'Import undone. Upload the files again to import them.' })).toBeVisible()
  await expect(page.getByText('No files staged', { exact: true })).toBeVisible()

  // The account existed before the import, so it stays with only its starting balance
  const transactions = await request.get(`${API_BASE_URL}/transactions`, {
    headers: asUser(user),
    params: { account_id: account.id },
  })
  expect((await transactions.json() as unknown[]).length).toBe(1)
  const kept = await request.get(`${API_BASE_URL}/accounts/${account.id}`, { headers: asUser(user) })
  expect(kept.status()).toBe(200)
  expect((await kept.json() as { current_balance: number }).current_balance).toBe(10000)
})

// The row dated February 31 is skipped, which keeps the finished import on screen to be read
const ON_SCREEN_CSV = [
  'Date,Amount,Merchant',
  '2024-03-15,-12.50,Market',
  '2024-02-31,-9.99,Market',
  '2024-03-16,-4.00,Market',
].join('\n')

test('gives the importer back with its files and answers when the import it ran is undone', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'undo-back.csv', mimeType: 'text/csv', buffer: Buffer.from(ON_SCREEN_CSV) })

  // An answer given by hand, which has to come back as it was
  const merchantField = page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })
  await merchantField.click()
  await page.getByRole('option', { name: 'Do not import', exact: true }).click()
  await expect(merchantField).toContainText('Do not import')
  await commitImport(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  await expect(merchantField).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Remove undo-back.csv', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Imported', exact: true })).toBeDisabled()

  await page.getByRole('button', { name: 'Undo import of undo-back.csv' }).click()
  await page.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true }).click()

  // Announced as a status, and the page is as it was before Commit import
  const popUp = page.getByRole('status').filter({
    hasText: 'Import undone. Your files and answers are back, so you can change anything and import again.',
  })
  await expect(popUp).toBeVisible()

  // The undo button went with the import, so focus is kept on the page for a keyboard user
  await expect(page.getByRole('dialog', { name: 'Undo this import?' })).toBeHidden()
  await expect(page.locator(':focus')).toHaveAttribute('tabindex', '-1')
  await expect(merchantField).toBeEnabled()
  await expect(merchantField).toContainText('Do not import')
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove undo-back.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Last import' })).toBeHidden()

  // And it imports again, from the answers on screen
  expect((await commitImport(page)).status()).toBe(201)
})
