import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { commitImport, openPage, logInViaApi } from '../support/app'

// Runs on desktop only: the amounts' digits are the same at every size, and it reads every layout
// the list draws

const CASES = [
  { currency: 'JPY', large: '9007199254740993', small: '1', digits: '9,007,199,254,740,993', smallDigits: '1' },
  { currency: 'CAD', large: '90071992547409.93', small: '0.01', digits: '90,071,992,547,409.93', smallDigits: '0.01' },
  { currency: 'IQD', large: '9007199254740.993', small: '0.001', digits: '9,007,199,254,740.993', smallDigits: '0.001' },
] as const

for (const example of CASES) {
  test(`preserves exact ${example.currency} CSV preview digits and decimal submission`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: example.currency })
    const account = await createAccount(request, user, { name: 'Exact import account', currency: example.currency })
    await logInViaApi(page, user)
    await openPage(page, `/settings/imports?account=${account.id}`)
    await expect(page.getByRole('heading', { name: 'Import transactions', exact: true })).toBeVisible()

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

    const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) })
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
      await expect(amount.filter({ visible: true })).toHaveText(expected[index])
      expect(new Set(await amount.allTextContents())).toEqual(new Set([expected[index]]))
    }

    const submitted: { dt: string; amount: string }[] = []
    page.on('request', (sent) => {
      if (sent.method() === 'POST' && /\/transactions\/import\/runs\/[^/]+\/rows$/.test(sent.url())) {
        const batch = sent.postDataJSON() as { rows: typeof submitted }
        submitted.push(...batch.rows)
      }
    })
    const response = await commitImport(page)
    expect(response.status()).toBe(201)
    expect((await response.json() as { transactions_created: number }).transactions_created).toBe(4)
    expect(submitted.map((row) => row.amount)).toEqual(amounts)
    expect(submitted.map((row) => row.dt)).toEqual(['2024-03-15', '2024-03-16', '2024-03-17', '2024-03-18'])
  })
}
