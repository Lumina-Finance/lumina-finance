import { expect, test, type Page } from '@playwright/test'

import { asUser, countLedgerTransactions, createAccount, findReferenceId, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage, showImportSetup, waitPastMotion } from '../support/app'
import { buildBankMessageSet, buildCardMessageSet, buildFile, buildInvestmentMessageSet, buildLoanMessageSet, CAFE, PAYROLL, statementFile } from '../support/ofx'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the import writes is the same at every size, and the tests of the notice
// of statements left out check the setup panel's collapse, which happens on desktop only

const ACCOUNT_LABEL = 'Checking ending 6789'
const CARD_LABEL = 'Credit card ending 1111'
const LOAN_LABEL = 'Loan ending 6777'

async function openOfxImport(page: Page, user: TestUser) {
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await expect(page.getByText('What to expect', { exact: true })).toBeVisible()
}

async function uploadStatement(page: Page, user: TestUser, contents: string, name = 'statement.ofx') {
  await openOfxImport(page, user)

  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(contents) })
}

// A self-hosted server opened over plain HTTP by its IP address is not a secure context, so the browser
// withholds crypto.subtle and crypto.randomUUID. The server hashes bank IDs, so the import must not need them
test('imports a statement where the browser withholds crypto.subtle and crypto.randomUUID', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'isSecureContext', { get: () => false })
    Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined })
    Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined })
  })
  await openOfxImport(page, user)

  // The script must really take them away, or this proves nothing about a page on plain HTTP
  expect(await page.evaluate(() => [typeof crypto.subtle, typeof crypto.randomUUID])).toEqual(['undefined', 'undefined'])
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await upload.setInputFiles({ name: 'statement.ofx', mimeType: 'application/octet-stream', buffer: Buffer.from(buildFile([buildBankMessageSet('CAD', [CAFE, PAYROLL])])) })
  await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()

  const response = await commitImport(page)

  expect(response.status()).toBe(201)
  expect(await countLedgerTransactions(request, user)).toBe(2)
})

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
    await expect(page.getByRole('combobox', { name: `Existing account ${label}` })).toHaveText('Create new account')
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

/**
 * Leaves the import page as it stands once the staged files are read: the preview is up, focus and
 * the pointer are off the setup panel, and longer than a collapse takes has passed, so a panel that
 * was going to collapse has, and what it shows is what stays. Choosing the data source leaves focus
 * in the panel, which holds it open until focus moves, so without this a check races that
 */
async function settleSetupPanel(page: Page) {
  await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()
  await page.getByRole('heading', { name: 'Import transactions' }).click()
  await waitPastMotion(page)
}

test('tells the user how many investment statements the file holds are not imported', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadStatement(page, user, buildFile([buildBankMessageSet('CAD', [CAFE]), buildInvestmentMessageSet(2)]))

  await settleSetupPanel(page)
  await expect(page.getByRole('button', { name: 'Collapse import setup', exact: true })).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('Statements left out', { exact: true })).toBeVisible()
  await expect(page.getByText("2 investment statements in this file aren't imported: only bank, credit card and loan statements are supported.", { exact: true })).toBeVisible()
})

