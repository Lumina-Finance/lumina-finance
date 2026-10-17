import { expect, test, type Page } from '@playwright/test'

import { asUser, countLedgerTransactions, createAccount, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage, showImportSetup } from '../support/app'
import { buildBankMessageSet, buildCardMessageSet, buildFile, CAFE, PAYROLL, statementFile } from '../support/ofx'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the import writes is the same at every size

const ACCOUNT_LABEL = 'Checking ending 6789'
const CARD_LABEL = 'Credit card ending 1111'

async function openOfxImport(page: Page, user: TestUser) {
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data Source', 'OFX/QFX')
  await expect(page.getByText('What To Expect', { exact: true })).toBeVisible()
}

async function uploadStatement(page: Page, user: TestUser, contents: string, name = 'statement.ofx') {
  await openOfxImport(page, user)

  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(contents) })
}

test('imports a statement into a new account, leaving out a transaction with no readable amount', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadStatement(page, user, buildFile([buildBankMessageSet('CAD', [
    CAFE,
    PAYROLL,
    { posted: '20240117120000', amount: 'unreadable', fitId: 'A3', name: 'Broken' },
  ])]))

  // The row with no amount is listed with the reason it is left out, and the two after the empty
  // check number tag keep their payees
  await expect(page.getByText('Broken', { exact: true })).toBeVisible()
  await expect(page.getByText('The amount is missing or is not a number.', { exact: true })).toBeVisible()
  await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()

  const opened = page.waitForRequest((sent) => sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url()))
  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  expect((await opened).postDataJSON()).toMatchObject({ file_name: 'statement.ofx', source: 'ofx' })

  expect(await countLedgerTransactions(request, user)).toBe(2)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  const [account] = await accounts.json() as { name: string; current_balance: number }[]
  expect(account).toMatchObject({ name: ACCOUNT_LABEL, current_balance: 248750 })
})

test('imports a bank and a credit card statement of one file in one run', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadStatement(page, user, buildFile([
    buildBankMessageSet('CAD', [CAFE, PAYROLL]),
    buildCardMessageSet('CAD', [{ posted: '20240118120000', amount: '-30.00', fitId: 'C1', name: 'Hardware' }]),
  ]))

  // Each statement is offered a new account of its own, and the preview shows both
  for (const label of [ACCOUNT_LABEL, CARD_LABEL]) {
    await expect(page.getByRole('combobox', { name: `Existing Account ${label}` })).toHaveText('Create New Account')
  }
  await expect(page.getByText('Hardware', { exact: true }).first()).toBeVisible()

  let runs = 0
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url())) runs += 1
  })
  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  expect(runs).toBe(1)

  expect(await countLedgerTransactions(request, user)).toBe(3)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  const names = (await accounts.json() as { name: string }[]).map((account) => account.name).sort()
  expect(names).toEqual([ACCOUNT_LABEL, CARD_LABEL])
})

test('tells the user which investment and loan statements the file holds are not imported', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadStatement(page, user, buildFile([
    buildBankMessageSet('CAD', [CAFE]),
    ['<INVSTMTMSGSRSV1><INVSTMTTRNRS><TRNUID>2001</INVSTMTTRNRS><INVSTMTTRNRS><TRNUID>2002</INVSTMTTRNRS></INVSTMTMSGSRSV1>'],
    ['<LOANMSGSRSV1><LOANTRNRS><TRNUID>3001</LOANTRNRS></LOANMSGSRSV1>'],
  ]))

  await expect(page.getByText('Statements left out', { exact: true })).toBeVisible()
  await expect(page.getByText("2 investment statements and 1 loan statement in this file aren't imported.", { exact: true })).toBeVisible()
})

