import { expect, test } from '@playwright/test'

import {
  budgetPeriodStart,
  createAccount,
  createMonthlyBudget,
  createTransaction,
  signUpUser,
} from '../support/api'
import { logIn, openModal } from '../support/app'
import { expectPendingAction, whileApiRequestHeld } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

test('counts seeded spending against the budget limit', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })

  // Read once and used for both, so a run that crosses midnight into the first of a month
  // cannot anchor the period to one month and the spending to the next
  const periodStart = budgetPeriodStart()

  const id = await createMonthlyBudget(request, user, {
    name: 'Monthly Food',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart,
  })

  // Dated where the period starts, so both fall inside it whatever day the suite runs. A
  // transaction outside the period is not counted and not complained about, which would leave
  // the card reading $0.00 used and the assertion below blaming the total
  for (const amount of [-4250, -1000]) {
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount,
      date: periodStart,
    })
  }

  await logIn(page, user)
  await page.goto('/budgets')

  const card = page.getByTestId(`budget-card-${id}`)
  await expect(card).toHaveRole('button')
  await expect(card).toHaveAccessibleName(/Monthly Food/)
  await expect(card.getByRole('heading', { name: 'Monthly Food' })).toBeVisible()
  await expect(card.getByText('$52.50 used of $500.00')).toBeVisible()
})

test('keeps budget actions named during creation and editing', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logIn(page, user)
  await page.goto('/budgets')
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
