import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser, type TestUser } from '../support/api'
import { commitImport, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: which settings a file opens with is the same at every size

// Every day is 12 or under, so the dates read as day first or month first and detection can't choose
const WEB_EXPORT = ['Date,Amount,Merchant', '05/04/2026,-4.50,Corner Roastery', '06/04/2026,-20.00,Market'].join('\n')
const MOBILE_EXPORT = ['Date,Amount,Merchant,Notes', '05/04/2026,-4.50,Corner Roastery,Card'].join('\n')

const WEB_LAYOUT = {
  headers: ['Date', 'Amount', 'Merchant'],
  delimiter: ',',
  header_row: 1,
  column_map: { dt: 'Date', amount: 'Amount', merchant_id: 'Merchant' },
  date_format: 'dayFirst',
  amount_format: { decimal_separator: '.', grouping_separator: ',' },
}

const DAY_FIRST = 'Day first (30/04/2026)'
const NOTICE_TITLE = 'Settings from your last import'

/**
 * Saves the web export's layout for the account, the way a completed import of it does
 */
async function seedWebLayout(request: APIRequestContext, user: TestUser, accountId: string, layout: object = WEB_LAYOUT) {
  const headers = asUser(user)
  const opened = await request.post(`${API_BASE_URL}/transactions/import/runs`, {
    headers,
    data: { expected_transaction_count: 1, csv_layout: layout },
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

async function listLayouts(request: APIRequestContext, user: TestUser) {
  const listed = await request.get(`${API_BASE_URL}/transactions/import/layouts`, { headers: asUser(user) })
  expect(listed.status()).toBe(200)
  return await listed.json() as { account_id: string; headers: string[]; date_format: string }[]
}

async function upload(page: Page, path: string, name: string, csv: string) {
  await openPage(page, path)
  const input = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(input).toBeEnabled()
  await input.setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const dateFormat = page.getByRole('combobox', { name: 'Date format', exact: true })
  await expect(dateFormat).toBeVisible()
  return dateFormat
}

// The answer is saved by the commit and read back when the page opens the next file, which no unit
// test reaches
test('opens the next file with the same headers with the date format chosen last time', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)

  const first = await upload(page, `/settings/imports?account=${checking.id}`, 'web.csv', WEB_EXPORT)
  await expect(first).toHaveText('Choose the date format')
  await first.click()
  await page.getByRole('option', { name: /^Day first \(30\/04\/2026\)/ }).click()
  await commitImport(page)
  await expect(page.getByRole('dialog').getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()

  const next = await upload(page, `/settings/imports?account=${checking.id}`, 'web-may.csv', WEB_EXPORT)
  await expect(next).toHaveText(DAY_FIRST)
  await expect(page.getByText(NOTICE_TITLE, { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()
})

// The list of saved settings is read again after the commit, and a file uploaded before it arrives
// was read against the list from before the import, so it opened by detection. Done leads back to
// the account, whose Import button opens the page again without a reload
test('opens a file uploaded right after an import in the same tab with that import\'s settings', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)
  let isSlowingLayouts = false
  await page.route('**/transactions/import/layouts', async (route) => {
    if (isSlowingLayouts) await new Promise((resolve) => setTimeout(resolve, 5000))
    await route.continue()
  })

  const first = await upload(page, `/settings/imports?account=${checking.id}`, 'web.csv', WEB_EXPORT)
  await first.click()
  await page.getByRole('option', { name: /^Day first \(30\/04\/2026\)/ }).click()
  isSlowingLayouts = true
  await commitImport(page)
  const overlay = page.getByRole('dialog')
  await expect(overlay.getByText('2 transactions imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()
  await overlay.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: 'Import transactions into this account', exact: true }).click()

  const uploadCard = page.getByRole('button', { name: /^Upload CSV file/ })
  await expect(uploadCard).toBeEnabled()
  const chooser = page.waitForEvent('filechooser')
  await uploadCard.click()
  await (await chooser).setFiles({ name: 'web-may.csv', mimeType: 'text/csv', buffer: Buffer.from(WEB_EXPORT) })

  await expect(page.getByRole('combobox', { name: 'Date format', exact: true })).toHaveText(DAY_FIRST)
  await expect(page.getByText(NOTICE_TITLE, { exact: true })).toHaveCount(0)
})

test('reads a file with other headers by detection and then keeps both layouts', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await seedWebLayout(request, user, checking.id)
  await logInViaApi(page, user)

  const dateFormat = await upload(page, `/settings/imports?account=${checking.id}`, 'mobile.csv', MOBILE_EXPORT)
  await expect(dateFormat).toHaveText('Choose the date format')
  await expect(page.getByText(NOTICE_TITLE, { exact: true })).toHaveCount(0)
  await dateFormat.click()
  await page.getByRole('option', { name: /^Month first \(04\/30\/2026\)/ }).click()
  await commitImport(page)
  await expect(page.getByRole('dialog').getByText('1 transaction imported · 0 accounts created · 0 categories created', { exact: true })).toBeVisible()

  const layouts = await listLayouts(request, user)
  expect(layouts.map((layout) => [layout.account_id, layout.headers.length, layout.date_format])).toEqual([
    [checking.id, 4, 'monthFirst'],
    [checking.id, 3, 'dayFirst'],
  ])
})

test('reads the same file into another account by detection', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  const savings = await createAccount(request, user, { name: 'Savings' })
  await seedWebLayout(request, user, checking.id)
  await logInViaApi(page, user)

  const dateFormat = await upload(page, `/settings/imports?account=${savings.id}`, 'web.csv', WEB_EXPORT)

  await expect(dateFormat).toHaveText('Choose the date format')
  await expect(page.getByText(NOTICE_TITLE, { exact: true })).toHaveCount(0)
})

// Settings are remembered only for an import started from an account, so the general Imports page
// never asks for them and reads even a file with a saved layout's headers as it always has. The
// date format answer showing is the fence: a request for the layouts would have gone out by then
test('opens a file on the Imports page by detection, without asking for or showing saved settings', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await seedWebLayout(request, user, checking.id)
  await logInViaApi(page, user)
  let layoutRequests = 0
  page.on('request', (sent) => { if (new URL(sent.url()).pathname.endsWith('/transactions/import/layouts')) layoutRequests += 1 })

  const dateFormat = await upload(page, '/settings/imports', 'web.csv', WEB_EXPORT)

  await expect(dateFormat).toHaveText('Choose the date format')
  await expect(page.getByText(NOTICE_TITLE, { exact: true })).toHaveCount(0)
  expect(layoutRequests).toBe(0)
})

// Each answer below differs from what detection gives this file: the merchant column is filed as
// notes, the memo is left out, and the amounts could be read in several decimal comma formats
test('opens a file with every column and the amount format the saved settings hold', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await seedWebLayout(request, user, checking.id, {
    ...WEB_LAYOUT,
    headers: ['Date', 'Amount', 'Merchant', 'Memo'],
    delimiter: ';',
    column_map: { dt: 'Date', amount: 'Amount', notes: 'Merchant' },
    amount_format: { decimal_separator: ',', grouping_separator: '.' },
  })
  await logInViaApi(page, user)
  const csv = ['Date;Amount;Merchant;Memo', '05/04/2026;-4,50;Corner Roastery;Card', '06/04/2026;-20,00;Market;Card'].join('\n')

  const dateFormat = await upload(page, `/settings/imports?account=${checking.id}`, 'web.csv', csv)

  await expect(dateFormat).toHaveText(DAY_FIRST)
  await expect(page.getByRole('combobox', { name: 'Match to app field Merchant', exact: true })).toContainText('Notes')
  await expect(page.getByRole('combobox', { name: 'Match to app field Memo', exact: true })).toContainText('Do not import')
  await expect(page.getByRole('combobox', { name: 'Amount format', exact: true })).toHaveText('1.234,56')
})

