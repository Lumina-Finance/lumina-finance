import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { countLedgerTransactions, signUpUser } from '../support/api'
import { chooseFromDropdown, commitImport, leaveImportSetup, logInViaApi, openPage, showImportSetup } from '../support/app'

// Runs on desktop only: what a finished import keeps and what a new file starts over is the same at every size

/**
 * Guards the record a finished Firefly III or Actual Budget import leaves, which could be wiped by
 * removing its file and whose account and category answers could still be changed after the import
 * was written. A finished import now behaves like a finished CSV import: its files and answers are
 * read-only, its skipped rows stay on screen, and a new file starts a new import
 */

const readFireflyFixture = (name: string) => readFileSync(new URL(`../fixtures/firefly-export/${name}`, import.meta.url), 'utf8')
const [FIREFLY_HEADER, ...FIREFLY_ROWS] = readFireflyFixture('transactions.csv').split('\n')
const csv = (name: string, rows: string[]) => ({ name, mimeType: 'text/csv', buffer: Buffer.from([FIREFLY_HEADER, ...rows].join('\n')) })

// Three journals the import writes and two it leaves out, whose type no importer reads, with the
// export's budgets and accounts
const FIREFLY_FILES = [
  csv('transactions.csv', [
    FIREFLY_ROWS[1],
    FIREFLY_ROWS[2],
    FIREFLY_ROWS[3],
    FIREFLY_ROWS[1].replace(',Withdrawal,', ',Unreadable,'),
    FIREFLY_ROWS[2].replace(',Deposit,', ',Unreadable,'),
  ]),
  { name: 'budgets.csv', mimeType: 'text/csv', buffer: Buffer.from(readFireflyFixture('budgets.csv')) },
  { name: 'accounts.csv', mimeType: 'text/csv', buffer: Buffer.from(readFireflyFixture('accounts.csv')) },
]
const ACTUAL_EDGES = fileURLToPath(new URL('../fixtures/actual-edges/export.zip', import.meta.url))
const ACTUAL_EDGES_ACCOUNTS = (JSON.parse(readFileSync(new URL('../fixtures/actual-edges/manifest.json', import.meta.url), 'utf8')) as { accounts: { name: string }[] }).accounts
const ACTUAL_YEN = fileURLToPath(new URL('../fixtures/actual-yen/export.zip', import.meta.url))
const YEN_ROW_COUNT = (JSON.parse(readFileSync(new URL('../fixtures/actual-yen/manifest.json', import.meta.url), 'utf8')) as { rows: unknown[] }).rows.length

// A second export of two other journals, so rows written twice or carried over from the first
// import would show in the count
const NEXT_FIREFLY_EXPORT = csv('next-transactions.csv', [FIREFLY_ROWS[4], FIREFLY_ROWS[2]])

const accountAnswers = (page: Page) => page.getByRole('combobox', { name: /^Existing account / })
const categoryAnswers = (page: Page) => page.getByRole('combobox', { name: /^Existing category / })
const removeButtons = (page: Page) => page.getByRole('button', { name: /^Remove / })

/** Reads what each of the dropdowns shows, in order */
async function readAnswers(dropdowns: Locator) {
  await expect(dropdowns.first()).toBeVisible()
  return dropdowns.evaluateAll((elements) => elements.map((element) => element.textContent?.trim() ?? ''))
}

/** Expects every one of the dropdowns to be locked, of which there must be some */
async function expectAllLocked(dropdowns: Locator) {
  const all = await dropdowns.all()
  expect(all.length).toBeGreaterThan(0)
  for (const dropdown of all) await expect(dropdown).toBeDisabled()
}

/** Finishes the staged import and keeps the page, which the overlay gives back through reviewing what it left out */
async function finishImport(page: Page) {
  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  await expect(overlay).toBeHidden()
  return await response.json() as { transactions_created: number }
}

async function openFirefly(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', /^Firefly III/)
  const uploads = page.locator('input[type="file"][accept=".csv,text/csv"]')
  for (const [index, file] of FIREFLY_FILES.entries()) {
    await expect(uploads.nth(index)).toBeEnabled()
    await uploads.nth(index).setInputFiles(file)
    // The setup panel collapses once the last file lands, so it is slid out to see that file
    if (index === FIREFLY_FILES.length - 1) await showImportSetup(page)
    await expect(page.getByText(file.name, { exact: true })).toBeVisible()
  }
  await leaveImportSetup(page)
  return { user, uploads }
}

async function openActual(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'Actual Budget')
  const upload = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(upload).toBeEnabled()
  return { user, upload }
}

