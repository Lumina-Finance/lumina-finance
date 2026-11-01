import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, countLedgerTransactions, createAccount, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage } from '../support/app'
import { buildBankMessageSet, buildCardMessageSet, buildFile, CAFE, PAYROLL, statementFile } from '../support/ofx'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: which source an account's import page opens on is the same at every size

async function uploadStatement(page: Page, contents: string) {
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'statement.ofx', mimeType: 'application/octet-stream', buffer: Buffer.from(contents) })
}

// The source is saved by the commit and read back when the account's page opens, which no unit test
// reaches
test('imports an OFX statement into the account from its page, which then opens on OFX/QFX', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)

  // An account nothing was imported into opens on CSV, and the user can still change it
  await openPage(page, `/settings/imports?account=${checking.id}`)
  const source = page.getByRole('combobox', { name: 'Data source' })
  await expect(source).toHaveText('CSV')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await expect(source).toHaveText('OFX/QFX')

  // Firefly III and Actual Budget exports cover many accounts, so they are not offered here
  await source.click()
  await expect(page.getByRole('option')).toHaveText(['CSV', 'OFX/QFX', 'Quicken 3.0 (QIF)Beta'])
  await page.keyboard.press('Escape')

  await uploadStatement(page, buildFile([buildBankMessageSet('CAD', [CAFE, PAYROLL])]))
  await expect(page.getByText('Corner Cafe', { exact: true }).first()).toBeVisible()
  await expect(page.getByRole('combobox', { name: /^Existing account/ })).toHaveCount(0)

  const response = await commitImport(page)
  expect(response.status()).toBe(201)

  // Every transaction went to the account the page was opened for
  expect(await countLedgerTransactions(request, user)).toBe(2)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  expect((await accounts.json() as { id: string; current_balance: number }[]).filter((account) => account.id === checking.id))
    .toMatchObject([{ current_balance: 248750 }])

  await openPage(page, `/settings/imports?account=${checking.id}`)
  await expect(page.getByRole('combobox', { name: 'Data source' })).toHaveText('OFX/QFX')
})

/**
 * Imports one OFX row into the account over the API, the way an import from the general Imports page
 * does, without the account's page knowing
 */
async function importOfxRowOverApi(request: APIRequestContext, user: TestUser, accountId: string) {
  const headers = asUser(user)
  const opened = await request.post(`${API_BASE_URL}/transactions/import/runs`, {
    headers,
    data: { expected_transaction_count: 1, source: 'ofx' },
  })
  expect(opened.status()).toBe(201)
  const runId = (await opened.json() as { id: string }).id
  const staged = await request.post(`${API_BASE_URL}/transactions/import/runs/${runId}/rows`, {
    headers,
    data: {
      start_row_index: 0,
      accounts: [{ source: 'Account', account_id: accountId }],
      categories: [{ source: 'Coffee', create: { name: 'Coffee', kind: 'expense' } }],
      rows: [{ account_source: 'Account', category_source: 'Coffee', dt: '2026-04-05', amount: '-4.50', tag_names: [] }],
    },
  })
  expect(staged.status()).toBe(204)
  const committed = await request.post(`${API_BASE_URL}/transactions/import/runs/${runId}/commit`, { headers })
  expect(committed.status()).toBe(201)
}

