import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Copies of budgets the frontend's unit tests read, each written by a local Actual server with the
// manifest of what that server showed for it. The yen budget has Actual's currency feature on, and
// the edges budget holds a category spent on directly and paid to an off-budget loan. The suite
// runs from its own directory alone, so it holds the copies rather than reaching into the frontend's
const YEN_FIXTURE = fileURLToPath(new URL('../fixtures/actual-yen/export.zip', import.meta.url))
const YEN_MANIFEST = JSON.parse(readFileSync(new URL('../fixtures/actual-yen/manifest.json', import.meta.url), 'utf8')) as {
  accounts: { name: string; balance: string }[]
  budgets: { category: string; isIncome: boolean; month: string; budgeted: string }[]
  rows: unknown[]
}
const EDGES_FIXTURE = fileURLToPath(new URL('../fixtures/actual-edges/export.zip', import.meta.url))
const EDGES_MANIFEST = JSON.parse(readFileSync(new URL('../fixtures/actual-edges/manifest.json', import.meta.url), 'utf8')) as {
  asOf: string
  accounts: { name: string }[]
  categoryMonths: { category: string; month: string; total: string }[]
  transfers: { date: string; from: string; to: string; amount: string; category: string | null }[]
}

async function uploadActualExport(page: Page, user: TestUser, fixture: string) {
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data Source', 'Actual Budget')
  await expect(page.getByText('What To Expect', { exact: true })).toBeVisible()

  const upload = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(fixture)
}

async function commitImport(page: Page) {
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/journal\/commit$/.test(response.url()))
  await commit.click()
  const response = await committed
  expect(response.status()).toBe(201)
  return response
}

test('imports an Actual Budget export with the balances and budgets Actual showed', async ({ page, request }) => {
  // A base currency other than the file's, so the accounts can only be yen because the file says so
  const user = await signUpUser(request)
  await uploadActualExport(page, user, YEN_FIXTURE)

  // Income budgets are left out, and the two spending budgets ended before this month
  await expect(page.getByText('1 budget skipped', { exact: true })).toBeVisible()
  for (const name of ['Bills', 'Food']) {
    await expect(page.getByRole('checkbox', { name: `Import ${name}` })).toBeChecked()
  }

  // The header box clears every budget, crossing each off, and then brings them all back
  await page.getByRole('checkbox', { name: 'Deselect all budgets' }).click()
  for (const name of ['Bills', 'Food']) {
    await expect(page.getByRole('checkbox', { name: `Import ${name}` })).not.toBeChecked()
  }
  await expect(page.getByText('Not imported', { exact: true })).toHaveCount(2)
  await page.getByRole('checkbox', { name: 'Select all budgets' }).click()
  for (const name of ['Bills', 'Food']) {
    await expect(page.getByRole('checkbox', { name: `Import ${name}` })).toBeChecked()
  }
  await expect(page.getByText('Not imported', { exact: true })).toHaveCount(0)

  const response = await commitImport(page)
  const result = await response.json() as { transactions_created: number; budgets: { name: string }[] }
  expect(result.transactions_created).toBe(YEN_MANIFEST.rows.length)
  expect(result.budgets.map((budget) => budget.name).sort()).toEqual(['Bills', 'Food'])

  const headers = asUser(user)
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers })
  const balances = Object.fromEntries((await accounts.json() as { name: string; currency: string; current_balance: number }[])
    .map((account) => [account.name, `${account.currency} ${account.current_balance}`]))
  expect(balances).toEqual(Object.fromEntries(YEN_MANIFEST.accounts.map((account) => [account.name, `JPY ${Number(account.balance)}`])))

  // Each month Actual budgeted above zero is one period of that many whole yen, and neither
  // budget repeats, since both ended before this month
  const periods = await (await request.get(`${API_BASE_URL}/budgets`, { headers })).json() as {
    period_start: string
    overall_limit: number
    base_budget: { name: string; recurs: boolean }
  }[]
  expect(periods.map((period) => [period.base_budget.name, period.period_start.slice(0, 7), period.overall_limit, period.base_budget.recurs]).sort())
    .toEqual(YEN_MANIFEST.budgets
      .filter((figure) => !figure.isIncome && Number(figure.budgeted) > 0)
      .map((figure) => [figure.category, figure.month, Number(figure.budgeted), false])
      .sort())
})

