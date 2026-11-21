// The transactions page summary for a filter with only one end set. A blank From starts the summary at the first of the
// month the end falls in and a blank To ends it today, unless the From is later, so the summary never asks for a range
// that runs backwards. Runs on desktop only: the range the summary asks for is the same at every width
import { expect, test, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { openFilters, selectFacet } from '../support/filters'

/**
 * Applies a date filter with the one end given and the other left blank
 *
 * @param page - The transactions page
 * @param end - Which field to fill
 * @param ymd - The day as "YYYY-MM-DD"
 */
async function applyOneEnd(page: Page, end: 'From' | 'To', ymd: string) {
  const [year, month, day] = ymd.split('-')
  const panel = await openFilters(page, 'Transaction')
  await selectFacet(page, panel, 'Date')
  const field = panel.getByRole('group', { name: end, exact: true })
  await field.getByRole('textbox', { name: 'Year', exact: true }).fill(year)
  await field.getByRole('textbox', { name: 'Month', exact: true }).fill(month)
  await field.getByRole('textbox', { name: 'Day', exact: true }).fill(day)
  await panel.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Transaction filters', exact: true })).toHaveAttribute('aria-expanded', 'false')
}

/** Expects the summary band to show no failure and no way to retry one */
async function expectNoSummaryFailure(page: Page) {
  await expect(page.getByRole('alert').filter({ hasText: 'Transaction summary could not load' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
}

test('summarises a filter with only a To before this month up to that day', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -3713, date: '2025-01-20',
  })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  await applyOneEnd(page, 'To', '2025-01-31')

  const range = page.getByText('Showing data for Jan 1 – 31, 2025', { exact: true })
  await expect(range).toBeVisible()
  // The January expense is the summary's one most expensive transaction
  await expect(page.locator('section').filter({ has: range }).last().getByRole('button', { name: /^Edit transaction:/ })).toHaveCount(1)
  await expectNoSummaryFailure(page)
})

test('summarises a filter with only a From after today as that one day', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const tomorrow = daysFromTodayInTestTimezone(1)
  await applyOneEnd(page, 'From', tomorrow)

  const day = new Date(`${tomorrow}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
  await expect(page.getByText(`Showing data for ${day}`, { exact: true })).toBeVisible()
  await expect(page.getByText(`No transaction data for ${day}.`, { exact: true })).toBeVisible()
  await expectNoSummaryFailure(page)
})
