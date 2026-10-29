// The refund total limit, a refund unlinked in the window, the filter panel's room inside the picker and Escape over
// it. Runs on desktop only, as the sizes are covered by the visual spec
import { expect, test, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

// A refund that would take the refunds past the expense is shown with the reason and cannot be picked, counting
// the ones held in the window, and the Refund button's amount is held to what is left too
test('shows why a refund that would pass the expense cannot be picked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3000, date: daysFromTodayInTestTimezone(-5) })
  for (const [amount, daysAgo] of [[1200, 1], [2000, 2], [3100, 3]] as const) {
    await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const rows = picker.getByTestId('link-candidate')
  const candidate = (amount: string) => rows.filter({ hasText: amount })

  // More than the whole expense is refused from the start, and the rest can be picked
  await expect(candidate('$31.00')).toHaveAttribute('data-refused', 'true')
  await expect(candidate('$31.00').getByTestId('link-candidate-reason')).toHaveText('Only $30.00 is left to refund')
  // The refused row stays in the accessibility tree, marked unavailable, so a screen reader reads its reason
  await expect(candidate('$31.00').getByRole('button')).toHaveAttribute('aria-disabled', 'true')
  await expect(candidate('$31.00').getByRole('button', { name: /Only \$30\.00 is left to refund/ })).toBeVisible()
  // The refused row shows the not-allowed cursor and takes no hover fill, while a row that can be picked takes both
  const refusedRow = candidate('$31.00').locator('.app-transaction-row')
  await expect(candidate('$31.00').getByRole('button')).toHaveCSS('cursor', 'not-allowed')
  await refusedRow.hover({ force: true })
  await page.waitForTimeout(400)
  await expect(refusedRow).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await candidate('$12.00').locator('.app-transaction-row').hover()
  await expect(candidate('$12.00').locator('.app-transaction-row')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  // The reason sits inside its own row, above the row's divider, so it reads as part of the row it explains
  const rowBox = (await candidate('$31.00').locator('.app-transaction-row').boundingBox())!
  const reasonBox = (await candidate('$31.00').getByTestId('link-candidate-reason').boundingBox())!
  expect(reasonBox.y).toBeGreaterThanOrEqual(rowBox.y)
  expect(reasonBox.y + reasonBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height - 1)
  await expect(candidate('$20.00')).not.toHaveAttribute('data-refused', 'true')
  await candidate('$12.00').getByRole('button').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()

  // With $12.00 held, $18.00 is left, so $20.00 is refused too
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  await expect(rows).toHaveCount(2)
  await expect(candidate('$20.00').getByTestId('link-candidate-reason')).toHaveText('Only $18.00 is left to refund')
  await expect(candidate('$31.00').getByTestId('link-candidate-reason')).toHaveText('Only $18.00 is left to refund')
  await candidate('$20.00').getByRole('button').click({ force: true })
  await expect(picker.getByRole('button', { name: 'Link', exact: true })).toBeDisabled()
  await picker.getByRole('button', { name: 'Cancel', exact: true }).click()

  // A refund made from the window can't pass it either
  await expense.getByTestId('transaction-refund').click()
  const refund = page.getByRole('dialog', { name: 'Add refund', exact: true })
  await refund.getByTestId('transaction-submit').click()
  await expect(refund.getByText('Only $18.00 is left to refund', { exact: true }).first()).toBeVisible()
  await expect(refund).toBeVisible()
})

// The open filter panel stays inside the dialog's scrolling body with its footer buttons on screen, even with a
// long list of accounts
for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
]) {
  test(`keeps the whole filter panel inside the picker at ${size.width}x${size.height}`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    for (const name of ['Savings', 'Travel', 'Bills', 'Joint', 'Cash']) await createAccount(request, user, { name })
    const row = { accountId: account.id, categoryName: 'Groceries' }
    const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-6) })
    for (let day = 1; day <= 4; day++) {
      await createTransaction(request, user, { ...row, amount: 1000 + day * 100, date: daysFromTodayInTestTimezone(-day) })
    }

    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    await openRow(page, expenseId)
    await page.getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
    await picker.getByRole('button', { name: 'Transaction filters' }).click()

    // Everything of the panel is inside the scrolling body, from its top to its Apply button, once it has opened
    const insideBody = async () => {
      const body = await picker.locator('[data-tooltip-bounds]').boundingBox()
      const parts = [
        picker.locator('.app-range-glass'),
        picker.getByRole('button', { name: 'Apply filters' }),
        picker.getByText('No filters applied'),
      ]
      return Promise.all(
        parts.map(async (part) => {
          const box = await part.boundingBox()
          return box !== null && box.y >= body!.y - 0.5 && box.y + box.height <= body!.y + body!.height + 0.5
        }),
      )
    }
    await expect.poll(insideBody).toEqual([true, true, true])
    await expect(picker.getByRole('button', { name: 'Apply filters' })).toBeInViewport({ ratio: 1 })
  })
}

