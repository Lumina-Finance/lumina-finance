import { expect, test } from '@playwright/test'

import { createAccount, TEST_PASSWORD, TEST_TIMEZONE, type TestUser } from '../support/api'
import { openPage, expectSignedIn, logIn } from '../support/app'
import { API_BASE_URL } from '../support/target'

const CASES = [
  { currency: 'JPY', large: '9007199254740993', small: '1', digits: '9,007,199,254,740,993', smallDigits: '1' },
  { currency: 'CAD', large: '90071992547409.93', small: '0.01', digits: '90,071,992,547,409.93', smallDigits: '0.01' },
  { currency: 'IQD', large: '9007199254740.993', small: '0.001', digits: '9,007,199,254,740.993', smallDigits: '0.001' },
] as const

for (const example of CASES) {
  test(`preserves exact ${example.currency} CSV preview digits and decimal submission`, async ({ page, request }) => {
    const email = `e2e-exact-${crypto.randomUUID()}@example.com`
    const signup = await request.post(`${API_BASE_URL}/auth/signup`, {
      data: {
        email, password: TEST_PASSWORD, first_name: 'Exact', tz: TEST_TIMEZONE, base_currency: example.currency,
      },
    })
    expect(signup.status()).toBe(201)
    const auth = await signup.json() as { access_token: string }
    const user: TestUser = { email, password: TEST_PASSWORD, firstName: 'Exact', accessToken: auth.access_token }
    const account = await createAccount(request, user, { name: 'Exact import account', currency: example.currency })
    await logIn(page, user)
    await expectSignedIn(page)
    await openPage(page, `/settings/imports?account=${account.id}`)
    await expect(page.getByRole('heading', { name: 'Import Transactions', exact: true })).toBeVisible()

    const amounts = [`-${example.large}`, example.large, `-${example.small}`, example.small]
    const csv = [
      'Date,Amount,Category,Merchant,Notes',
      `2024-03-15,${amounts[0]},Groceries,Unknown,Exact large out`,
      `2024-03-16,${amounts[1]},Salary,Unknown,Exact large in`,
      `2024-03-17,${amounts[2]},Groceries,Unknown,Exact small out`,
      `2024-03-18,${amounts[3]},Salary,Unknown,Exact small in`,
    ].join('\n')
    const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
    await expect(upload).toBeEnabled()
    await upload.setInputFiles({ name: 'exact-amounts.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

    const preview = page.locator('section').filter({ has: page.getByText('Imported Data Preview', { exact: true }) })
    await expect(preview).toBeVisible()
    // Only currency placement comes from Intl; the expected financial digits are literal fixtures
    const magnitudes = await page.evaluate(({ currency, digits, smallDigits }) => {
      const parts = new Intl.NumberFormat(navigator.language, {
        style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).formatToParts(0n)
      const place = (numeric: string) => parts.map((part) => part.type === 'integer' ? numeric : part.value).join('')
      return { large: place(digits), small: place(smallDigits) }
    }, example)
    const expected = [`-${magnitudes.large}`, `+${magnitudes.large}`, `-${magnitudes.small}`, `+${magnitudes.small}`]
    const rows = preview.getByTestId(/^transaction-row-import-preview-/)
    await expect(rows).toHaveCount(4)
    for (let index = 0; index < expected.length; index += 1) {
      const amount = rows.nth(index).getByTestId('transaction-amount')
      await expect(amount).toHaveCount(3)
      await expect(amount.filter({ visible: true })).toHaveText(expected[index])
      expect(await amount.allTextContents()).toEqual([expected[index], expected[index], expected[index]])
    }

    const submitted: { dt: string; amount: string }[] = []
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && /\/transactions\/import\/runs\/[^/]+\/rows$/.test(sent.url())) {
        const batch = sent.postDataJSON() as { rows: typeof submitted }
        submitted.push(...batch.rows)
      }
    })
    const commit = page.getByRole('button', { name: 'Commit import', exact: true })
    await expect(commit).toBeEnabled()
    const committed = page.waitForResponse((response) => response.request().method() === 'POST'
      && /\/transactions\/import\/runs\/[^/]+\/commit$/.test(response.url()))
    await commit.click()
    const response = await committed
    expect(response.status()).toBe(201)
    expect((await response.json() as { transactions_created: number }).transactions_created).toBe(4)
    expect(submitted.map((row) => row.amount)).toEqual(amounts)
    expect(submitted.map((row) => row.dt)).toEqual(['2024-03-15', '2024-03-16', '2024-03-17', '2024-03-18'])
  })
}
