// A date in the transactions page's address that the filter panel refuses, such as one typed by hand outside the
// window every date must sit in. Nothing is filtered by it, so the list and the summary load as usual, and the
// panel shows the date on its field with the error it gives a typed one. Runs on the desktop project, with one
// step at a phone width for the sheet's own Apply rule
import { expect, test, type Response } from '@playwright/test'

import { signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { openFilters } from '../support/filters'

test('leaves a refused address date unapplied and shows it in the filter panel with its error', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  const loadFailure = page.getByText('Unable to load transactions.', { exact: true })
  const summaryFailure = page.getByRole('alert').filter({ hasText: 'Transaction summary could not load' })

  // Every list read asks for no date at all, and the server answers each. With neither date applied, both steps
  // ask the same question, so the second is answered from the first's result without a read of its own
  const listReads: string[] = []
  page.on('response', (response: Response) => {
    const url = new URL(response.url())
    // The page's own address ends the same way, so only the app's data requests count
    if (response.request().resourceType() === 'fetch' && url.pathname.endsWith('/transactions')) {
      listReads.push(`${response.status()} ${url.search}`)
    }
  })

  // The second day of the year after the one ten years ahead is past the window in every timezone, even on the
  // last day of a year
  const year = Number(todayInTestTimezone().slice(0, 4))
  for (const { address, field, yearValue, message } of [
    { address: `to_date=${year + 11}-01-02`, field: 'To', yearValue: String(year + 11), message: /^Must be within ten years of today$/ },
    { address: 'from_date=1850-01-01', field: 'From', yearValue: '1850', message: /^Must be on or after .*1900$/ },
  ]) {
    await test.step(`the ${field} date`, async () => {
      await openPage(page, `/transactions?${address}`)
      await expect.poll(() => listReads.length).toBeGreaterThan(0)
      await expect(loadFailure).toHaveCount(0)
      await expect(summaryFailure).toHaveCount(0)

      const panel = await openFilters(page, 'Transaction')
      // The refused date is in the draft, so the Date tab's name carries its count badge
      await panel.getByRole('tab', { name: /^Date\s*1$/ }).click()
      const yearField = panel.getByRole('group', { name: field, exact: true }).getByRole('textbox', { name: 'Year', exact: true })
      await expect(yearField).toHaveValue(yearValue)
      await expect(yearField).toHaveAttribute('aria-invalid', 'true')
      await expect(panel.locator(`[id="${await yearField.getAttribute('aria-describedby')}"]`)).toHaveText(message)
      await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toBeDisabled()
      expect(listReads.filter((read) => !read.startsWith('200 ') || /(from|to)_date=/.test(read))).toEqual([])
    })
  }

  await test.step('clearing the refused date on a phone', async () => {
    // The phone's sheet holds Apply off while nothing differs from what is applied, so it must count the
    // refused date as a starting value, or clearing it would change nothing it could apply
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, '/transactions?from_date=1850-01-01')
    const sheet = await openFilters(page, 'Transaction')
    await sheet.getByRole('combobox', { name: 'Filters', exact: true }).click()
    await sheet.getByRole('option', { name: /^Date/ }).click()
    const from = sheet.getByRole('group', { name: 'From', exact: true })
    for (const part of ['Year', 'Month', 'Day']) await from.getByRole('textbox', { name: part, exact: true }).fill('')
    const apply = sheet.getByRole('button', { name: 'Apply filters', exact: true })
    await expect(apply).toBeEnabled()
    await apply.click()
    await expect(page).toHaveURL(/\/transactions$/)
  })
})
