import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { commitImport, leaveImportSetup, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the preview reads and what the import writes are the same at every size

// Two spellings of a merchant the user has, and a merchant they do not
const CSV = [
  'Date,Amount,Merchant',
  '2024-03-15,-42.50,AMAZON',
  '2024-03-16,-12.00,amazon',
  '2024-03-17,-30.00,Brand New Shop',
].join('\n')

async function openPreview(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  const created = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name: 'Amazon' } })
  expect(created.status()).toBe(201)
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'merchants.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  // The merchant the file's AMAZON matches has arrived once its row reads Amazon
  const step = page.locator('section').filter({ has: page.getByText('Merchant matching', { exact: true }) }).last()
  await expect(step.getByRole('combobox', { name: 'Merchant AMAZON', exact: true })).toContainText('Amazon')
  await leaveImportSetup(page)
  const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) }).last()
  return { user, step, preview }
}

async function readMerchantNames(request: Parameters<typeof signUpUser>[0], user: Awaited<ReturnType<typeof signUpUser>>) {
  const merchants = await request.get(`${API_BASE_URL}/merchants`, { headers: asUser(user) })
  const names = (await merchants.json() as { name: string; is_system: boolean }[])
    .filter((merchant) => !merchant.is_system)
    .map((merchant) => merchant.name)
  const transactions = await request.get(`${API_BASE_URL}/transactions`, { headers: asUser(user) })
  const filedUnder = (await transactions.json() as { merchant_name: string }[]).map((transaction) => transaction.merchant_name)
  return { names: names.sort(), filedUnder: filedUnder.sort() }
}

test('previews each row under the merchant it will be filed under, the file\'s spelling matching an existing one', async ({ page, request }) => {
  const { user, preview } = await openPreview(page, request)

  // AMAZON and amazon are the Amazon the user has, and the merchant the file brings keeps its own name
  await expect(preview).toContainText('Brand New Shop')
  await expect(preview).toContainText('Amazon')
  await expect(preview).not.toContainText('AMAZON')
  await expect(preview).not.toContainText('amazon')

  const response = await commitImport(page)
  expect(response.status()).toBe(201)

  // The result is what the preview showed, and no second Amazon was made
  expect(await readMerchantNames(request, user)).toEqual({
    names: ['Amazon', 'Brand New Shop'],
    filedUnder: ['Amazon', 'Amazon', 'Brand New Shop'],
  })
})

test('previews a merchant the user corrected in the merchant step under the name they wrote', async ({ page, request }) => {
  const { user, step, preview } = await openPreview(page, request)

  await step.getByRole('combobox', { name: 'Merchant AMAZON', exact: true }).click()
  await page.getByRole('option', { name: 'Create new merchant', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await step.getByRole('textbox', { name: 'Name for the merchant created from AMAZON' }).fill('Amazon Prime')

  // Both spellings of the file's merchant are the one the user corrected
  await expect(preview).toContainText('Amazon Prime')
  await expect(preview).not.toContainText('AMAZON')
  await expect(preview).not.toContainText('amazon')

  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  expect(await readMerchantNames(request, user)).toEqual({
    names: ['Amazon', 'Amazon Prime', 'Brand New Shop'],
    filedUnder: ['Amazon Prime', 'Amazon Prime', 'Brand New Shop'],
  })
})
