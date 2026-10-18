import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

import { asUser, countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { commitImport, logInViaApi, openPage, showImportSetup, typeDate } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: how files are checked against the first one and imported together is the
// same at every size, and the layout of the lists is covered by the skipped-table specs

const HEADER = 'Date,Amount,Category,Merchant'

/**
 * Builds a monthly export of the given days, each a groceries purchase
 */
function monthlyFile(name: string, days: string[], header = HEADER) {
  const rows = days.map((day) => `${day},-10.00,Groceries,Market`)
  return { name, mimeType: 'text/csv', buffer: Buffer.from([header, ...rows].join('\n')) }
}

const MARCH = monthlyFile('2024-03.csv', ['2024-03-05', '2024-03-20'])
const APRIL = monthlyFile('2024-04.csv', ['2024-04-05', '2024-04-20'])
const MAY = monthlyFile('2024-05.csv', ['2024-05-05', '2024-05-20'])

/**
 * Opens the CSV import of a new user's account, ready for files
 */
async function openImport(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  return { user, account, upload }
}

// The files are one import, so one preview shows them all, one commit saves them all, and undoing it
// removes every file's transactions together
test('imports several files as one import and undoes them together', async ({ page, request }) => {
  const { user, account, upload } = await openImport(page, request)
  await upload.setInputFiles([MARCH, APRIL, MAY])

  for (const name of ['2024-03.csv', '2024-04.csv', '2024-05.csv']) {
    await expect(page.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible()
  }
  expect((await commitImport(page)).status()).toBe(201)
  await expect(page.getByRole('dialog').getByText('6 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(6)

  await openPage(page, `/settings/imports?account=${account.id}`)
  const lastImport = page.getByRole('region', { name: 'Last import' })
  await expect(lastImport).toContainText('6 transactions')
  await page.getByRole('button', { name: 'Undo import of 2024-03.csv, 2024-04.csv, 2024-05.csv', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Undo this import?' })
  const undone = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/undo$/.test(response.url()))
  await dialog.getByRole('button', { name: 'Undo import', exact: true }).click()
  expect((await undone).status()).toBe(200)
  await expect(lastImport).toBeHidden()
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

// The first file sets the layout, a file with other columns is turned away by name, and the files
// already staged stay. Removing every file lets a different layout in
test('turns away a file with other columns by name and clears the layout once every file is removed', async ({ page, request }) => {
  const { upload } = await openImport(page, request)
  const odd = monthlyFile('2024-04.csv', ['2024-04-05'], `${HEADER},Balance`)
  await upload.setInputFiles([MARCH, odd, MAY])

  await expect(page.getByText('"2024-04.csv" was not added. Its columns don\'t match the first file.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-03.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-05.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-04.csv', exact: true })).toHaveCount(0)

  await page.getByRole('button', { name: 'Remove 2024-03.csv', exact: true }).click()
  await page.getByRole('button', { name: 'Remove 2024-05.csv', exact: true }).click()
  await upload.setInputFiles([odd])
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove 2024-04.csv', exact: true })).toBeVisible()
})

// Row numbers restart in each file, so a skipped row is told apart by the file it is in
test('names the file beside a skipped row', async ({ page, request }) => {
  const { upload } = await openImport(page, request)
  const unreadable = { ...APRIL, buffer: Buffer.from([HEADER, '2024-04-05,-10.00,Groceries,Market', '2024-02-31,-10.00,Groceries,Market'].join('\n')) }
  await upload.setInputFiles([MARCH, unreadable])

  await expect(page.getByText('1 row will not be imported', { exact: true })).toBeVisible()
  const skipped = page.getByRole('table').filter({ has: page.getByRole('columnheader', { name: 'Row', exact: true }) })
  const lead = skipped.getByRole('cell').filter({ hasText: '2024-04.csv' })
  await expect(lead.locator('span').nth(0)).toHaveText('2')
  await expect(lead.locator('span').nth(1)).toHaveText('2024-04.csv')
})

// Each pick is checked against the files staged by the picks before it, so a file added later is
// held to the first file's layout and a file picked twice is turned away
test('checks a later pick against the files already staged', async ({ page, request }, testInfo) => {
  const { upload } = await openImport(page, request)
  // Written to disk so a second pick reads the same modified time, as a file chosen twice does
  const picked = (file: ReturnType<typeof monthlyFile>) => {
    const path = testInfo.outputPath(file.name)
    writeFileSync(path, file.buffer)
    return path
  }
  const march = picked(MARCH)
  await upload.setInputFiles(march)
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove 2024-03.csv', exact: true })).toBeVisible()

  await upload.setInputFiles(picked(monthlyFile('2024-04.csv', ['2024-04-05'], `${HEADER},Balance`)))
  await expect(page.getByText('"2024-04.csv" was not added. Its columns don\'t match the first file.', { exact: true })).toBeVisible()

  await upload.setInputFiles(march)
  await expect(page.getByText('"2024-03.csv" was not added. It is already added.', { exact: true })).toBeVisible()

  await expect(page.getByRole('button', { name: 'Remove 2024-03.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-04.csv', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Remove / })).toHaveCount(1)
})

// Removing the file a keyboard user is on must not drop them onto the page, so focus moves as the row
// starts leaving rather than after it has collapsed
test('keeps keyboard focus in the list as files are removed', async ({ page, request }) => {
  const { upload } = await openImport(page, request)
  await upload.setInputFiles([MARCH, APRIL, MAY])
  await showImportSetup(page)
  const remove = (name: string) => page.getByRole('button', { name: `Remove ${name}`, exact: true })

  await remove('2024-05.csv').focus()
  await page.keyboard.press('Enter')
  await expect(remove('2024-04.csv')).toBeFocused()

  await remove('2024-03.csv').focus()
  await page.keyboard.press('Enter')
  await expect(remove('2024-04.csv')).toBeFocused()
  await expect(remove('2024-03.csv')).toHaveCount(0)
  // Still there once the removed row has finished collapsing
  await page.waitForTimeout(500)
  await expect(remove('2024-04.csv')).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Upload CSV files', exact: false })).toBeFocused()
})

// The reading choices are one setting for every file, so changing one reads each file again
test('reads every staged file again when Skip last rows changes', async ({ page, request }) => {
  const { upload } = await openImport(page, request)
  await upload.setInputFiles([MARCH, APRIL])
  await expect(page.getByText('2 rows · 4 columns', { exact: true })).toHaveCount(2)

  await showImportSetup(page)
  const skipLastRows = page.getByLabel('Skip last rows', { exact: true })
  await skipLastRows.fill('1')
  await skipLastRows.press('Enter')

  await expect(page.getByText('1 row · 4 columns', { exact: true })).toHaveCount(2)
})

// Removing one file leaves the import as it was, whichever file it is, and removing the last starts
// the next upload afresh
test('keeps the mapping and answers when one file is removed and resets them when all are', async ({ page, request }) => {
  const { upload } = await openImport(page, request)
  const treats = (name: string, day: string) => ({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from([HEADER, `${day},-10.00,Treats,Market`, `${day},-5.00,Treats,Market`].join('\n')),
  })
  await upload.setInputFiles([treats('2024-03.csv', '2024-03-05'), treats('2024-04.csv', '2024-04-05')])
  const category = page.getByRole('combobox', { name: 'Existing category Treats', exact: true })
  await category.click()
  await page.getByRole('option', { name: 'Create new category', exact: true }).click()
  await expect(category).toContainText('Create new category')
  const dateField = page.getByRole('combobox', { name: 'Match to app field Date', exact: true })
  await dateField.click()
  await page.getByRole('option', { name: 'Do not import', exact: true }).click()

  // The first file is the one the answers were first given under
  await showImportSetup(page)
  await page.getByRole('button', { name: 'Remove 2024-03.csv', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove 2024-04.csv', exact: true })).toBeVisible()
  await expect(category).toContainText('Create new category')
  await expect(dateField).toContainText('Do not import')

  // The remaining file is read again from the browser file handed over to its new place
  await expect(page.getByText('2 rows · 4 columns', { exact: true })).toHaveCount(1)
  const skipLastRows = page.getByLabel('Skip last rows', { exact: true })
  await skipLastRows.fill('1')
  await skipLastRows.press('Enter')
  await expect(page.getByText('1 row · 4 columns', { exact: true })).toHaveCount(1)

  await page.getByRole('button', { name: 'Remove 2024-04.csv', exact: true }).click()
  await upload.setInputFiles([treats('2024-05.csv', '2024-05-05')])
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove 2024-05.csv', exact: true })).toBeVisible()
  await expect(dateField).toContainText('Date')
  await expect(category).not.toContainText('Create new category')
})

// The dates chosen apply to the rows of every file together
test('applies a chosen date range across the files', async ({ page, request }) => {
  const { user, account, upload } = await openImport(page, request)
  await upload.setInputFiles([MARCH, APRIL, MAY])

  await showImportSetup(page)
  await typeDate(page, 'Start date', '2024-03-10')
  await typeDate(page, 'End date', '2024-04-10')

  expect((await commitImport(page)).status()).toBe(201)
  const stored = await request.get(`${API_BASE_URL}/transactions?account_id=${account.id}`, { headers: asUser(user) })
  const dates = (await stored.json() as { dt: string }[]).map((row) => row.dt.slice(0, 10)).sort()
  expect(dates).toEqual(['2024-03-20', '2024-04-05'])
})

// The settings saved by an earlier import are found from the first of the files, and the other files
// are read with them. Every day is 12 or under, so detection can't choose the date format and the
// one showing is the one saved
test('opens several files at once with the settings saved by an earlier import', async ({ page, request }) => {
  const { account, upload } = await openImport(page, request)
  const ambiguous = (name: string, day: string) => ({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from([HEADER, `${day}/04/2026,-10.00,Groceries,Market`, `${day}/05/2026,-5.00,Groceries,Market`].join('\n')),
  })
  await upload.setInputFiles(ambiguous('earlier.csv', '05'))
  const dateFormat = page.getByRole('combobox', { name: 'Date format', exact: true })
  await expect(dateFormat).toHaveText('Choose the date format')
  await dateFormat.click()
  await page.getByRole('option', { name: /^Day first \(30\/04\/2026\)/ }).click()
  expect((await commitImport(page)).status()).toBe(201)
  await expect(page.getByRole('dialog').getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()

  await openPage(page, `/settings/imports?account=${account.id}`)
  const next = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(next).toBeEnabled()
  await next.setInputFiles([ambiguous('march.csv', '06'), ambiguous('april.csv', '07')])

  await expect(page.getByRole('button', { name: 'Remove march.csv', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove april.csv', exact: true })).toBeVisible()
  await expect(dateFormat).toHaveText('Day first (30/04/2026)')
})