// The query cache is kept in local storage, so a list saved on an earlier visit to the account's page
// is there before the page fetches the current one
test('opens on the source imported since the account\'s page was last visited', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${checking.id}`)
  await expect(page.getByRole('combobox', { name: 'Data source' })).toHaveText('CSV')

  await importOfxRowOverApi(request, user, checking.id)
  await openPage(page, `/settings/imports?account=${checking.id}`)

  await expect(page.getByRole('combobox', { name: 'Data source' })).toHaveText('OFX/QFX')
})

/**
 * Starts watching, from inside the page, for the loading animation to appear, since it is gone again
 * within a second and a check made once the page has settled would miss it
 */
async function watchForLoadingAnimation(page: Page) {
  await page.evaluate(() => {
    const seen = { loading: false }
    const look = () => {
      if (document.querySelector('[role="status"][aria-label="Loading"]')) seen.loading = true
    }
    new MutationObserver(look).observe(document.body, { childList: true, subtree: true })
    Object.assign(window, { loadingSeenOnImportPage: seen })
  })
}

async function loadingAnimationWasSeen(page: Page) {
  return page.evaluate(() => (window as unknown as { loadingSeenOnImportPage: { loading: boolean } }).loadingSeenOnImportPage.loading)
}

// Going back and forth inside the app keeps the saved sources in the query cache, so the second visit
// has the list at once and must not hold the page behind the loading animation to read it again
test('opens an account\'s import page again on the remembered source without the loading animation', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await importOfxRowOverApi(request, user, checking.id)
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${checking.id}`)
  const source = page.getByRole('combobox', { name: 'Data source' })
  await expect(source).toHaveText('OFX/QFX')

  await page.getByRole('button', { name: 'Close import workflow', exact: true }).click()
  const importButton = page.getByRole('button', { name: 'Import transactions into this account', exact: true })
  await expect(importButton).toBeVisible()

  await watchForLoadingAnimation(page)
  await importButton.click()
  await expect(source).toHaveText('OFX/QFX')
  expect(await loadingAnimationWasSeen(page)).toBe(false)
})

// The account's page reads the saved sources as it opens, so the first visit to the import page in a tab
// finds them in the cache rather than waiting for them
test('opens an account\'s import page from its first visit in a tab without the loading animation', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await importOfxRowOverApi(request, user, checking.id)
  await logInViaApi(page, user)
  const sourcesRead = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/transactions/import/sources'),
    { timeout: 15_000 },
  )
  await openPage(page, `/accounts/${checking.id}`)
  await sourcesRead

  const importButton = page.getByRole('button', { name: 'Import transactions into this account', exact: true })
  await expect(importButton).toBeVisible()
  await watchForLoadingAnimation(page)
  await importButton.click()
  await expect(page.getByRole('combobox', { name: 'Data source' })).toHaveText('OFX/QFX')
  expect(await loadingAnimationWasSeen(page)).toBe(false)
})

// A save marks the saved sources out of date, and until they are read again the list in the cache still
// names the source from before it. The page must wait for the new list rather than open on the old one.
// The read is held back so the page opens while it is still on its way, which is when it can tell
test('opens an account\'s import page on the source just imported, not the one in the cache from before', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)

  let releaseSources = () => {}
  const sourcesHeld = new Promise<void>((resolve) => { releaseSources = resolve })
  let isHolding = false
  await page.route((url) => url.pathname.endsWith('/transactions/import/sources'), async (route) => {
    if (isHolding) await sourcesHeld
    await route.continue()
  })

  // Everything after this first load happens inside the app, so the cache is never reloaded from storage
  await openPage(page, `/settings/imports?account=${checking.id}`)
  const source = page.getByRole('combobox', { name: 'Data source' })
  await expect(source).toHaveText('CSV')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await uploadStatement(page, buildFile([buildBankMessageSet('CAD', [CAFE])]))
  isHolding = true
  expect((await commitImport(page)).status()).toBe(201)
  await page.getByRole('button', { name: 'Done', exact: true }).click()

  const importButton = page.getByRole('button', { name: 'Import transactions into this account', exact: true })
  await importButton.click()

  // Released only once the page has either opened on a source or is waiting for one, so the answer
  // can't land before the page has decided
  await expect(source.or(page.getByRole('status', { name: 'Loading', exact: true }))).toBeVisible()
  releaseSources()

  await expect(source).toHaveText('OFX/QFX')
})

