import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { API_BASE_URL } from '../support/target'

const DATE_CASES = [
  { profileZone: 'UTC', browserZone: 'Asia/Tokyo', dates: ['2024-03-15', '2024-03-15', '2024-03-18', '2024-03-18', '2024-03-19'] },
  { profileZone: 'America/Toronto', browserZone: 'UTC', dates: ['2024-03-14', '2024-03-15', '2024-03-17', '2024-03-18', '2024-03-19'] },
  { profileZone: 'Asia/Tokyo', browserZone: 'UTC', dates: ['2024-03-15', '2024-03-16', '2024-03-18', '2024-03-18', '2024-03-19'] },
]
const AMOUNTS = ['-12.34', '-23.45', '-34.56', '-45.67', '-56.78']
const TIMESTAMP_HELP = 'Timestamps with a timezone are converted to the timezone in your profile before the date is imported. Dates and timestamps without a timezone keep their calendar date.'
const CSV = [
  'Date,Amount,Category,Merchant,Notes',
  '2024-03-15T00:30:00Z,-12.34,Groceries,Unknown,ISO case 1',
  '2024-03-16T00:30:00+09:00,-23.45,Groceries,Unknown,ISO case 2',
  '2024-03-17T23:30:00-04:00,-34.56,Groceries,Unknown,ISO case 3',
  '2024-03-18,-45.67,Groceries,Unknown,ISO case 4',
  '2024-03-19T00:30:00,-56.78,Groceries,Unknown,ISO case 5',
].join('\n')

for (const { profileZone, browserZone, dates } of DATE_CASES) {
  test.describe(`import dates in profile timezone ${profileZone}`, () => {
    test.use({ timezoneId: browserZone })

    test('previews and commits timestamps in the profile timezone rather than the browser timezone', async ({ page, request }) => {
      const user = await signUpUser(request)
      const headers = { Authorization: `Bearer ${user.accessToken}` }
      const zone = await request.patch(`${API_BASE_URL}/me`, { headers, data: { tz: profileZone } })
      expect(zone.status()).toBe(200)
      const account = await createAccount(request, user, { name: 'Timestamp import account' })
      await logIn(page, user)
      await expectSignedIn(page)
      await page.goto(`/settings/imports?account=${account.id}`)
      await expect(page.getByRole('heading', { name: 'Import Transactions', exact: true })).toBeVisible()
      const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
      await expect(upload).toBeEnabled()
      await upload.setInputFiles({ name: 'iso-dates.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

      const dateFormat = page.getByRole('combobox', { name: 'Date format', exact: true })
      await expect(dateFormat).toHaveText('ISO date/time (2026-04-30T12:00:00Z)')
      const info = page.getByRole('button', { name: 'How timestamp dates are imported', exact: true })
      await expect(info).toBeVisible()
      const formatBounds = await dateFormat.boundingBox()
      const infoBounds = await info.boundingBox()
      expect(formatBounds).not.toBeNull()
      expect(infoBounds).not.toBeNull()
      expect(infoBounds!.x).toBeGreaterThanOrEqual(formatBounds!.x + formatBounds!.width)
      expect(Math.abs(infoBounds!.y + infoBounds!.height / 2 - formatBounds!.y - formatBounds!.height / 2)).toBeLessThan(2)
      await info.click()
      const help = page.getByText(TIMESTAMP_HELP, { exact: true })
      await expect(help).toBeVisible()
      await info.click()
      const commit = page.getByRole('button', { name: 'Commit import', exact: true })
      await expect(commit).toBeEnabled()

      await dateFormat.click()
      await page.getByRole('option', { name: /^Year first \(2026-04-30\)/ }).click()
      await expect(commit).toBeDisabled()
      await expect(info).toHaveCount(0)
      await expect(page.getByText('The date does not match the date format chosen above.', { exact: true }).first()).toBeVisible()
      await dateFormat.click()
      await page.getByRole('option', { name: /^ISO date\/time \(2026-04-30T12:00:00Z\)/ }).click()
      await expect(commit).toBeEnabled()

      // ImportStep renders its title in a paragraph directly inside the enclosing section
      const preview = page.locator('section').filter({
        has: page.getByText('Imported Data Preview', { exact: true }),
      })
      await expect(preview).toBeVisible()
      for (const day of new Set(dates.map((date) => Number(date.slice(-2))))) {
        await expect(preview.getByText(`March ${day}, 2024`, { exact: true })).toBeVisible()
      }
      for (const amount of ['12.34', '23.45', '34.56', '45.67', '56.78']) {
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
      expect((await response.json() as { transactions_created: number }).transactions_created).toBe(5)
      expect(submitted.map((row) => row.dt)).toEqual(dates)
      expect(submitted.map((row) => row.amount)).toEqual(AMOUNTS)
      expect(submitted.map((row) => row.notes)).toEqual([1, 2, 3, 4, 5].map((index) => `ISO case ${index}`))
      expect(submitted.every((row) => row.category_source === 'Groceries')).toBe(true)

      const stored = await request.get(`${API_BASE_URL}/transactions?account_id=${account.id}`, { headers })
      expect(stored.status()).toBe(200)
      const transactions = await stored.json() as { dt: string; amount: number; currency: string; notes: string }[]
      transactions.sort((left, right) => left.notes.localeCompare(right.notes))
      expect(transactions.map((row) => row.dt)).toEqual(dates)
      expect(transactions.map((row) => row.amount)).toEqual([-1234, -2345, -3456, -4567, -5678])
      expect(transactions.every((row) => row.currency === 'CAD')).toBe(true)

      await page.goto(`/settings/imports?account=${account.id}`)
      await expect(upload).toBeEnabled()
      await upload.setInputFiles({
        name: 'invalid-timestamp.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from('Date,Amount,Category,Merchant\n2024-03-15T24:00:00Z,-12.34,Groceries,Unknown'),
      })
      await page.getByRole('combobox', { name: 'Match To App Field Date', exact: true }).click()
      await page.getByRole('option', { name: 'Date Transaction date.', exact: true }).click()
      await dateFormat.click()
      await page.getByRole('option', { name: /^ISO date\/time \(2026-04-30T12:00:00Z\)/ }).click()
      await expect(commit).toBeDisabled()
      await expect(info).toHaveCount(0)
      const dateRow = page.getByRole('row').filter({ has: dateFormat })
      const warning = dateRow.getByRole('button', { name: /Expected valid dates/i })
      await expect(warning).toBeVisible()
      await warning.click()
      await expect(dateRow.getByText(/Expected valid dates/i)).toBeVisible()
    })
  })
}