test('imports a loan statement into a new loan account without a notice', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadStatement(page, user, buildFile([buildLoanMessageSet('CAD', [
    { posted: '20240115120000', amount: '450.00', fitId: 'L1', name: 'Loan payment' },
    { posted: '20240131120000', amount: '-35.00', fitId: 'L2', name: 'Interest' },
  ])]))

  await expect(page.getByRole('combobox', { name: `Existing account ${LOAN_LABEL}` })).toHaveText('Create new account')
  await expect(page.getByText('Loan payment', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Statements left out', { exact: true })).toBeHidden()

  const response = await commitImport(page)
  expect(response.status()).toBe(201)

  expect(await countLedgerTransactions(request, user)).toBe(2)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  const [account] = await accounts.json() as { name: string; account_type: string; current_balance: number }[]
  expect(account).toMatchObject({ name: LOAN_LABEL, account_type: 'loan', current_balance: 41500 })

  // The payment comes in and files under Other Income, the interest goes out under Miscellaneous
  const saved = await request.get(`${API_BASE_URL}/transactions`, { headers: asUser(user) })
  const rows = (await saved.json() as { amount: number; category_id: string }[]).map((row) => [row.amount, row.category_id]).sort()
  expect(rows).toEqual([
    [-3500, await findReferenceId(request, user, 'categories', 'Miscellaneous')],
    [45000, await findReferenceId(request, user, 'categories', 'Other Income')],
  ])
})

// Each file leaves out one statement of its own, so the first file alone would give a different count
const LEAVING_OUT_FILES = [
  { name: 'first-with-investment.ofx', body: [buildBankMessageSet('CAD', [CAFE]), buildInvestmentMessageSet(1)] },
  { name: 'second-with-investment.ofx', body: [buildBankMessageSet('CAD', [PAYROLL]), buildInvestmentMessageSet(1)] },
].map(({ name, body }) => ({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(buildFile(body)) }))

// The setup column scrolls on its own at this size, so a notice at the foot of two staged files
// falls below the fold unless it is placed or scrolled into view
test('keeps the left-out notice of every staged file in view, counting them together until they are removed', async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  const upload = await openStatementUpload(page, await signUpUser(request))
  await upload.setInputFiles(LEAVING_OUT_FILES)

  await settleSetupPanel(page)
  const notice = page.getByText("2 investment statements in these files aren't imported: only bank, credit card and loan statements are supported.", { exact: true })
  await expect(notice).toBeVisible()
  await expect(notice).toBeInViewport({ ratio: 1 })

  await page.getByRole('button', { name: 'Remove first-with-investment.ofx', exact: true }).click()
  await expect(page.getByText("1 investment statement in this file isn't imported: only bank, credit card and loan statements are supported.", { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Remove second-with-investment.ofx', exact: true }).click()
  await expect(page.getByText('Statements left out', { exact: true })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Collapse import setup', exact: true })).toHaveAttribute('aria-expanded', 'true')
})

test('refuses a statement whose currency is not its account\'s and commits nothing', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', currency: 'CAD' })
  await uploadStatement(page, user, buildFile([buildBankMessageSet('USD', [CAFE])]))

  await chooseFromDropdown(page.locator('body'), `Existing account ${ACCOUNT_LABEL}`, account.name)
  await expect(page.getByText('Statements in another currency', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

const COMMIT_URL = /\/transactions\/import\/runs\/[^/]+\/commit$/
const REFUSAL = 'Withdrawal source is not an imported account'

// The failure belongs to the answers it was about, so the reason has to outlast the renders that
// follow it while those answers stand, and the upload they were sent with stays staged. The workflow
// is shared by every statement format, so a new answers value on every render would drop it for all
test('keeps the reason the server gives for a refused import beside Commit import, with the upload kept', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.route(COMMIT_URL, (route) => route.fulfill({ status: 422, json: { detail: REFUSAL } }))
  await uploadStatement(page, user, buildFile([buildBankMessageSet('CAD', [CAFE, PAYROLL])]))
  await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText(`${REFUSAL}.`, { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Back to import', exact: true }).click()

  // Renders the page again, as coming back to the tab does, and the reason must still be there
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const reason = page.getByRole('alert').filter({ hasText: REFUSAL })
  await expect(reason).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeVisible()
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: 'Remove statement.ofx', exact: true })).toBeVisible()
  await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()
  await expect(reason).toBeVisible()
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
  await expect(page.getByRole('combobox', { name: `Existing account ${ACCOUNT_LABEL}` })).toHaveCount(1)
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

  const answer = page.getByRole('combobox', { name: `Existing account ${ACCOUNT_LABEL}` })
  await chooseFromDropdown(page.locator('body'), `Existing account ${ACCOUNT_LABEL}`, account.name)
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
  await expect(answer).toHaveText('Create new account')
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

// A statement imported into an account that already holds some of its transactions: the preview flags
// them as the save will skip them, so the figures before and after saving agree
test('flags a transaction the account already holds in the preview, and the save agrees', async ({ page, request }) => {
  const user = await signUpUser(request)
  const hardware = { posted: '20240201120000', amount: '-20.00', name: 'Hardware' }
  await uploadStatement(page, user, buildFile([buildBankMessageSet('CAD', [PAYROLL, { ...hardware, fitId: 'H1' }])]))
  expect((await commitImport(page)).status()).toBe(201)
  expect(await countLedgerTransactions(request, user)).toBe(2)

  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(statementFile('second.qfx', [PAYROLL, { ...hardware, fitId: 'H2' }]))

  await expect(page.getByRole('combobox', { name: `Existing account ${ACCOUNT_LABEL}` })).toHaveText(ACCOUNT_LABEL)
  const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) })
  await expect(preview.getByRole('paragraph').filter({ hasText: /^(Rows|Will create|New accounts|New categories|\d+)$/ }))
    .toHaveText(['Rows', '2', 'Will create', '1', 'New accounts', '0', 'New categories', '0'])
  await expect(page.getByText(`This transaction is already in ${ACCOUNT_LABEL}.`, { exact: true })).toBeVisible()
  await expect(page.getByText('Payroll', { exact: true }).first()).toBeVisible()

  expect((await commitImport(page)).status()).toBe(201)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('1 transaction imported · 0 accounts created · 0 categories created · 1 skipped', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(3)
})

// Commit is irreversible, so it stays off while the check runs and after it fails, whatever way it is
// pressed, rather than save a transaction the account holds as a new one
test('keeps Commit import off while the held-rows check runs or has failed, until a retry answers', async ({ page, request }) => {
  const user = await signUpUser(request)
  const hardware = { posted: '20240201120000', amount: '-20.00', name: 'Hardware' }
  await uploadStatement(page, user, buildFile([buildBankMessageSet('CAD', [PAYROLL, { ...hardware, fitId: 'H1' }])]))
  expect((await commitImport(page)).status()).toBe(201)

  let runs = 0
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url())) runs += 1
  })
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const heldPath = '**/transactions/import/held-bank-transactions'
  await page.route(heldPath, async (route) => {
    await gate
    await route.fulfill({ status: 500, json: { detail: 'Server error' } })
  })
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await page.locator('input[type="file"][accept*=".ofx"]').setInputFiles(statementFile('second.qfx', [PAYROLL, { ...hardware, fitId: 'H2' }]))

  // Held off, but reachable by the keyboard, and described by the line saying what it waits for
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  // Found by role, since the reason is also shown in a tooltip while the button is pressed or focused
  const running = page.getByRole('status').filter({ hasText: 'Checking which transactions are already in the account…' })
  await expect(running).toBeVisible()
  await expect(commit).toHaveAttribute('aria-disabled', 'true')
  await expect(commit).toHaveAttribute('aria-describedby', (await running.getAttribute('id'))!)
  // Forced, since the click's own wait for an enabled button is what the reason replaces
  await commit.click({ force: true })
  await commit.press('Enter')

  release()
  const failed = page.getByRole('alert').filter({ hasText: "Couldn't check which transactions are already in the account. Please try again." })
  await expect(failed).toBeVisible()
  await expect(commit).toHaveAttribute('aria-disabled', 'true')
  await expect(commit).toHaveAttribute('aria-describedby', (await failed.getAttribute('id'))!)
  await commit.press('Enter')

  await page.unroute(heldPath)
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText(`This transaction is already in ${ACCOUNT_LABEL}.`, { exact: true })).toBeVisible()
  await expect(commit).toBeEnabled()

  // The presses while it was off started nothing, and the first import that does start leaves the held row out
  expect(runs).toBe(0)
  expect((await commitImport(page)).status()).toBe(201)
  expect(await countLedgerTransactions(request, user)).toBe(3)
})