test('keeps a finished Firefly III import as its record until another export is uploaded', async ({ page, request }) => {
  const { user, uploads } = await openFirefly(page, request)
  const accountsBefore = await readAnswers(accountAnswers(page))
  const categoriesBefore = await readAnswers(categoryAnswers(page))
  const first = await finishImport(page)

  // A saved import brings the setup panel back. Its files can't be removed, and the answers show
  // what the import used, accounts and categories it created included, rather than the ones it made
  await expect(page.getByTitle('transactions.csv', { exact: true })).toBeVisible()
  await expect(removeButtons(page)).toHaveCount(0)
  await expectAllLocked(accountAnswers(page))
  await expectAllLocked(categoryAnswers(page))
  expect(await readAnswers(accountAnswers(page))).toEqual(accountsBefore)
  expect(await readAnswers(categoryAnswers(page))).toEqual(categoriesBefore)
  const skippedTitle = page.getByText('2 rows were not imported', { exact: true })
  await expect(skippedTitle).toBeVisible()

  // A file the import can't read leaves the record as it was, with the refusal on its slot
  await expect(uploads.first()).toBeEnabled()
  await uploads.first().setInputFiles({ name: 'not-firefly.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2') })
  await expect(page.getByText(/This is not a Firefly III transactions export\. It is missing the columns/)).toBeVisible()
  await expect(page.getByTitle('transactions.csv', { exact: true })).toBeVisible()
  await expect(removeButtons(page)).toHaveCount(0)
  await expect(skippedTitle).toBeVisible()
  await expectAllLocked(accountAnswers(page))
  expect(await readAnswers(accountAnswers(page))).toEqual(accountsBefore)
  expect(await readAnswers(categoryAnswers(page))).toEqual(categoriesBefore)

  // A second export starts a new import of its own rows alone, with its answers guessed afresh
  await uploads.first().setInputFiles(NEXT_FIREFLY_EXPORT)
  await expect(page.getByRole('button', { name: 'Remove next-transactions.csv', exact: true })).toBeVisible()
  await expect(page.getByTitle('budgets.csv', { exact: true })).toHaveCount(0)
  await expect(removeButtons(page)).toHaveCount(1)
  await expect(skippedTitle).toHaveCount(0)
  await expect(accountAnswers(page).first()).toBeEnabled()
  expect(await readAnswers(accountAnswers(page))).not.toEqual(accountsBefore)

  const second = await commitImport(page)
  expect(second.status()).toBe(201)
  const { transactions_created: secondCreated } = await second.json() as { transactions_created: number }
  expect(secondCreated).toBeGreaterThan(0)
  expect(secondCreated).toBeLessThan(first.transactions_created)
  expect(await countLedgerTransactions(request, user)).toBe(first.transactions_created + secondCreated)
})

test('locks every answer of a finished Actual Budget import and starts over for a new export', async ({ page, request }) => {
  const { upload } = await openActual(page, request)
  await upload.setInputFiles(ACTUAL_EDGES)

  // The export has Actual's currency feature off, so each new account needs one
  for (const account of ACTUAL_EDGES_ACCOUNTS) {
    await chooseFromDropdown(page.locator('body'), `Currency ${account.name}`, /^CAD$/)
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }

  const paymentMode = page.getByRole('radiogroup', { name: 'Import Car (transfers in Actual) as' })
  await paymentMode.getByRole('radio', { name: 'Expense' }).click()
  const accountsBefore = await readAnswers(accountAnswers(page))
  const categoriesBefore = await readAnswers(categoryAnswers(page))
  await finishImport(page)

  await expect(page.getByTitle('export.zip', { exact: true })).toBeVisible()
  await expect(removeButtons(page)).toHaveCount(0)
  await expectAllLocked(accountAnswers(page))
  await expectAllLocked(categoryAnswers(page))
  for (const radio of await paymentMode.getByRole('radio').all()) await expect(radio).toBeDisabled()
  await expect(paymentMode.getByRole('radio', { name: 'Expense' })).toHaveAttribute('aria-checked', 'true')
  expect(await readAnswers(accountAnswers(page))).toEqual(accountsBefore)
  expect(await readAnswers(categoryAnswers(page))).toEqual(categoriesBefore)

  // A new export starts a new import with its answers guessed afresh, so the payments are transfers
  // again and every answer can be changed
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(ACTUAL_EDGES)
  await showImportSetup(page)
  await expect(removeButtons(page)).toHaveCount(1)
  await expect(accountAnswers(page).first()).toBeEnabled()
  await expect(paymentMode.getByRole('radio', { name: 'Transfer' })).toHaveAttribute('aria-checked', 'true')
  await expect(paymentMode.getByRole('radio', { name: 'Transfer' })).toBeEnabled()
})

test('writes only the rows of a second Actual Budget export imported after the first', async ({ page, request }) => {
  const { user, upload } = await openActual(page, request)
  await upload.setInputFiles(ACTUAL_EDGES)

  // In yen, the currency the second export is in, so its accounts match the ones the first made
  for (const account of ACTUAL_EDGES_ACCOUNTS) {
    await chooseFromDropdown(page.locator('body'), `Currency ${account.name}`, /^JPY$/)
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }
  await finishImport(page)
  const ledgerAfterFirst = await countLedgerTransactions(request, user)

  await expect(upload).toBeEnabled()
  await upload.setInputFiles(ACTUAL_YEN)
  const second = await commitImport(page)
  expect(second.status()).toBe(201)
  expect((await second.json() as { transactions_created: number }).transactions_created).toBe(YEN_ROW_COUNT)
  expect(await countLedgerTransactions(request, user)).toBe(ledgerAfterFirst + YEN_ROW_COUNT)
})

test('starts over when the file of an Actual Budget import that has not run is removed', async ({ page, request }) => {
  const { upload } = await openActual(page, request)
  await upload.setInputFiles(ACTUAL_EDGES)
  await expect(accountAnswers(page).first()).toBeEnabled()

  await showImportSetup(page)
  await removeButtons(page).click()
  await expect(accountAnswers(page)).toHaveCount(0)
  await expect(upload).toBeEnabled()

  await upload.setInputFiles(ACTUAL_YEN)
  await showImportSetup(page)
  await expect(removeButtons(page)).toHaveCount(1)
  await expect(accountAnswers(page).first()).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()
})