test('imports loan payments Actual gave a category as spending in it, which its budget counts', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadActualExport(page, user, EDGES_FIXTURE)

  // The export has Actual's currency feature off, so each new account needs one. Each list closes
  // before the next opens, since a closing one still offers its options
  for (const account of EDGES_MANIFEST.accounts) {
    await chooseFromDropdown(page.locator('body'), `Currency ${account.name}`, /^CAD$/)
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }

  const paymentMode = page.getByRole('radiogroup', { name: 'Import Car (transfers in Actual) as' })
  await expect(paymentMode.getByRole('radio', { name: 'Transfer' })).toHaveAttribute('aria-checked', 'true')

  // Kept as transfers by default, the payments are left out of the Car budget, which the budget step
  // warns of until they're filed as spending in Car
  const warning = page.getByText("Some budgets won't count these payments", { exact: true })
  await expect(warning.locator('..').getByRole('listitem')).toHaveText(['Car'])
  await paymentMode.getByRole('radio', { name: 'Expense' }).click()
  await expect(warning).toHaveCount(0)

  // As spending, the payments row answers for Car itself, so a choice on either row shows on both
  const paymentsTarget = page.getByRole('combobox', { name: 'Existing Category Car (transfers in Actual)' })
  const carTarget = page.getByRole('combobox', { name: 'Existing Category Car', exact: true })
  await chooseFromDropdown(page.locator('body'), 'Existing Category Car (transfers in Actual)', /Debt Payment/)
  await expect(carTarget).toContainText('Debt Payment')
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await carTarget.click()
  await page.getByRole('option', { name: 'Create new category' }).click()
  await expect(paymentsTarget).toContainText('Create new category')

  await commitImport(page)

  const headers = asUser(user)
  const accounts = await (await request.get(`${API_BASE_URL}/accounts`, { headers })).json() as { id: string; name: string }[]
  const accountId = (name: string) => accounts.find((account) => account.name === name)!.id
  const categories = await (await request.get(`${API_BASE_URL}/categories`, { headers })).json() as {
    id: string
    name: string
    is_system: boolean
  }[]
  const categoryId = (name: string, isSystem: boolean) => categories.find((category) => category.name === name && category.is_system === isSystem)!.id

  const transactions = await (await request.get(`${API_BASE_URL}/transactions`, {
    headers,
    params: new URLSearchParams([
      ['account_id', accountId('Checking')],
      ['account_id', accountId('Car Loan')],
      ['limit', '50'],
    ]),
  })).json() as {
    account_id: string
    dt: string
    amount: number
    category_id: string
    merchant_name: string | null
    counterparty_account_id: string | null
  }[]
  expect(transactions.length).toBeLessThan(50)

  // The Checking side is spending in Car with the loan as its merchant, and the loan side is a
  // transfer from Checking
  const paymentDates = EDGES_MANIFEST.transfers.filter((transfer) => transfer.category === 'Car').map((transfer) => transfer.date).sort()
  const legs = (account: string) => transactions
    .filter((transaction) => transaction.account_id === accountId(account)
      && Math.abs(transaction.amount) === 30000
      && paymentDates.includes(transaction.dt.slice(0, 10)))
    .sort((a, b) => a.dt.localeCompare(b.dt))
  expect(legs('Checking').map((leg) => [leg.dt.slice(0, 10), leg.amount, leg.category_id, leg.merchant_name, leg.counterparty_account_id]))
    .toEqual(paymentDates.map((date) => [date, -30000, categoryId('Car', false), 'Car Loan', null]))
  expect(legs('Car Loan').map((leg) => [leg.dt.slice(0, 10), leg.amount, leg.category_id, leg.counterparty_account_id]))
    .toEqual(paymentDates.map((date) => [date, 30000, categoryId('Transfer', true), accountId('Checking')]))

  // Each month before the export month, the Car budget shows spent what Actual counted against Car
  const budgets = await (await request.get(`${API_BASE_URL}/base-budgets`, { headers })).json() as { id: string; name: string }[]
  const car = budgets.find((budget) => budget.name === 'Car')!
  const utilizations = await (await request.get(`${API_BASE_URL}/base-budgets/${car.id}/utilizations`, { headers })).json() as {
    period_start: string
    total_spent: number
  }[]
  const exportMonth = EDGES_MANIFEST.asOf.slice(0, 7)
  const spent = utilizations
    .filter((utilization) => utilization.period_start.slice(0, 7) < exportMonth)
    .map((utilization) => [utilization.period_start.slice(0, 7), utilization.total_spent])
    .sort()
  expect(spent).toEqual(EDGES_MANIFEST.categoryMonths
    .filter((month) => month.category === 'Car' && month.month < exportMonth)
    .map((month) => [month.month, -Math.round(Number(month.total) * 100)])
    .sort())
})

