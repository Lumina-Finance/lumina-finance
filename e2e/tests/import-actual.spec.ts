import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

import { TEST_PASSWORD, TEST_TIMEZONE, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// A copy of the yen budget the frontend's unit tests read, written by a local Actual server with
// its currency feature on, and the manifest of what that server showed for it. The suite runs
// from its own directory alone, so it holds the copy rather than reaching into the frontend's
const FIXTURE = fileURLToPath(new URL('../fixtures/actual-yen/export.zip', import.meta.url))
const MANIFEST = JSON.parse(readFileSync(new URL('../fixtures/actual-yen/manifest.json', import.meta.url), 'utf8')) as {
  accounts: { name: string; balance: string }[]
  budgets: { category: string; isIncome: boolean; month: string; budgeted: string }[]
  rows: unknown[]
}

test('imports an Actual Budget export with the balances and budgets Actual showed', async ({ page, request }) => {
  const email = `e2e-actual-${crypto.randomUUID()}@example.com`
  const signup = await request.post(`${API_BASE_URL}/auth/signup`, {
    // A base currency other than the file's, so the accounts can only be yen because the file says so
    data: { email, password: TEST_PASSWORD, first_name: 'Actual', tz: TEST_TIMEZONE, base_currency: 'CAD' },
  })
  expect(signup.status()).toBe(201)
  const auth = await signup.json() as { access_token: string }
  const user: TestUser = { email, password: TEST_PASSWORD, firstName: 'Actual', accessToken: auth.access_token }

  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data Source', 'Actual Budget')
  await expect(page.getByText('What To Expect', { exact: true })).toBeVisible()

  const upload = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles(FIXTURE)

  // Income budgets are left out, and the two spending budgets ended before this month
  await expect(page.getByText('1 budget skipped', { exact: true })).toBeVisible()
  for (const name of ['Bills', 'Food']) {
    await expect(page.getByRole('checkbox', { name: `Import ${name}` })).toBeChecked()
  }

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/journal\/commit$/.test(response.url()))
  await commit.click()
  const response = await committed
  expect(response.status()).toBe(201)
  const result = await response.json() as { transactions_created: number; budgets: { name: string }[] }
  expect(result.transactions_created).toBe(MANIFEST.rows.length)
  expect(result.budgets.map((budget) => budget.name).sort()).toEqual(['Bills', 'Food'])

  const headers = { Authorization: `Bearer ${user.accessToken}` }
  const accounts = await request.get(`${API_BASE_URL}/accounts`, { headers })
  const balances = Object.fromEntries((await accounts.json() as { name: string; currency: string; current_balance: number }[])
    .map((account) => [account.name, `${account.currency} ${account.current_balance}`]))
  expect(balances).toEqual(Object.fromEntries(MANIFEST.accounts.map((account) => [account.name, `JPY ${Number(account.balance)}`])))

  // Each month Actual budgeted above zero is one period of that many whole yen, and neither
  // budget repeats, since both ended before this month
  const periods = await (await request.get(`${API_BASE_URL}/budgets`, { headers })).json() as {
    period_start: string
    overall_limit: number
    base_budget: { name: string; recurs: boolean }
  }[]
  expect(periods.map((period) => [period.base_budget.name, period.period_start.slice(0, 7), period.overall_limit, period.base_budget.recurs]).sort())
    .toEqual(MANIFEST.budgets
      .filter((figure) => !figure.isIncome && Number(figure.budgeted) > 0)
      .map((figure) => [figure.category, figure.month, Number(figure.budgeted), false])
      .sort())
})