test('reads a file by detection when its saved settings name a format no longer offered', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)
  await page.route('**/transactions/import/layouts', (route) => route.fulfill({
    json: [{ ...WEB_LAYOUT, account_id: checking.id, date_format: 'julian' }],
  }))

  const dateFormat = await upload(page, `/settings/imports?account=${checking.id}`, 'web.csv', WEB_EXPORT)

  await expect(dateFormat).toHaveText('Choose the date format')
  await expect(page.getByText(NOTICE_TITLE, { exact: true })).toHaveCount(0)
  await expect(page.getByText('Saved settings not used', { exact: true })).toHaveCount(0)
})

test('holds the upload while the saved settings load, and reads files by detection when they fail', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/transactions/import/layouts', async (route) => {
    await held
    await route.fulfill({ status: 500, json: { detail: 'Internal Server Error' } })
  })

  await openPage(page, `/settings/imports?account=${checking.id}`)
  const uploadCard = page.getByRole('button', { name: /^Upload CSV file/ })
  await expect(page.getByText('Loading your saved import settings…', { exact: true })).toBeVisible()
  await expect(uploadCard).toHaveCount(0)

  release()
  await expect(uploadCard).toBeVisible()
  await expect(page.getByText(/saved import settings/)).toHaveCount(0)

  const dateFormat = await upload(page, `/settings/imports?account=${checking.id}`, 'web.csv', WEB_EXPORT)
  await expect(dateFormat).toHaveText('Choose the date format')
})
