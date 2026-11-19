// The transaction filter refuses a start 20 or more years back with no end on the transactions page. There the summary
// above the list counts up to today. An account's own list and the Link a refund dialogue have no summary and take the
// same date. Runs on desktop, plus one step at a 390 by 844 phone width for the sheet the filter becomes below 750px.
// That sheet takes the check through its own props
import { expect, test, type Locator } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { openFilters, selectFacet } from '../support/filters'

// More than 20 years before any day the suite can run on
const FROM = { year: '2000', month: '01', day: '01' }

async function typeFrom(scope: Locator) {
  const field = scope.getByRole('group', { name: 'From', exact: true })
  await field.getByRole('textbox', { name: 'Year', exact: true }).fill(FROM.year)
  await field.getByRole('textbox', { name: 'Month', exact: true }).fill(FROM.month)
  await field.getByRole('textbox', { name: 'Day', exact: true }).fill(FROM.day)
}

test('refuses a start over 20 years back only where a summary sits above the list', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3713, date: daysFromTodayInTestTimezone(-6) })
  await createTransaction(request, user, { ...row, amount: 2000, date: daysFromTodayInTestTimezone(-2) })
  await logInViaApi(page, user)

  await test.step('the transactions page holds Apply and says the summary counts up to today', async () => {
    await openPage(page, '/transactions')
    const panel = await openFilters(page, 'Transaction')
    await selectFacet(page, panel, 'Date')
    await typeFrom(panel)
    await expect(panel.getByRole('alert')).toHaveText('Can cover at most 20 years up to today')
    await expect(panel.getByRole('button', { name: 'Apply filters', exact: true })).toHaveAttribute('aria-disabled', 'true')
  })

  await test.step('an account\'s own list applies the same date', async () => {
    await openPage(page, `/accounts/${account.id}`)
    const panel = await openFilters(page, 'Transaction')
    await selectFacet(page, panel, 'Date')
    await typeFrom(panel)
    await expect(panel.getByRole('alert')).toHaveCount(0)
    const apply = panel.getByRole('button', { name: 'Apply filters', exact: true })
    await expect(apply).not.toHaveAttribute('aria-disabled', 'true')
    await apply.click()
    await expect(page.getByRole('button', { name: 'Transaction filters', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  await test.step('the Link a refund dialogue applies the same date', async () => {
    await openPage(page, `/accounts/${account.id}`)
    await page.getByTestId(`transaction-row-${expenseId}`).click()
    await page.getByRole('dialog', { name: 'Edit transaction', exact: true }).getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
    await picker.getByRole('button', { name: 'Transaction filters', exact: true }).click()
    await picker.getByRole('tab', { name: 'Date', exact: true }).click()
    await typeFrom(picker)
    await expect(picker.getByRole('alert')).toHaveCount(0)
    const apply = picker.getByRole('button', { name: 'Apply filters', exact: true })
    await expect(apply).not.toHaveAttribute('aria-disabled', 'true')
    await apply.click()
    await expect(picker.getByRole('button', { name: 'Transaction filters', exact: true })).toHaveAttribute('aria-expanded', 'false')
  })

  await test.step('the transactions page filter sheet at phone width holds Apply the same way', async () => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, '/transactions')
    const sheet = await openFilters(page, 'Transaction')
    await selectFacet(page, sheet, 'Date')
    await typeFrom(sheet)
    await expect(sheet.getByRole('alert')).toHaveText('Can cover at most 20 years up to today')
    await expect(sheet.getByRole('button', { name: 'Apply filters', exact: true })).toHaveAttribute('aria-disabled', 'true')
  })
})