test('imports transfers into a credit card under Credit Card Payment on both accounts', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadActualExport(page, user, EDGES_FIXTURE)
  for (const account of EDGES_MANIFEST.accounts) {
    await chooseFromDropdown(page.locator('body'), `Currency ${account.name}`, /^CAD$/)
    await expect(page.getByRole('listbox')).toHaveCount(0)
  }

  // Actual records no account types, so Savings is proposed as an asset and its transfers stay plain
  // transfers until it's set up as a credit card, when they get a row of their own
  const paymentsTarget = page.getByRole('combobox', { name: 'Existing Category Payments to credit cards and credit lines' })
  await expect(paymentsTarget).toHaveCount(0)
  await chooseFromDropdown(page.locator('body'), 'Type Savings', /^Credit Card$/)
  await expect(page.getByRole('listbox')).toHaveCount(0)
  await expect(paymentsTarget).toContainText('Credit Card Payment')

  await commitImport(page)

  const headers = asUser(user)
  const accounts = await (await request.get(`${API_BASE_URL}/accounts`, { headers })).json() as { id: string; name: string }[]
  const accountId = (name: string) => accounts.find((account) => account.name === name)!.id
  const categories = await (await request.get(`${API_BASE_URL}/categories`, { headers })).json() as {
    id: string
    name: string
    is_system: boolean
  }[]
  const creditCardPayment = categories.find((category) => category.name === 'Credit Card Payment' && category.is_system)!.id

  const transactions = await (await request.get(`${API_BASE_URL}/transactions`, {
    headers,
    params: new URLSearchParams([['account_id', accountId('Savings')], ['limit', '50']]),
  })).json() as { account_id: string; dt: string; amount: number; category_id: string; counterparty_account_id: string | null }[]
  expect(transactions.length).toBeLessThan(50)

  // Each payment is Credit Card Payment on the card, naming Checking, and the Checking side mirrors it.
  // The manifest lists transfers that move money, so the zero transfer the budget also holds is left out
  const payments = EDGES_MANIFEST.transfers.filter((transfer) => transfer.from === 'Checking' && transfer.to === 'Savings' && !transfer.category)
  expect(payments.length).toBeGreaterThan(0)
  const cardLegs = transactions.filter((transaction) => transaction.counterparty_account_id === accountId('Checking') && transaction.amount !== 0)
  expect(cardLegs.map((leg) => [leg.dt.slice(0, 10), leg.amount, leg.category_id]).sort())
    .toEqual(payments.map((payment) => [payment.date, Math.round(Number(payment.amount) * 100), creditCardPayment]).sort())

  const checking = await (await request.get(`${API_BASE_URL}/transactions`, {
    headers,
    params: new URLSearchParams([['account_id', accountId('Checking')], ['limit', '50']]),
  })).json() as { dt: string; amount: number; category_id: string; counterparty_account_id: string | null }[]
  expect(checking.length).toBeLessThan(50)
  expect(checking
    .filter((transaction) => transaction.counterparty_account_id === accountId('Savings') && transaction.amount !== 0)
    .map((leg) => [leg.dt.slice(0, 10), leg.amount, leg.category_id])
    .sort())
    .toEqual(payments.map((payment) => [payment.date, -Math.round(Number(payment.amount) * 100), creditCardPayment]).sort())
})