test('refuses a statement whose currency is not its account\'s and commits nothing', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await uploadStatement(page, user, buildFile([buildBankMessageSet('USD', [CAFE])]))

  await chooseFromDropdown(page.locator('body'), `Existing Account ${ACCOUNT_LABEL}`, account.name)
  await expect(page.getByText('Statements in another currency', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

test.describe('a file that is not an OFX statement', () => {
  test('refuses a CSV file given an .ofx name and stages nothing', async ({ page, request }) => {
    const user = await signUpUser(request)
    await uploadStatement(page, user, 'Date,Amount,Description\n2024-01-15,-12.50,Cafe\n', 'transactions.ofx')

    await expect(page.getByText("This isn't an OFX or QFX statement. Choose an OFX or QFX statement from your bank.", { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove transactions.ofx', exact: true })).toHaveCount(0)
    expect(await countLedgerTransactions(request, user)).toBe(0)
  })

  test('refuses a file of another type by its name', async ({ page, request }) => {
    const user = await signUpUser(request)
    await uploadStatement(page, user, 'Date,Amount,Description\n2024-01-15,-12.50,Cafe\n', 'transactions.csv')

    await expect(page.getByText('Choose an OFX or QFX statement from your bank.', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Remove transactions.csv', exact: true })).toHaveCount(0)
  })
})

async function openStatementUpload(page: Page, user: TestUser) {
  await openOfxImport(page, user)
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  return upload
}

// Monthly statements overlap by a few days, so the bank's ID for the last transaction of January is
// also in February's file
const JANUARY = statementFile('2024-01.qfx', [CAFE, PAYROLL])
const FEBRUARY = statementFile('2024-02.qfx', [PAYROLL, { posted: '20240201120000', amount: '-20.00', fitId: 'B1', name: 'Hardware' }])
const MARCH = statementFile('2024-03.qfx', [{ posted: '20240301120000', amount: '-8.00', fitId: 'C1', name: 'Bakery' }])

test('imports the statements of several files as one import, skipping a transaction an earlier file holds, and undoes them together', async ({ page, request }) => {
  const user = await signUpUser(request)
  const upload = await openStatementUpload(page, user)
  await upload.setInputFiles([JANUARY, FEBRUARY, MARCH])

  // One account answer covers the account that all three files hold, and the repeat is left out
  // with the file that has it
  await expect(page.getByRole('combobox', { name: `Existing Account ${ACCOUNT_LABEL}` })).toHaveCount(1)
  await expect(page.getByText('This transaction is already in 2024-01.qfx.', { exact: true })).toBeVisible()
  await expect(page.getByTitle('2024-02.qfx', { exact: true })).toBeVisible()

  let runs = 0
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url())) runs += 1
  })
  const opened = page.waitForRequest((sent) => sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url()))
  expect((await commitImport(page)).status()).toBe(201)
  expect((await opened).postDataJSON()).toMatchObject({ file_name: '2024-01.qfx, 2024-02.qfx, 2024-03.qfx', source: 'ofx' })
  expect(runs).toBe(1)

  expect(await countLedgerTransactions(request, user)).toBe(4)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  expect((await accounts.json() as { name: string; current_balance: number }[])).toMatchObject([
    { name: ACCOUNT_LABEL, current_balance: 245950 },
  ])

  await openPage(page, '/settings/imports')
  const lastImport = page.getByRole('region', { name: 'Last import' })
  await expect(lastImport).toContainText('4 transactions')
  await page.getByRole('button', { name: 'Undo import of 2024-01.qfx, 2024-02.qfx, 2024-03.qfx', exact: true }).click()
  const undone = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/undo$/.test(response.url()))
  await page.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true }).click()
  expect((await undone).status()).toBe(200)
  await expect(lastImport).toBeHidden()
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

// A file that is not a statement is turned away by name and the files already staged stay
test('turns away a file that is not a statement by name while the other files stay', async ({ page, request }) => {
  const user = await signUpUser(request)
  const upload = await openStatementUpload(page, user)
  const notes = { name: 'notes.qfx', mimeType: 'application/octet-stream', buffer: Buffer.from('Date,Amount,Description\n2024-01-15,-12.50,Cafe\n') }
  await upload.setInputFiles([JANUARY, notes, FEBRUARY])

  await expect(page.getByText('"notes.qfx" was not added. This isn\'t an OFX or QFX statement. Choose an OFX or QFX statement from your bank.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-01.qfx', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-02.qfx', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove notes.qfx', exact: true })).toHaveCount(0)
})

// The answers are for the statements of all the files, so adding a file keeps them and removing
// every file starts over
test('keeps the account answer when another file is added and clears it once every file is removed', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  const upload = await openStatementUpload(page, user)
  await upload.setInputFiles([JANUARY])

  const answer = page.getByRole('combobox', { name: `Existing Account ${ACCOUNT_LABEL}` })
  await chooseFromDropdown(page.locator('body'), `Existing Account ${ACCOUNT_LABEL}`, account.name)
  await expect(answer).toHaveText(account.name)

  await upload.setInputFiles([MARCH])
  // The staged list is in the setup panel, which is collapsed now and slid out while it is hovered
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove 2024-03.qfx', exact: true })).toBeVisible()
  await expect(answer).toHaveText(account.name)

  await page.getByRole('button', { name: 'Remove 2024-01.qfx', exact: true }).click()
  await expect(answer).toHaveText(account.name)
  await page.getByRole('button', { name: 'Remove 2024-03.qfx', exact: true }).click()
  await upload.setInputFiles([JANUARY])
  await expect(answer).toHaveText('Create New Account')
})

// The staged list and the card for more statements sit in the setup panel, which collapses once a
// statement is staged and slides out while it is hovered
test('collapses the setup panel around the staged statements, and adds more through its slid-out card', async ({ page, request }) => {
  const upload = await openStatementUpload(page, await signUpUser(request))
  await upload.setInputFiles([JANUARY, FEBRUARY])
  await expect(page.getByRole('button', { name: 'Expand import setup', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('button', { name: 'Remove 2024-01.qfx', exact: true })).toBeHidden()

  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove 2024-01.qfx', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove 2024-02.qfx', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Add more statements/ })).toBeVisible()

  await upload.setInputFiles([MARCH])
  await expect(page.getByRole('button', { name: 'Remove 2024-03.qfx', exact: true })).toBeVisible()
})
