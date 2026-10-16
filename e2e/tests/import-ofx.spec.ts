import { expect, test, type Page } from '@playwright/test'

import { asUser, countLedgerTransactions, createAccount, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the import writes is the same at every size

const ACCOUNT_LABEL = 'Checking ending 6789'
const CARD_LABEL = 'Credit card ending 1111'

interface StatementTransaction {
  posted: string
  amount: string
  fitId: string
  name: string
}

// A version 1 file, as banks still write them: a header of plain lines and leaf tags left open
function buildTransactions(transactions: StatementTransaction[]) {
  return transactions.flatMap((transaction) => [
    '<STMTTRN>',
    '<TRNTYPE>DEBIT',
    `<DTPOSTED>${transaction.posted}`,
    `<TRNAMT>${transaction.amount}`,
    `<FITID>${transaction.fitId}`,
    // An empty tag such as a check number has no closing tag and must not swallow the tags after it
    '<CHECKNUM>',
    `<NAME>${transaction.name}`,
    '</STMTTRN>',
  ])
}

function buildBankMessageSet(currency: string, transactions: StatementTransaction[]) {
  return [
    '<BANKMSGSRSV1><STMTTRNRS><STMTRS>',
    `<CURDEF>${currency}`,
    '<BANKACCTFROM><BANKID>123000456<ACCTID>000123456789<ACCTTYPE>CHECKING</BANKACCTFROM>',
    '<BANKTRANLIST>', ...buildTransactions(transactions), '</BANKTRANLIST>',
    '</STMTRS></STMTTRNRS></BANKMSGSRSV1>',
  ]
}

function buildCardMessageSet(currency: string, transactions: StatementTransaction[]) {
  return [
    '<CREDITCARDMSGSRSV1><CCSTMTTRNRS><CCSTMTRS>',
    `<CURDEF>${currency}`,
    '<CCACCTFROM><ACCTID>4111111111111111</CCACCTFROM>',
    '<BANKTRANLIST>', ...buildTransactions(transactions), '</BANKTRANLIST>',
    '</CCSTMTRS></CCSTMTTRNRS></CREDITCARDMSGSRSV1>',
  ]
}

function buildFile(messageSets: string[][]) {
  return [
    'OFXHEADER:100', 'DATA:OFXSGML', 'VERSION:102', 'SECURITY:NONE', 'ENCODING:USASCII', 'CHARSET:1252',
    'COMPRESSION:NONE', 'OLDFILEUID:NONE', 'NEWFILEUID:NONE', '',
    '<OFX>', ...messageSets.flat(), '</OFX>',
  ].join('\r\n')
}

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

const CAFE = { posted: '20240115120000', amount: '-12.50', fitId: 'A1', name: 'Corner Cafe' }
const PAYROLL = { posted: '20240116120000', amount: '2500.00', fitId: 'A2', name: 'Payroll' }

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
