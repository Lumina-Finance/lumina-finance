import { expect, test } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

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

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/commit$/.test(response.url()))
  await commit.click()
  expect((await committed).status()).toBe(201)

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