// The rows an import has just saved are in the account, so asking again would flag them all and the
// finished screen would no longer match what was saved. Undoing the import reopens it, which asks again
test('keeps the finished import as saved, and asks again once its undo reopens the importer', async ({ page, request }) => {
  const user = await signUpUser(request)
  const hardware = { posted: '20240201120000', amount: '-20.00', name: 'Hardware' }
  await uploadStatement(page, user, buildFile([buildBankMessageSet('CAD', [PAYROLL, { ...hardware, fitId: 'H1' }])]))
  expect((await commitImport(page)).status()).toBe(201)

  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  let heldChecks = 0
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && /\/transactions\/import\/held-bank-transactions$/.test(sent.url())) heldChecks += 1
  })
  await page.locator('input[type="file"][accept*=".ofx"]').setInputFiles(statementFile('second.qfx', [PAYROLL, { ...hardware, fitId: 'H2' }]))
  const alreadyIn = page.getByText(`This transaction is already in ${ACCOUNT_LABEL}.`, { exact: true })
  await expect(alreadyIn).toBeVisible()
  const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) })
  const figures = preview.getByRole('paragraph').filter({ hasText: /^(Rows|Will create|New accounts|New categories|\d+)$/ })
  await expect(figures).toHaveText(['Rows', '2', 'Will create', '1', 'New accounts', '0', 'New categories', '0'])
  expect(heldChecks).toBe(1)

  expect((await commitImport(page)).status()).toBe(201)
  await page.getByRole('dialog').getByRole('button', { name: 'Review skipped rows', exact: true }).click()

  // The last import card reading the saved import is a fence: the refresh that brought it in would have
  // asked again at the same time if the importer had not been holding the check off
  const lastImport = page.getByRole('region', { name: 'Last import' })
  await expect(lastImport).toContainText('1 transaction')
  await expect(alreadyIn).toHaveCount(1)
  await expect(figures).toHaveText(['Rows', '2', 'Will create', '1', 'New accounts', '0', 'New categories', '0'])
  expect(heldChecks).toBe(1)

  await page.getByRole('button', { name: 'Undo import of second.qfx', exact: true }).click()
  await page.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true }).click()

  // The importer is back with its files, asks again and is answered: the hardware row is new again
  // and the payroll one is still held by the first import
  await expect.poll(() => heldChecks).toBe(2)
  await expect(alreadyIn).toHaveCount(1)
  await expect(figures).toHaveText(['Rows', '2', 'Will create', '1', 'New accounts', '0', 'New categories', '0'])
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()
  expect(await countLedgerTransactions(request, user)).toBe(2)
})
