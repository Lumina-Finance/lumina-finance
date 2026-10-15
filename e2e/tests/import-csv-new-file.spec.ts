import { expect, test, type Page, type Request, type Response } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage } from '../support/app'

// Runs on desktop only: what the import keeps between files is the same at every size

/**
 * Guards the CSV import's record of a finished import, whose answers could be changed and whose file
 * could be removed, and the fresh start a file uploaded after it makes. A column the user had answered
 * for came back as Do not import on the next file with the same heading
 */

// The second row names a day February doesn't have, so the import leaves it out
const FIRST_FILE = [
  'Date,Amount,Merchant',
  '2024-03-15,-42.50,Market',
  '2024-02-31,-9.99,Market',
  '2024-03-17,-18.25,Market',
].join('\n')

const SECOND_FILE = [
  'Date,Amount,Merchant',
  '2024-04-02,-12.00,Bakery',
  '2024-04-03,-7.50,Bakery',
].join('\n')

async function openCsvImport(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  const stage = (name: string, csv: string) => upload.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) })
  return { user, stage }
}

test('keeps a finished import as its record until another file is uploaded', async ({ page, request }) => {
  const { user, stage } = await openCsvImport(page, request)
  await stage('first.csv', FIRST_FILE)

  // Answered by hand, so the next file guesses it again only if it starts afresh
  const merchantField = page.getByRole('combobox', { name: 'Match To App Field Merchant', exact: true })
  await expect(merchantField).toContainText('Merchant')
  await merchantField.click()
  await page.getByRole('option', { name: 'Do not import', exact: true }).click()
  await expect(merchantField).toContainText('Do not import')
  await commitImport(page)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  const skippedTitle = page.getByText('1 row was not imported', { exact: true })
  await expect(skippedTitle).toBeVisible()

  await expect(page.getByRole('button', { name: 'Remove first.csv', exact: true })).toHaveCount(0)
  await expect(merchantField).toBeDisabled()
  await expect(merchantField).toContainText('Do not import')
  await expect(page.getByLabel('Header row', { exact: true })).toBeDisabled()
  await expect(skippedTitle).toBeVisible()

  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Upload CSV file/ }).click()
  await (await chooser).setFiles({ name: 'second.csv', mimeType: 'text/csv', buffer: Buffer.from(SECOND_FILE) })
  await expect(page.getByText('second.csv', { exact: true })).toBeVisible()
  await expect(skippedTitle).toBeHidden()
  await expect(page.getByText(/12\.00/).first()).toBeVisible()
  await expect(page.getByText(/42\.50/)).toHaveCount(0)
  await expect(merchantField).toBeEnabled()
  await expect(merchantField).toContainText('Merchant')
  await commitImport(page)
  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await expect(overlay.getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  // The first file's two rows, then only the second file's two
  expect(await countLedgerTransactions(request, user)).toBe(4)
})

// The skipped row in each is what keeps the record on screen once the import is done. Gifts! is
// created by hand while Gifts is left to the page, which files it under Gifts & Donations until the
// import makes a category it matches more closely
const CREATING_FILE = [
  'Date,Amount,Merchant,Category',
  '2024-03-15,-42.50,Market,Treats',
  '2024-02-31,-9.99,Market,Treats',
  '2024-03-17,-18.25,Market,Gifts!',
  '2024-03-18,-30.00,Market,Gifts',
].join('\n')

const ACCOUNT_FILE = [
  'Date,Amount,Account',
  '2024-03-15,-42.50,Holiday fund',
  '2024-02-31,-9.99,Holiday fund',
  '2024-03-17,-18.25,Holiday fund',
].join('\n')

const isPath = (response: Response, method: string, path: string) =>
  response.request().method() === method && new URL(response.url()).pathname.endsWith(path)

const CATEGORIES_RELOAD = (response: Response) => isPath(response, 'GET', '/categories')
const MERCHANT_MATCHES_RELOAD = (response: Response) => isPath(response, 'POST', '/merchants/name-matches')
const ACCOUNTS_RELOAD = (response: Response) => isPath(response, 'GET', '/accounts')

/**
 * Finishes an import of the staged file and opens its record through the skipped row, returning
 * once the lists named have been asked for again and what they say is on screen
 *
 * Only requests sent after the commit count, since the record's answers can only move once the
 * lists they were made against come back holding what the import created
 */
