import { expect, test, type Locator } from '@playwright/test'

import {
  budgetPeriodStart,
  createAccount,
  createMonthlyBudget,
  createTransaction,
  signUpUser,
} from '../support/api'
import { openPage, logIn, openModal } from '../support/app'
import { expectPendingAction, whileApiRequestHeld } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// Format stored calendar dates without applying the test runner's own timezone
const PERIOD_DATE = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC',
})

/** Assert spending and limit in the same historical period across its two responsive layouts */
async function expectHistoricalPeriod(dialog: Locator, label: string): Promise<void> {
  const history = dialog.getByRole('heading', { name: 'Period history', exact: true }).locator('..')
  const periodLabel = history.getByText(label, { exact: true }).filter({ visible: true })
  await expect(periodLabel).toBeVisible()
  const row = history.getByRole('row').filter({ hasText: label })
  if (await row.isVisible()) {
    await expect(history.getByRole('columnheader', { name: 'Used', exact: true })).toBeVisible()
    await expect(history.getByRole('columnheader', { name: 'Budgeted', exact: true })).toBeVisible()
    await expect(row.getByRole('cell').nth(1)).toHaveText('$52.50')
    await expect(row.getByRole('cell').nth(2)).toHaveText('$500.00')
  } else {
    const card = periodLabel.locator('..').locator('..')
    await expect(card.getByText('Used', { exact: true }).locator('..').getByText('$52.50', { exact: true })).toBeVisible()
    await expect(card.getByText('Budgeted', { exact: true }).locator('..').getByText('$500.00', { exact: true })).toBeVisible()
  }
}

test('preserves seeded budget history across a month boundary', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })

  // Seed a completed period whose history is independent of the latest period on the card
  const periodStart = budgetPeriodStart()
  const [year, month] = periodStart.split('-').map(Number)
  const periodEnd = new Date(Date.UTC(year, month, 0, 12))
  const nextMonth = new Date(Date.UTC(year, month, 1, 12))
  const periodLabel = `${PERIOD_DATE.format(new Date(`${periodStart}T12:00:00Z`))} - ${PERIOD_DATE.format(periodEnd)}`

  const id = await createMonthlyBudget(request, user, {
    name: 'Monthly Food',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart,
  })

  // Both transactions belong to the exact historical period asserted below
  for (const amount of [-4250, -1000]) {
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount,
      date: periodStart,
    })
  }

  await logIn(page, user)
  for (const date of [periodEnd, nextMonth]) {
    // Date changes while timers continue normally, and navigation remounts the backfill hook
    await page.clock.setFixedTime(date)
    await openPage(page, '/budgets')
    const card = page.getByTestId(`budget-card-${id}`)
    await expect(card).toHaveRole('button')
    await expect(card).toHaveAccessibleName(/Monthly Food/)
    // The server also creates elapsed recurring periods, so the latest card is not this history
    await expect(card.getByText('$0.00 used of $500.00', { exact: true })).toBeVisible()
    await card.click()
    await expectHistoricalPeriod(page.getByRole('dialog', { name: 'Monthly Food', exact: true }), periodLabel)
  }
})

test('keeps budget actions named during creation and editing', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logIn(page, user)
  await openPage(page, '/budgets')
  const name = 'Selectors budget'
  const dialog = await openModal(page, ['New Budget'], 'Add Budget')
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByLabel('Limit', { exact: true }).fill('500')
  await dialog.getByRole('button', { name: 'Groceries', exact: true }).click()
  const submit = dialog.getByTestId('budget-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Create Budget')
  const created = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/base-budgets`
    && response.request().method() === 'POST'
    && (response.request().postDataJSON() as { name?: string }).name === name)
  await whileApiRequestHeld(page, 'POST', '/base-budgets',
    () => submit.click(), () => expectPendingAction(submit, 'Create Budget'), { name })
  const response = await created
  expect(response.status()).toBe(201)
  const { id } = (await response.json()) as { id: string }
  await expect(dialog).toBeHidden()

  const card = page.getByTestId(`budget-card-${id}`)
  await expect(card).toHaveRole('button')
  await expect(card).toHaveAccessibleName(/Selectors budget/)
  await expect(card.getByText('$0.00 used of $500.00', { exact: true })).toBeVisible()
  await card.focus()
  await card.press('Enter')
  const details = page.getByRole('dialog', { name, exact: true })
  await expect(details).toBeVisible()
  await details.getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit Budget', exact: true })
  await edit.getByLabel('Name', { exact: true }).fill('Selectors budget edited')
  const save = edit.getByTestId('budget-submit')
  await expect(save).toHaveRole('button')
  await expect(save).toHaveAccessibleName('Save Changes')
  await expect(save).toBeEnabled()
  await whileApiRequestHeld(page, 'PATCH', `/base-budgets/${id}`,
    () => save.click(), () => expectPendingAction(save, 'Save Changes'))
  await expect(edit).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Selectors budget edited', exact: true })).toBeVisible()
})
