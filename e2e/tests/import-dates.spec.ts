import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { API_BASE_URL } from '../support/target'

const DATES = ['2024-03-15', '2024-03-16', '2024-03-17', '2024-03-18']
const AMOUNTS = ['-12.34', '-23.45', '-34.56', '-45.67']
const CSV = [
  'Date,Amount,Category,Merchant,Notes',
  '2024-03-15T00:30:00Z,-12.34,Groceries,Unknown,ISO case 1',
  '2024-03-16T00:30:00+09:00,-23.45,Groceries,Unknown,ISO case 2',
  '2024-03-17T23:30:00-04:00,-34.56,Groceries,Unknown,ISO case 3',
  '2024-03-18,-45.67,Groceries,Unknown,ISO case 4',
].join('\n')

for (const timezoneId of ['UTC', 'America/Toronto', 'Asia/Tokyo']) {
  test.describe(`written import dates in ${timezoneId}`, () => {
    test.use({ timezoneId })

    test('previews and commits the written day of mixed ISO dates and timestamps', async ({ page, request }) => {
      const user = await signUpUser(request)
      const headers = { Authorization: `Bearer ${user.accessToken}` }
      const zone = await request.patch(`${API_BASE_URL}/me`, { headers, data: { tz: timezoneId } })
      expect(zone.status()).toBe(200)
      const account = await createAccount(request, user, { name: 'Written-date import account' })
      await logIn(page, user)
      await expectSignedIn(page)
      await page.goto(`/settings/imports?account=${account.id}`)
      await expect(page.getByRole('heading', { name: 'Import Transactions', exact: true })).toBeVisible()
      const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
      await expect(upload).toBeEnabled()
      await upload.setInputFiles({ name: 'iso-dates.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

      const dateFormat = page.getByRole('combobox', { name: 'Date format', exact: true })
      await expect(dateFormat).toHaveText('ISO date or timestamp (2026-04-30T00:30:00Z)')
      const help = page.getByText('Uses the date written before T. The time and timezone do not move it to another day', { exact: true })
      await expect(help).toBeVisible()
      const commit = page.getByRole('button', { name: 'Commit import', exact: true })
      await expect(commit).toBeEnabled()

      await dateFormat.click()
      await page.getByRole('option', { name: /^Year first \(2026-04-30\)/ }).click()
      await expect(commit).toBeDisabled()
      await expect(page.getByText('The date does not match the date format chosen above.', { exact: true }).first()).toBeVisible()
      await dateFormat.click()
      await page.getByRole('option', { name: /^ISO date or timestamp \(2026-04-30T00:30:00Z\)/ }).click()
      await expect(commit).toBeEnabled()

      // ImportStep renders its title in a paragraph directly inside the enclosing section
      const preview = page.locator('section').filter({
        has: page.getByText('Imported Data Preview', { exact: true }),
      })
      await expect(preview).toBeVisible()
      for (const day of [15, 16, 17, 18]) {
        await expect(preview.getByText(`March ${day}, 2024`, { exact: true })).toBeVisible()
      }
      for (const amount of ['12.34', '23.45', '34.56', '45.67']) {
        await expect(preview.getByText(`-$${amount}`, { exact: true }).filter({ visible: true })).toBeVisible()
      }

      const submitted: { dt: string; amount: string; notes: string; category_source: string }[] = []
      page.on('request', (sent) => {
        if (sent.method() === 'POST' && /\/transactions\/import\/runs\/[^/]+\/rows$/.test(sent.url())) {
          const batch = sent.postDataJSON() as { rows: typeof submitted }
          submitted.push(...batch.rows)
        }
      })
      const committed = page.waitForResponse((response) =>
        response.request().method() === 'POST'
        && /\/transactions\/import\/runs\/[^/]+\/commit$/.test(response.url()))
      await commit.click()
      const response = await committed
      expect(response.status()).toBe(201)
      expect((await response.json() as { transactions_created: number }).transactions_created).toBe(4)
      expect(submitted.map((row) => row.dt)).toEqual(DATES)
      expect(submitted.map((row) => row.amount)).toEqual(AMOUNTS)
      expect(submitted.map((row) => row.notes)).toEqual([1, 2, 3, 4].map((index) => `ISO case ${index}`))
      expect(submitted.every((row) => row.category_source === 'Groceries')).toBe(true)

      const stored = await request.get(`${API_BASE_URL}/transactions?account_id=${account.id}`, { headers })
      expect(stored.status()).toBe(200)
      const transactions = await stored.json() as { dt: string; amount: number; currency: string; notes: string }[]
      transactions.sort((left, right) => left.notes.localeCompare(right.notes))
      expect(transactions.map((row) => row.dt)).toEqual(DATES)
      expect(transactions.map((row) => row.amount)).toEqual([-1234, -2345, -3456, -4567])
      expect(transactions.every((row) => row.currency === 'CAD')).toBe(true)
    })
  })
}