async function commitToRecord(page: Page, reloads: Array<(response: Response) => boolean>) {
  let committed = false
  const sentAfterCommit = new Set<Request>()
  page.on('request', (sent) => {
    if (committed) sentAfterCommit.add(sent)
    else if (sent.method() === 'POST' && new URL(sent.url()).pathname.endsWith('/commit')) committed = true
  })
  const reloaded = Promise.all(reloads.map((isReload) => page.waitForResponse(
    (response) => sentAfterCommit.has(response.request()) && isReload(response),
  )))

  await commitImport(page)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  await reloaded
  // Two frames, so React has drawn what the reloaded lists answer before anything is read
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
}

test('keeps the merchants and categories a finished import created as created on its record', async ({ page, request }) => {
  const { stage } = await openCsvImport(page, request)
  await stage('first.csv', CREATING_FILE)
  const merchant = page.getByRole('combobox', { name: 'Merchant Market', exact: true })
  await expect(merchant).toContainText('Create new merchant')
  const category = page.getByRole('combobox', { name: 'Existing Category Treats', exact: true })
  const guessed = page.getByRole('combobox', { name: 'Existing Category Gifts', exact: true })
  await expect(guessed).toContainText('Gifts & Donations')
  for (const source of [category, page.getByRole('combobox', { name: 'Existing Category Gifts!', exact: true })]) {
    await source.click()
    await page.getByRole('option', { name: 'Create new category', exact: true }).click()
    await expect(source).toContainText('Create new category')
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  await commitToRecord(page, [CATEGORIES_RELOAD, MERCHANT_MATCHES_RELOAD])

  // The import created each of these, which the file's names match once they are asked about again
  await expect(merchant).toBeDisabled()
  await expect(merchant).toContainText('Create new merchant')
  const name = page.getByLabel('Name for the merchant created from Market', { exact: true })
  await expect(name).toBeDisabled()
  await expect(name).toHaveValue('Market')
  await expect(name).toHaveCSS('opacity', '1')
  await expect(category).toBeDisabled()
  await expect(category).toContainText('Create new category')
  await expect(page.getByRole('radio', { name: 'Expense', checked: true }).first()).toBeVisible()
  await expect(guessed).toContainText('Gifts & Donations')
})

// Apart from the test above, since a page opened for one account files every row there and offers
// no account column to map
test('keeps an account a finished import created as created on its record', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'first.csv', mimeType: 'text/csv', buffer: Buffer.from(ACCOUNT_FILE) })
  const account = page.getByRole('combobox', { name: 'Existing Account Holiday fund', exact: true })
  await expect(account).toContainText('Create New Account')
  const body = page.locator('body')
  await chooseFromDropdown(body, 'Type Holiday fund', /^Savings$/)
  await chooseFromDropdown(body, 'Currency Holiday fund', /^CAD/)
  await commitToRecord(page, [ACCOUNTS_RELOAD])

  const type = page.getByRole('combobox', { name: 'Type Holiday fund', exact: true })
  const currency = page.getByRole('combobox', { name: 'Currency Holiday fund', exact: true })
  await expect(account).toBeDisabled()
  await expect(account).toContainText('Create New Account')
  await expect(type).toBeDisabled()
  await expect(type).toContainText('Savings')
  await expect(currency).toBeDisabled()
  await expect(currency).toContainText('CAD')
})

test('guesses a new file\'s columns afresh after the user answered for the removed one', async ({ page, request }) => {
  const { stage } = await openCsvImport(page, request)
  await stage('first.csv', SECOND_FILE)
  const dateField = page.getByRole('combobox', { name: 'Match To App Field Date', exact: true })
  await expect(dateField).toContainText('Date')
  await dateField.click()
  await page.getByRole('option', { name: 'Do not import', exact: true }).click()
  await expect(dateField).toContainText('Do not import')
  await page.getByRole('button', { name: 'Remove first.csv', exact: true }).click()

  await stage('second.csv', SECOND_FILE)
  await expect(dateField).toContainText('Date')
  await expect(page.getByRole('combobox', { name: 'Match To App Field Amount', exact: true })).toContainText('Amount')
})