// Each file holds one statement and every one goes into the account, whatever bank account the file
// names, while a transaction an earlier file holds is still left out
test('imports the statements of several files into the account from its page', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${checking.id}`)
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')

  const hardware = { posted: '20240201120000', amount: '-20.00', fitId: 'B1', name: 'Hardware' }
  const card = { posted: '20240118120000', amount: '-30.00', fitId: 'C1', name: 'Groceries' }
  const cardFile = { name: '2024-03.qfx', mimeType: 'application/octet-stream', buffer: Buffer.from(buildFile([buildCardMessageSet('CAD', [card])])) }
  await page.locator('input[type="file"][accept*=".ofx"]').setInputFiles([
    statementFile('2024-01.qfx', [CAFE, PAYROLL]),
    statementFile('2024-02.qfx', [PAYROLL, hardware]),
    cardFile,
  ])

  await expect(page.getByText('This transaction is already in 2024-01.qfx.', { exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: /^Existing account/ })).toHaveCount(0)
  expect((await commitImport(page)).status()).toBe(201)

  expect(await countLedgerTransactions(request, user)).toBe(4)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  expect((await accounts.json() as { name: string; current_balance: number }[])).toMatchObject([
    { name: 'Checking', current_balance: 243750 },
  ])
})

// Which transactions the account already holds is known only to the save, so the overlap shows in
// the summary once it lands, and the ledger gains only the new transaction
test('imports a statement overlapping an earlier one into the account, adding only what is new', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${checking.id}`)
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await uploadStatement(page, buildFile([buildBankMessageSet('CAD', [CAFE, PAYROLL])]))
  expect((await commitImport(page)).status()).toBe(201)

  const hardware = { posted: '20240201120000', amount: '-20.00', fitId: 'B1', name: 'Hardware' }
  await openPage(page, `/settings/imports?account=${checking.id}`)
  await expect(page.getByRole('combobox', { name: 'Data source' })).toHaveText('OFX/QFX')
  await uploadStatement(page, buildFile([buildBankMessageSet('CAD', [CAFE, PAYROLL, hardware])]))
  expect((await commitImport(page)).status()).toBe(201)

  await expect(page.getByRole('dialog').getByText(
    '1 transaction imported · 0 accounts created · 0 categories created · 2 skipped',
    { exact: true },
  )).toBeVisible()
  await expect(page.getByRole('rowheader', { name: 'Reason: This transaction is already in Checking.' })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(3)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers: asUser(user) })
  expect((await accounts.json() as { id: string; current_balance: number }[]).filter((account) => account.id === checking.id))
    .toMatchObject([{ current_balance: 248750 - 2000 }])
})

// A change made elsewhere moves the user's data marker, and the focus that follows reads the saved
// sources again. Once the page has opened on one, that read must not put the page behind the spinner
test('keeps a staged statement on screen when the saved sources are read again', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${checking.id}`)
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await uploadStatement(page, buildFile([buildBankMessageSet('CAD', [CAFE])]))
  // The setup panel holding the file's remove button folds away once the statement is staged, so the
  // statement is found by the Commit import button, which stays on screen beside its preview
  const staged = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(staged).toBeEnabled()

  await createAccount(request, user, { name: 'Savings', currency: 'CAD' })
  const reread = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/transactions/import/sources'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await reread

  // Read once rather than retried, since a spinner that shows and then goes is the failure
  expect(await page.getByRole('status', { name: 'Loading' }).count()).toBe(0)
  expect(await staged.isVisible()).toBe(true)
  // Commit waits while the account is checked again for transactions it already holds
  await expect(staged).toBeEnabled()
})

test('refuses a statement file holding several statements on an account\'s page and stages nothing', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking', currency: 'CAD' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${checking.id}`)
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')

  await uploadStatement(page, buildFile([
    buildBankMessageSet('CAD', [CAFE]),
    buildCardMessageSet('CAD', [{ posted: '20240118120000', amount: '-30.00', fitId: 'C1', name: 'Hardware' }]),
  ]))

  await expect(page.getByText(
    'This file holds 2 statements. Import it from the Imports page in Settings, where each statement can go to its own account.',
    { exact: true },
  )).toBeVisible()
  await expect(page.getByRole('button', { name: 'Remove statement.ofx', exact: true })).toHaveCount(0)
  expect(await countLedgerTransactions(request, user)).toBe(0)
})
