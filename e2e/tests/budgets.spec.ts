import { expect, test, type Locator } from '@playwright/test'

import {
  asUser,
  budgetPeriodStart,
  createAccount,
  createMonthlyBudget,
  createTransaction,
  signUpUser,
} from '../support/api'
import { openPage, logInViaApi, openModal, readScrollingBox, readSettledScrollingBox } from '../support/app'
import { expectPendingAction, whileApiRequestHeld } from '../support/selectors'
import { API_BASE_URL } from '../support/target'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop only, apart from the month boundary and Edit budget buttons tests, which run at
// every size: the period history turns from a table into cards, and the buttons into halves on a
// phone. The tests of a refused Create budget set each size they check themselves, and so does the
// first Edit budget category test, which widens to 393 once the dialog is open so the categories stack
// below the first fields (the details dialog's Edit button is covered when opened at that width)

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

test('preserves seeded budget history across a month boundary', AT_EVERY_SIZE, async ({ page, request }) => {
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

  await logInViaApi(page, user)
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
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  const name = 'Selectors budget'
  const dialog = await openModal(page, ['New budget'], 'Add budget')
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByLabel('Limit', { exact: true }).fill('500')
  await dialog.getByRole('button', { name: 'Groceries', exact: true }).click()
  const submit = dialog.getByTestId('budget-submit')
  await expect(submit).toHaveRole('button')
  await expect(submit).toHaveAccessibleName('Create budget')
  const created = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/base-budgets`
    && response.request().method() === 'POST'
    && (response.request().postDataJSON() as { name?: string }).name === name)
  await whileApiRequestHeld(page, 'POST', '/base-budgets',
    () => submit.click(), () => expectPendingAction(submit, 'Create budget'), { name })
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
  const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })
  await edit.getByLabel('Name', { exact: true }).fill('Selectors budget edited')
  const save = edit.getByTestId('budget-submit')
  await expect(save).toHaveRole('button')
  await expect(save).toHaveAccessibleName('Save changes')
  await expect(save).toBeEnabled()
  await whileApiRequestHeld(page, 'PATCH', `/base-budgets/${id}`,
    () => save.click(), () => expectPendingAction(save, 'Save changes'))
  await expect(edit).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Selectors budget edited', exact: true })).toBeVisible()
})

test('shows the Edit budget Cancel and Save changes buttons in one row, as halves on a phone', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, {
    name: 'Footer budget',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart: budgetPeriodStart(),
  })
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.getByTestId(`budget-card-${id}`).click()
  await page.getByRole('dialog', { name: 'Footer budget', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })
  // Both read in one go, since the dialog may still be sliding in
  const [cancel, save] = await edit.getByTestId('budget-submit').evaluate((submit) => {
    const cancelButton = [...submit.parentElement!.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!
    return [cancelButton.getBoundingClientRect().toJSON(), submit.getBoundingClientRect().toJSON()] as DOMRect[]
  })

  // One row, Cancel first, and below the width where both sit together at the right, two equal halves
  expect(Math.abs(save.y - cancel.y)).toBeLessThan(2)
  expect(cancel.x).toBeLessThan(save.x)
  if (page.viewportSize()!.width < 640) expect(Math.abs(save.width - cancel.width)).toBeLessThan(2)
})

const NO_CATEGORY_MESSAGE = 'Select at least one category'

test('explains the disabled Save changes of Edit budget as soon as the last category is deselected', async ({ page, request }) => {
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, {
    name: 'Two categories',
    categoryNames: ['Groceries', 'Dining'],
    overallLimit: 50_000,
    periodStart: budgetPeriodStart(),
  })
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.getByTestId(`budget-card-${id}`).click()
  await page.getByRole('dialog', { name: 'Two categories', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })

  // Resized once the dialog is open, so the stacked layout puts the categories below the first fields
  await page.setViewportSize({ width: 393, height: 852 })
  const save = edit.getByTestId('budget-submit')
  const message = edit.getByText(NO_CATEGORY_MESSAGE, { exact: true })
  const groceries = edit.getByRole('button', { name: /Groceries/ })
  const dining = edit.getByRole('button', { name: /Dining/ })

  // Nothing is refused while a category is still chosen
  await expect(message).toHaveCount(0)
  await groceries.click()
  await expect(message).toHaveCount(0)

  // The last one going says why Save changes is disabled, in view beside the categories
  await dining.click()
  await expect(save).toBeDisabled()
  await expect(message).toBeInViewport({ ratio: 1 })
  await expect(edit.getByPlaceholder('Search categories...', { exact: true })).toHaveAccessibleDescription(NO_CATEGORY_MESSAGE)

  await groceries.click()
  await expect(message).toHaveCount(0)
  await expect(save).toBeEnabled()
})

test('numbers the Edit budget sections in the order they read, on desktop and on a phone', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, {
    name: 'Numbered sections',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart: budgetPeriodStart(),
  })
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.getByTestId(`budget-card-${id}`).click()
  await page.getByRole('dialog', { name: 'Numbered sections', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })
  await expect(edit).toBeVisible()

  // The page order is Scope, Cadence, Archive, then Tracked categories, so the numbers must count up in it
  await expect(edit.getByText(/^0[1-9]$/)).toHaveText(['01', '02', '03', '04'])
})

test('leaves the Edit budget of an archived budget without a category message', async ({ page, request }) => {
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, {
    name: 'Archived budget',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart: budgetPeriodStart(),
  })
  const archived = await request.patch(`${API_BASE_URL}/base-budgets/${id}`, {
    headers: asUser(user),
    data: { is_archived: true },
  })
  expect(archived.status()).toBe(200)
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  await page.getByRole('button', { name: /Archived budgets/ }).click()
  await page.getByTestId(`budget-card-${id}`).click()
  await page.getByRole('dialog', { name: 'Archived budget', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Edit budget', exact: true })

  await expect(edit.getByText('Unarchive this budget to edit its details.', { exact: true })).toBeVisible()
  await expect(edit.getByText(NO_CATEGORY_MESSAGE, { exact: true })).toHaveCount(0)
})

// On a phone the dialog's fields stack in one column, so the categories sit below what the dialog shows
// first, and on a laptop everything fits
const REFUSED_CREATE_SIZES = [
  { width: 393, height: 852, startsOutOfView: true },
  { width: 390, height: 667, startsOutOfView: true },
  { width: 1280, height: 800, startsOutOfView: false },
]

const PHONE_SIZE = { width: 393, height: 852 }

test('brings the missing category message into view when Create budget is refused', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)

  for (const { startsOutOfView, ...size } of REFUSED_CREATE_SIZES) {
    const at = `${size.width}×${size.height}`
    await page.setViewportSize(size)
    await openPage(page, '/budgets')
    const dialog = await openModal(page, ['New budget'], 'Add budget')
    await dialog.getByLabel('Name', { exact: true }).fill('Groceries budget')
    await dialog.getByLabel('Limit', { exact: true }).fill('500')
    const search = dialog.getByPlaceholder('Search categories...', { exact: true })
    if (startsOutOfView) await expect(search, `search at ${at} before`).not.toBeInViewport()

    await dialog.getByTestId('budget-submit').click()

    // The scrolling body ends at the footer, so a message under the footer is cut off and not on screen
    const message = dialog.getByText('Select at least one category', { exact: true })
    await expect.soft(message, `message at ${at}`).toBeInViewport({ ratio: 1 })
    await expect.soft(search, `focus at ${at}`).toBeFocused()
    await expect.soft(search, `description at ${at}`).toHaveAccessibleDescription('Select at least one category')
    // Still all on screen once the message has grown to its full height and the scroll has ended
    await expect.poll(() => message.evaluate((element) => getComputedStyle(element.parentElement!).opacity)).toBe('1')
    await readSettledScrollingBox(message)
    await expect.soft(message, `message at ${at} once settled`).toBeInViewport({ ratio: 1 })
  }
})

test('shows no Name error when Add budget opens or Name is left unchanged, and shows it once a changed Name is emptied', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  const dialog = await openModal(page, ['New budget'], 'Add budget')
  const name = dialog.getByLabel('Name', { exact: true })
  const nameError = dialog.getByText('Name is required', { exact: true })

  // The dialog focuses Name, so leaving it by Tab or mouse must not flag a name nobody touched
  await expect(name).toBeFocused()
  await expect(nameError).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(name).not.toBeFocused()
  await expect(nameError).toHaveCount(0)
  await dialog.getByLabel('Limit', { exact: true }).click()
  await expect(nameError).toHaveCount(0)

  await name.fill('Groceries budget')
  await name.fill('')
  await page.keyboard.press('Tab')
  await expect(nameError).toBeVisible()
  await expect(name).toHaveAttribute('aria-invalid', 'true')

  // Create still validates every field, including the ones never visited
  await dialog.getByTestId('budget-submit').click()
  await expect(dialog.getByText('Limit must be greater than zero', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Select at least one category', { exact: true })).toBeVisible()
})

test('brings the first refused field into view when Create budget is refused for several', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.setViewportSize(PHONE_SIZE)
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  const dialog = await openModal(page, ['New budget'], 'Add budget')
  const name = dialog.getByLabel('Name', { exact: true })
  const limit = dialog.getByLabel('Limit', { exact: true })
  const search = dialog.getByPlaceholder('Search categories...', { exact: true })

  // An empty name comes first. Focusing the search scrolls the dialog down to the categories, so the
  // name starts out of sight
  await limit.fill('500')
  await search.focus()
  await expect(name).not.toBeInViewport()
  await dialog.getByTestId('budget-submit').click()
  await expect(name).toBeFocused()
  await expect(name).toHaveAccessibleDescription('Name is required')
  await expect(dialog.getByText('Name is required', { exact: true })).toBeInViewport({ ratio: 1 })

  // With the name given, an empty limit comes before the missing category
  await name.fill('Groceries budget')
  await limit.fill('')
  await search.focus()
  await expect(limit).not.toBeInViewport()
  await dialog.getByTestId('budget-submit').click()
  await expect(limit).toBeFocused()
  await expect(limit).toHaveAccessibleDescription('Limit must be greater than zero')
  await expect(dialog.getByText('Limit must be greater than zero', { exact: true })).toBeInViewport({ ratio: 1 })
})

test('creates a valid budget on a phone without scrolling the dialog', async ({ page, request }) => {
  const user = await signUpUser(request)
  await page.setViewportSize(PHONE_SIZE)
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  const dialog = await openModal(page, ['New budget'], 'Add budget')
  const name = 'Phone budget'
  await dialog.getByLabel('Name', { exact: true }).fill(name)
  await dialog.getByLabel('Limit', { exact: true }).fill('500')
  const groceries = dialog.getByRole('button', { name: 'Groceries', exact: true })
  await groceries.click()
  const before = await readScrollingBox(groceries)

  const submit = dialog.getByTestId('budget-submit')
  await whileApiRequestHeld(page, 'POST', '/base-budgets', () => submit.click(), async () => {
    await expectPendingAction(submit, 'Create budget')
    // Two frames on, so a scroll the refusal path would start a frame after the press has begun
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    }))
    expect((await readScrollingBox(groceries)).top).toBe(before.top)
  }, { name })
  await expect(dialog).toBeHidden()
})