// From 750px the picker is only as tall as its rows, and opening Filters eases it taller, then back
test('fits the picker to three rows and eases its height with the filter panel', async ({ page, request }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-6) })
  for (let day = 1; day <= 3; day++) {
    await createTransaction(request, user, { ...row, amount: 1000 + day * 100, date: daysFromTodayInTestTimezone(-day) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await openRow(page, expenseId)
  // The edit window is 86vh tall, though it shrinks a little behind the picker, so its size is taken from the screen
  const screenHeight = page.viewportSize()!.height
  const editWindowHeight = screenHeight * 0.86
  await page.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await expect(picker.getByTestId('link-candidate')).toHaveCount(3)
  const height = async () => (await picker.boundingBox())!.height
  const rowsOnly = await height()
  expect(rowsOnly).toBeLessThan(editWindowHeight * 0.7 - 40)

  // The body eases its height on the app's default transition timing
  const body = picker.getByTestId('link-picker-body')
  await expect(body).toHaveCSS('transition-property', 'min-height')
  await expect(body).toHaveCSS('transition-duration', '0.3s')
  await expect(body).toHaveCSS('transition-timing-function', 'cubic-bezier(0.22, 1, 0.36, 1)')

  await picker.getByRole('button', { name: 'Transaction filters' }).click()
  await expect.poll(height).toBeGreaterThan(rowsOnly + 100)
  expect(await height()).toBeLessThanOrEqual(screenHeight * 0.84 + 1)
  await page.keyboard.press('Escape')
  await expect.poll(height).toBeLessThan(rowsOnly + 2)
})

// A refund whose link is removed in the window, but not saved yet, can be linked to an expense again, since Save
// removes the link first
test('offers expenses again to a refund unlinked in the window', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-4) })
  const refundId = await createTransaction(request, user, { ...row, amount: 1500, date: daysFromTodayInTestTimezone(-1) })
  await request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
    headers: asUser(user),
    data: { original_transaction_id: expenseId },
  })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const refund = await openRow(page, refundId)
  await refund.getByRole('button', { name: /^Unlink / }).click()
  await refund.getByRole('button', { name: 'Link to an expense', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link to an expense', exact: true })
  await expect(picker.getByTestId('link-candidate')).toHaveCount(1)
  await expect(picker.getByTestId('link-candidate-reason')).toHaveCount(0)
})

// Escape closes the topmost layer only: the open filter panel (the full-screen sheet on a phone) first, and the
// picker under it on the next press
for (const size of [
  { width: 1280, height: 800, filters: 'Transaction filters', panel: 'Apply filters' },
  { width: 390, height: 844, filters: /^Filters/, panel: 'Apply filters' },
]) {
  test(`closes the filter panel before the picker on Escape at ${size.width}x${size.height}`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    const row = { accountId: account.id, categoryName: 'Groceries' }
    const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-4) })
    await createTransaction(request, user, { ...row, amount: 1500, date: daysFromTodayInTestTimezone(-1) })

    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    await openRow(page, expenseId)
    await page.getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
    await picker.getByRole('button', { name: size.filters }).click()
    const apply = (size.width >= 750 ? picker : page).getByRole('button', { name: size.panel })
    await expect(apply).toBeVisible()
    if (size.width >= 750) await expect(picker.getByRole('button', { name: size.filters })).toHaveAttribute('aria-expanded', 'true')

    await page.keyboard.press('Escape')
    if (size.width >= 750) await expect(picker.getByRole('button', { name: size.filters })).toHaveAttribute('aria-expanded', 'false')
    else await expect(apply).toBeHidden()
    await expect(picker).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(page.getByRole('dialog', { name: 'Edit transaction', exact: true })).toBeVisible()
  })
}

