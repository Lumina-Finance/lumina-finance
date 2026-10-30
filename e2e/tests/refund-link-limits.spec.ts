// The refund total limit, a refund unlinked in the window, the filter panel's room inside the picker and Escape over
// it. Runs on desktop only, as the sizes are covered by the visual spec
import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

function saveButton(dialog: Locator) {
  return dialog.getByTestId('transaction-submit')
}

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

// The reason "Link an existing refund" gives while no row fits
const NO_REFUND_FITS = 'No money that came in fits what is left to refund'

// The refunds the picker shows are in its order, with what is left to refund after the picks. Every row not picked
// must fit that, so no row is shown that a press could not pick
async function expectOnlyPickableRows(picker: Locator, amounts: string[], remainingCents: number) {
  const rows = picker.getByTestId('link-candidate')
  await expect(rows.getByTestId('transaction-amount')).toHaveText(amounts)
  await expect.poll(async () => {
    const shown = await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        picked: node.getAttribute('data-picked') === 'true',
        cents: Math.round(Number(node.querySelector('[data-testid="transaction-amount"]')!.textContent!.replace(/[^\d.]/g, '')) * 100),
      })),
    )
    return shown.length === amounts.length && shown.every((row) => row.picked || row.cents <= remainingCents)
  }).toBe(true)
}

// The picker offers only the refunds that fit what is left of the expense. A refund over the whole expense is never
// listed, a pick lowers what is left for the others and unpicking gives it back, with the mouse and the keyboard
test('lists only refunds that fit and updates the list as rows are picked and unpicked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3713, date: daysFromTodayInTestTimezone(-6) })
  for (const [amount, daysAgo] of [[3719, 1], [2000, 2], [1500, 3], [1200, 4]] as const) {
    await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const press = (amount: string) => picker.getByTestId('link-candidate').filter({ hasText: amount }).getByRole('button')
  const linkButton = picker.getByRole('button', { name: 'Link', exact: true })

  // $37.19 is more than the whole expense, so it is never listed
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 3713)
  await expect(linkButton).toBeDisabled()

  // Two rows can be picked together. The $20.00 pick leaves $17.13, the $15.00 pick $2.13, which fits nothing else
  await press('$20.00').click()
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 1713)
  await press('$15.00').click()
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00'], 213)
  await expect(press('$20.00')).toHaveAttribute('aria-pressed', 'true')
  await expect(press('$15.00')).toHaveAttribute('aria-pressed', 'true')
  await expect(linkButton).toBeEnabled()

  // Pressing a picked row again gives its amount back
  await press('$20.00').click()
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 2213)
  await expect(press('$20.00')).toHaveAttribute('aria-pressed', 'false')

  // The keyboard picks and unpicks the same way, with Enter and with Space
  await press('$12.00').focus()
  await page.keyboard.press('Enter')
  await expectOnlyPickableRows(picker, ['+$15.00', '+$12.00'], 1013)
  await expect(press('$12.00')).toHaveAttribute('aria-pressed', 'true')
  await press('$12.00').focus()
  await page.keyboard.press('Space')
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 2213)
  await press('$15.00').focus()
  await page.keyboard.press('Enter')
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 3713)
  await expect(linkButton).toBeDisabled()
  await press('$20.00').focus()
  await page.keyboard.press('Space')
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 1713)
  await page.keyboard.press('Space')
  await expectOnlyPickableRows(picker, ['+$20.00', '+$15.00', '+$12.00'], 3713)
  await expect(linkButton).toBeDisabled()

  // Both picks are held by Link, and the window names them as not saved yet
  await press('$20.00').click()
  await press('$15.00').click()
  await linkButton.click()
  await expect(picker).toBeHidden()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(2)
  await expect(expense.getByTestId('linked-transaction')).toContainText(['Not saved yet', 'Not saved yet'])
  await saveButton(expense).click()
  await expect(expense).toBeHidden()
  await page.reload()
  const reopened = await openRow(page, expenseId)
  await expect(reopened.getByTestId('linked-transaction')).toHaveCount(2)
})

// While no row fits what is left, the button that opens the picker is greyed out with its reason, and a refund
// made from the window is held to what is left too
test('greys out the link button with its reason while no refund fits', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3000, date: daysFromTodayInTestTimezone(-5) })
  for (const [amount, daysAgo] of [[1200, 1], [3100, 3]] as const) {
    await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  const open = expense.getByTestId('link-existing')
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })

  // $12.00 fits and $31.00 never does, so the button is live
  await expect(open).not.toHaveAttribute('aria-disabled', 'true')
  await open.click()
  await expectOnlyPickableRows(picker, ['+$12.00'], 3000)
  await picker.getByTestId('link-candidate').getByRole('button').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()

  // The only row left is $31.00, which does not fit the $18.00 left, so the button is greyed out and a press does nothing
  await expect(open).toHaveAttribute('aria-disabled', 'true')
  await expect(open).toHaveAccessibleDescription(NO_REFUND_FITS)
  await open.click({ force: true })
  await open.focus()
  await page.keyboard.press('Enter')
  await expect(picker).toHaveCount(0)

  // The reason shows beside the pointer
  await open.hover()
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: NO_REFUND_FITS })).toHaveCSS('opacity', '1')

  // A refund made from the window can't pass what is left either
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
  // The rows ease in, so the height is taken once two reads in a row agree
  let previous = -1
  await expect
    .poll(async () => {
      const now = await height()
      const settled = now === previous
      previous = now
      return settled
    }, { intervals: [200] })
    .toBe(true)
  const rowsOnly = previous
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

// Unlinking a refund in the window, before Save, gives its amount back at once: an expense that was fully refunded
// has its link button greyed out, then live again with the refunds that fit, and never the ones that don't
test('gives an unlinked refund its amount back to the picker before Save', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3713, date: daysFromTodayInTestTimezone(-6) })
  const refundId = await createTransaction(request, user, { ...row, amount: 3713, date: daysFromTodayInTestTimezone(-5) })
  for (const [amount, daysAgo] of [[3719, 1], [2000, 2], [1500, 3]] as const) {
    await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }
  await request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
    headers: asUser(user),
    data: { original_transaction_id: expenseId },
  })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  const open = expense.getByTestId('link-existing')
  await expect(open).toHaveAttribute('aria-disabled', 'true')
  await expect(open).toHaveAccessibleDescription(NO_REFUND_FITS)

  await expense.getByRole('button', { name: /^Unlink / }).click()
  await expect(open).not.toHaveAttribute('aria-disabled', 'true')
  await open.click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await expectOnlyPickableRows(picker, ['+$37.13', '+$20.00', '+$15.00'], 3713)
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

