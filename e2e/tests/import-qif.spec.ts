import { expect, test, type Page } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage, showImportSetup } from '../support/app'

// Runs on desktop only: what the import writes is the same at every size

const QIF = [
  '!Account',
  'NHousehold',
  'TBank',
  '^',
  '!Type:Bank',
  'D1/2/2024',
  'T-1,234.50',
  'PLandlord',
  '^',
  'D3/4/2024',
  'T2,000.00',
  'PPayroll',
  '^',
  'D3/5/2024',
  'T-100.00',
  'U-110.00',
  'PDisagrees',
  '^',
].join('\n')

async function uploadQif(page: Page, user: TestUser, contents: string, name = 'household.qif') {
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'QIF')
  await expect(page.getByText('What to expect', { exact: true })).toBeVisible()

  const upload = page.locator('input[type="file"][accept=".qif"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(contents) })
}

test('waits for the person to choose how dates are written, then imports the exact amounts and lists the rest', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await uploadQif(page, user, QIF)

  await chooseFromDropdown(page.locator('body'), 'Existing account Household', account.name)

  // Both 1/2/2024 and 3/4/2024 read either way round, so nothing is imported until a choice is made
  await expect(page.getByText('Choose how the dates in the files are written.', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()

  await chooseFromDropdown(page.locator('body'), 'Date format', /Month first/)

  // The transaction whose two amount lines disagree is listed with its reason and not imported
  await expect(page.getByText('Disagrees', { exact: true })).toBeVisible()
  const opened = page.waitForRequest((sent) => sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url()))
  const response = await commitImport(page)

  expect(response.status()).toBe(201)
  expect((await opened).postDataJSON()).toMatchObject({ file_name: 'household.qif', source: 'qif' })
  expect(await countLedgerTransactions(request, user)).toBe(2)
})

test('refuses a file with a section it does not read and stages nothing', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadQif(page, user, '!Type:Mystery\nD1/2/2024\nT1.00\n^\n')

  await expect(page.getByText(/Mystery/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove household.qif', exact: true })).toHaveCount(0)
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

test('says what it leaves out of a file that also holds investments', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadQif(page, user, `${QIF}\n!Type:Invst\nD1/2/2024\nNBuy\nT100.00\n^\n`)

  await expect(page.getByText('Investment', { exact: false }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove household.qif', exact: true })).toBeVisible()
})

const COMMIT_URL = /\/transactions\/import\/runs\/[^/]+\/commit$/
const REFUSAL = 'Withdrawal source is not an imported account'

// The failure belongs to the answers it was about, so the reason has to outlast the renders that
// follow it while those answers stand. A new answers value on every render would drop it
test('keeps the reason the server gives for a refused import beside Commit import', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await page.route(COMMIT_URL, (route) => route.fulfill({ status: 422, json: { detail: REFUSAL } }))
  await uploadQif(page, user, QIF)
  await chooseFromDropdown(page.locator('body'), 'Existing account Household', account.name)
  await chooseFromDropdown(page.locator('body'), 'Date format', /Month first/)

  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText(`${REFUSAL}.`, { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Back to import', exact: true }).click()

  await expect(page.getByRole('alert').filter({ hasText: REFUSAL })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

// 1/25/2024 can only be read month first, while 1,234 is one thousand two hundred and thirty-four
// with commas for thousands and one and two hundred and thirty-four thousandths with a decimal comma
const AMBIGUOUS_AMOUNTS = ['!Account', 'NHousehold', 'TBank', '^', '!Type:Bank', 'D1/25/2024', 'T1,234', '^', 'D1/26/2024', 'T5', '^'].join('\n')

test('blocks the commit while amounts such as 1,234 fit more than one reading, until one is chosen', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await uploadQif(page, user, AMBIGUOUS_AMOUNTS)
  await chooseFromDropdown(page.locator('body'), 'Existing account Household', account.name)

  // 1/25/2024 can only be read month first, so only the amounts are left to choose
  await expect(page.getByText('Choose how the amounts in the files are written.', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Choose how the dates in the files are written.', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()

  await chooseFromDropdown(page.locator('body'), 'Amount format', '1,234.56')

  const response = await commitImport(page)
  expect(response.status()).toBe(201)
})

test('forgets the chosen date format when the file is removed, so the next file asks again', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await uploadQif(page, user, QIF)
  await chooseFromDropdown(page.locator('body'), 'Existing account Household', account.name)
  await chooseFromDropdown(page.locator('body'), 'Date format', /Month first/)
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()

  await showImportSetup(page)
  await page.getByRole('button', { name: 'Remove household.qif', exact: true }).click()
  await page
    .locator('input[type="file"][accept=".qif"]')
    .setInputFiles({ name: 'again.qif', mimeType: 'application/octet-stream', buffer: Buffer.from(QIF) })

  await expect(page.getByRole('combobox', { name: 'Date format', exact: true })).toHaveText('Choose one')
  await expect(page.getByText('Choose how the dates in the files are written.', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()
})

test("refuses a file of two accounts on an account's own import page and stages nothing", async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  await chooseFromDropdown(page.locator('body'), 'Data source', 'Quicken 3.0 (QIF)')

  const twoAccounts = `${QIF}\n!Account\nNSavings\nTBank\n^\n!Type:Bank\nD3/6/2024\nT5.00\n^`
  await page
    .locator('input[type="file"][accept=".qif"]')
    .setInputFiles({ name: 'two.qif', mimeType: 'application/octet-stream', buffer: Buffer.from(twoAccounts) })

  await expect(page.getByText(/This file holds 2 accounts\./).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove two.qif', exact: true })).toHaveCount(0)
  expect(await countLedgerTransactions(request, user)).toBe(0)
})
