import { expect, test, type APIRequestContext } from '@playwright/test'

import { fileURLToPath } from 'node:url'

import { asUser, countLedgerTransactions, createCategory, listLedgerTransactions, signUpUser, type TestUser } from '../support/api'
import { chooseFromDropdown, commitImport, logInViaApi, openPage } from '../support/app'
import { stageFireflyExport } from '../support/firefly'
import { buildBankMessageSet, buildFile, PAYROLL, statementFile } from '../support/ofx'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the import asks the rules and writes is the same at every size

async function createNamed(request: APIRequestContext, user: TestUser, path: string, data: Record<string, unknown>) {
  const response = await request.post(`${API_BASE_URL}/${path}`, { headers: asUser(user), data })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

async function createRule(request: APIRequestContext, user: TestUser, data: Record<string, unknown>) {
  await createNamed(request, user, 'import-rules', { match: 'all', tag_ids: [], ...data })
}

const containsDescription = (value: string) => ({
  kind: 'condition',
  attribute: 'description',
  operator: 'contains',
  value,
})

// Two rows name the cafe a rule gives a merchant, a category and a tag. The third names a merchant no
// rule covers, so only that one is asked about. The account is one the import creates
const CSV = [
  'Date,Amount,Merchant,Account',
  '2024-03-15,-12.50,Corner Cafe,Holiday fund',
  '2024-03-16,-8.00,Corner Cafe,Holiday fund',
  '2024-03-17,-30.00,Market,Holiday fund',
].join('\n')

async function openCsvImport(page: Parameters<typeof logInViaApi>[0], user: TestUser) {
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'rules.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await expect(page.getByRole('combobox', { name: 'Existing account Holiday fund', exact: true })).toContainText('Create new account')
  const body = page.locator('body')
  await chooseFromDropdown(body, 'Type Holiday fund', /^Savings$/)
  await chooseFromDropdown(body, 'Currency Holiday fund', /^CAD/)
}

async function seedCafeRule(request: APIRequestContext, user: TestUser) {
  const merchantId = await createNamed(request, user, 'merchants', { name: 'Cafe' })
  const categoryId = await createCategory(request, user, { name: 'Coffee shops' })
  const tagId = await createNamed(request, user, 'tags', { name: 'Treat' })
  await createRule(request, user, {
    name: 'Coffee',
    conditions: [containsDescription('Cafe')],
    merchant_id: merchantId,
    category_id: categoryId,
    tag_ids: [tagId],
  })
}

test('applies a rule to a CSV import into a new account and counts the rows it saves', async ({ page, request }) => {
  const user = await signUpUser(request)
  await seedCafeRule(request, user)
  await openCsvImport(page, user)

  // The cafe name is covered by the rule, so only the market is asked about
  await expect(page.getByRole('combobox', { name: 'Merchant Market', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Merchant Corner Cafe', exact: true })).toHaveCount(0)
  await expect(
    page.getByText('The merchant name "Corner Cafe" isn\'t listed: the rule "Coffee" sets the merchant of its rows.', { exact: true }),
  ).toBeVisible()

  // The notice counts the rows the save writes
  const steps = page.getByRole('region', { name: 'Import steps' })
  await expect(steps.getByText('The rule "Coffee" changed 2 rows.', { exact: true })).toBeVisible()

  await commitImport(page)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('3 transactions imported · 1 account created · 0 categories created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(3)

  // Read back from the ledger, the cafe rows carry what the rule gave them
  const list = await listLedgerTransactions(request, user)
  expect(list.filter((row) => row.merchant_name === 'Cafe' && row.tags.some((tag) => tag.name === 'Treat'))).toHaveLength(2)
  expect(list.filter((row) => row.merchant_name === 'Market')).toHaveLength(1)
})

test('holds Commit import off when the rules cannot be checked, until Try again answers', async ({ page, request }) => {
  const user = await signUpUser(request)
  await seedCafeRule(request, user)

  const matchesPath = '**/import-rules/matches'
  await page.route(matchesPath, (route) => route.fulfill({ status: 500, json: { detail: 'Server error' } }))
  await openCsvImport(page, user)

  const failed = page.getByRole('alert').filter({ hasText: "Couldn't check your import rules. Please try again." })
  await expect(failed).toBeVisible()
  await expect(page.getByText('Your import rules could not be checked', { exact: true }).first()).toBeVisible()
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toHaveAttribute('aria-disabled', 'true')

  // The button stays focusable while it is held off, so neither a click nor Enter may start a save
  const saveRequests: string[] = []
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url().includes('/transactions/import/runs')) saveRequests.push(sent.url())
  })
  // Playwright waits for a button marked aria-disabled to come on before it clicks, so the click is forced through
  await commit.click({ force: true })
  await commit.focus()
  await page.keyboard.press('Enter')

  // The check answered after both presses comes after any save they would have started, so the wait for it is the fence
  await page.unroute(matchesPath)
  const answered = page.waitForResponse((response) => response.url().endsWith('/import-rules/matches') && response.status() === 200)
  await page.getByRole('button', { name: 'Try again', exact: true }).first().click()
  await answered
  expect(saveRequests).toEqual([])
  await expect(failed).toBeHidden()
  await expect(commit).toBeEnabled()
  expect((await commitImport(page)).status()).toBe(200)
})

// The second statement repeats a transaction the account already holds, and the save leaves it out.
// The notice counts only the row the save writes, so it says one row while the statement holds two
// that the rule matches
test('counts only the OFX rows the save writes, not one the account already holds', async ({ page, request }) => {
  const user = await signUpUser(request)
  const hardware = { posted: '20240201120000', amount: '-20.00', name: 'Hardware' }
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({
    name: 'first.ofx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buildFile([buildBankMessageSet('CAD', [PAYROLL, { ...hardware, fitId: 'H1' }])])),
  })
  expect((await commitImport(page)).status()).toBe(200)

  const merchantId = await createNamed(request, user, 'merchants', { name: 'Supplier' })
  await createRule(request, user, {
    name: 'Supplies',
    match: 'any',
    conditions: [containsDescription('Payroll'), containsDescription('Hardware')],
    merchant_id: merchantId,
  })

  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(statementFile('second.qfx', [PAYROLL, { ...hardware, fitId: 'H2' }]))

  await expect(page.getByText('This transaction is already in Checking ending 6789.', { exact: true })).toBeVisible()
  const steps = page.getByRole('region', { name: 'Import steps' })
  await expect(steps.getByText('The rule "Supplies" changed 1 row.', { exact: true })).toBeVisible()

  expect((await commitImport(page)).status()).toBe(200)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('1 transaction imported · 0 accounts created · 0 categories created · 1 skipped', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(3)
})

// A budget app's export keeps the merchants and categories it names, so a rule matching every row
// that money leaves changes none of them. Returns the check to run once the import is saved
async function seedRuleForEveryPayment(request: APIRequestContext, user: TestUser) {
  const ruleMerchant = 'Rule merchant'
  const ruleCategoryId = await createCategory(request, user, { name: 'Rule category' })
  await createRule(request, user, {
    name: 'Every payment',
    conditions: [{ kind: 'condition', attribute: 'direction', operator: 'is', value: 'out' }],
    merchant_id: await createNamed(request, user, 'merchants', { name: ruleMerchant }),
    category_id: ruleCategoryId,
  })
  return async () => {
    const saved = await listLedgerTransactions(request, user)
    expect(saved.length).toBeGreaterThan(0)
    expect(saved.filter((row) => row.merchant_name === ruleMerchant || row.category_id === ruleCategoryId)).toEqual([])
  }
}

test('leaves a Firefly III import as the export has it, whatever the rules say', async ({ page, request }) => {
  const user = await signUpUser(request)
  const expectUnchanged = await seedRuleForEveryPayment(request, user)
  await logInViaApi(page, user)
  await stageFireflyExport(page)

  expect((await commitImport(page)).status()).toBe(200)
  await expectUnchanged()
})

test('leaves an Actual Budget import as the export has it, whatever the rules say', async ({ page, request }) => {
  const user = await signUpUser(request)
  const expectUnchanged = await seedRuleForEveryPayment(request, user)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', 'Actual Budget')
  const upload = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(fileURLToPath(new URL('../fixtures/actual-yen/export.zip', import.meta.url)))

  expect((await commitImport(page)).status()).toBe(200)
  await expectUnchanged()
})