test('leaves out a budget left unticked', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadActualExport(page, user, YEN_FIXTURE)

  await page.getByRole('checkbox', { name: 'Import Food' }).click()
  await expect(page.getByText('Not imported', { exact: true })).toHaveCount(1)

  const result = await (await commitImport(page)).json() as { budgets: { name: string }[] }
  expect(result.budgets.map((budget) => budget.name)).toEqual(['Bills'])
})

// A save that failed for a reason trying again could clear keeps its upload, so trying again saves
// it without uploading the export a second time
test('saves a kept upload again after its first save failed', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadActualExport(page, user, YEN_FIXTURE)

  const commitUrl = /\/transactions\/import\/runs\/[^/]+\/journal\/commit$/
  let commitAttempts = 0
  await page.route(commitUrl, async (route) => {
    commitAttempts += 1
    if (commitAttempts === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Service unavailable' }) })
      return
    }
    await route.continue()
  })

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  const retry = page.getByRole('button', { name: 'Try again', exact: true })
  await expect(retry).toBeVisible()
  const saved = page.waitForResponse((response) => response.request().method() === 'POST' && commitUrl.test(response.url()))
  await retry.click()
  const response = await saved
  expect(response.status()).toBe(201)
  expect(commitAttempts).toBe(2)

  const result = await response.json() as { transactions_created: number }
  expect(result.transactions_created).toBe(YEN_MANIFEST.rows.length)
})

async function countLedgerTransactions(request: APIRequestContext, user: TestUser) {
  let count = 0
  for (let offset = 0; ; offset += 50) {
    const response = await request.get(`${API_BASE_URL}/transactions`, {
      headers: asUser(user),
      params: { limit: 50, offset },
    })
    expect(response.status()).toBe(200)
    const page = await response.json() as unknown[]
    count += page.length
    if (page.length < 50) return count
  }
}

// A save whose answer was lost may have landed. Importing again from the same screen, even with an
// answer changed, finds out first and writes nothing twice
test('imports nothing twice after a save that landed but whose answer was lost', async ({ page, request }) => {
  const user = await signUpUser(request)
  await uploadActualExport(page, user, YEN_FIXTURE)

  const commitUrl = /\/transactions\/import\/runs\/[^/]+\/journal\/commit$/
  let commitAttempts = 0
  await page.route(commitUrl, async (route) => {
    commitAttempts += 1
    if (commitAttempts > 1) {
      await route.continue()
      return
    }
    const landed = await route.fetch()
    expect(landed.status()).toBe(201)
    await route.abort('connectionfailed')
  })

  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('Save interrupted', { exact: true })).toBeVisible()
  await expect(overlay.getByText('The import was interrupted. Try again to finish saving your import. Nothing will be added twice as long as you stay on the import page.', { exact: true })).toBeVisible()
  await expect(overlay.getByText('Leaving the import page? Check your transactions before importing again.', { exact: true })).toBeVisible()
  const ledgerAfterFirstSave = await countLedgerTransactions(request, user)
  expect(ledgerAfterFirstSave).toBeGreaterThan(0)

  await overlay.getByRole('button', { name: 'Back to import', exact: true }).click()
  await expect(page.getByText('Save interrupted. Please try again.', { exact: true })).toBeVisible()
  await page.getByRole('checkbox', { name: 'Import Food' }).click()
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()

  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await expect(overlay.getByText('Your earlier import was saved, so this one wasn\'t imported.', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(ledgerAfterFirstSave)
})
