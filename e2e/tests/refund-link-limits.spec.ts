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

// Every refund stays listed, in the picker's order. Those that don't fit what is left of the expense after the picks
// are marked refused and aria-disabled, and every other row is not, so a row is never refused that a press could take
async function expectOnlyPickableRows(picker: Locator, amounts: string[], remainingCents: number) {
  const rows = picker.getByTestId('link-candidate')
  await expect(rows.getByTestId('transaction-amount')).toHaveText(amounts)
  await expect.poll(async () => {
    const shown = await rows.evaluateAll((nodes) =>
      nodes.map((node) => ({
        picked: node.getAttribute('data-picked') === 'true',
        refused: node.getAttribute('data-refused') === 'true',
        disabled: node.querySelector('button')!.getAttribute('aria-disabled') === 'true',
        cents: Math.round(Number(node.querySelector('[data-testid="transaction-amount"]')!.textContent!.replace(/[^\d.]/g, '')) * 100),
      })),
    )
    return shown.length === amounts.length && shown.every((row) => {
      const shouldRefuse = !row.picked && row.cents > remainingCents
      return row.refused === shouldRefuse && row.disabled === shouldRefuse
    })
  }).toBe(true)
}

// The button of the picker row with this amount. Matched by the amount shown, as a greyed row also holds its reason as text
function pressRow(picker: Locator, amount: string) {
  const amountText = picker.page().getByTestId('transaction-amount').filter({ hasText: amount })
  return picker.getByTestId('link-candidate').filter({ has: amountText }).getByRole('button')
}

// The reason a refund bigger than the whole $37.13 expense gives, in the sentence form of the greyed opening button's
const OVER_THE_EXPENSE = 'This refund is more than the $37.13 left to refund.'

const ALL_ROWS = ['+$37.19', '+$20.00', '+$15.00', '+$12.00']

// The picker keeps every refund listed and greys out the ones that don't fit what is left of the expense, with their
// reason in the tooltip. A refund over the whole expense is greyed from the start, a pick lowers what is left for the
// others and unpicking gives it back, with the mouse and the keyboard
test('greys out the refunds that no longer fit and updates them as rows are picked and unpicked', async ({ page, request }) => {
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
  const press = (amount: string) => pressRow(picker, amount)
  const linkButton = picker.getByRole('button', { name: 'Link', exact: true })

  // $37.19 is more than the whole expense, so it is listed greyed out from the start. Its reason is the shared tooltip's
  // on hover and on keyboard focus, and its description for a screen reader, and pressing it picks nothing
  await expectOnlyPickableRows(picker, ALL_ROWS, 3713)
  await expect(linkButton).toBeDisabled()
  const tooltip = page.getByTestId('disabled-reason-tooltip').filter({ hasText: /\S/ })
  await press('$37.19').hover()
  await expect(tooltip).toHaveText(OVER_THE_EXPENSE)
  await expect(tooltip).toHaveCSS('opacity', '1')
  await expect(press('$37.19')).toHaveAccessibleDescription(OVER_THE_EXPENSE)
  // The greyed look eases in and out rather than snapping, at the app's disabled strength
  // Only what the row's button holds fades. The button itself, which draws the keyboard focus ring, stays at full strength
  const greyed = picker.getByTestId('link-candidate').first()
  await expect(greyed.locator('button > *').first()).toHaveCSS('transition-property', 'opacity')
  await expect(greyed.locator('button > *').first()).toHaveCSS('opacity', '0.5')
  await expect(greyed.locator('button')).toHaveCSS('opacity', '1')
  await expect(greyed.locator('> div')).toHaveCSS('opacity', '1')
  await press('$37.19').click({ force: true })
  await expect(press('$37.19')).toHaveAttribute('aria-pressed', 'false')
  await expect(linkButton).toBeDisabled()
  await picker.getByRole('button', { name: 'Cancel', exact: true }).hover()
  await press('$37.19').focus()
  await page.keyboard.press('Enter')
  await expect(press('$37.19')).toHaveAttribute('aria-pressed', 'false')

  // Two rows can be picked together. The $20.00 pick leaves $17.13, the $15.00 pick $2.13, which fits nothing else
  await press('$20.00').click()
  await expectOnlyPickableRows(picker, ALL_ROWS, 1713)
  await press('$15.00').click()
  await expectOnlyPickableRows(picker, ALL_ROWS, 213)
  await expect(press('$20.00')).toHaveAttribute('aria-pressed', 'true')
  await expect(press('$15.00')).toHaveAttribute('aria-pressed', 'true')
  await expect(linkButton).toBeEnabled()

  // Pressing a picked row again gives its amount back
  await press('$20.00').click()
  await expectOnlyPickableRows(picker, ALL_ROWS, 2213)
  await expect(press('$20.00')).toHaveAttribute('aria-pressed', 'false')

  // The keyboard picks and unpicks the same way, with Enter and with Space
  await press('$12.00').focus()
  await page.keyboard.press('Enter')
  await expectOnlyPickableRows(picker, ALL_ROWS, 1013)
  await expect(press('$12.00')).toHaveAttribute('aria-pressed', 'true')
  await press('$12.00').focus()
  await page.keyboard.press('Space')
  await expectOnlyPickableRows(picker, ALL_ROWS, 2213)
  await press('$15.00').focus()
  await page.keyboard.press('Enter')
  await expectOnlyPickableRows(picker, ALL_ROWS, 3713)
  await expect(linkButton).toBeDisabled()
  await press('$20.00').focus()
  await page.keyboard.press('Space')
  await expectOnlyPickableRows(picker, ALL_ROWS, 1713)
  await page.keyboard.press('Space')
  await expectOnlyPickableRows(picker, ALL_ROWS, 3713)
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
  await expectOnlyPickableRows(picker, ['+$31.00', '+$12.00'], 3000)
  await pressRow(picker, '$12.00').click()
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
  await expectOnlyPickableRows(picker, ['+$37.13', '+$37.19', '+$20.00', '+$15.00'], 3713)
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


// A $50 expense refunded in two instalments of $20 and $30, with a $40 refund that fits only on its own. Picking one
// instalment keeps the other listed, and drops only the $40 one, which no longer fits beside it
test('keeps the second instalment listed when the first is picked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 100000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-6) })
  for (const [amount, daysAgo] of [[2000, 1], [3000, 2], [4000, 3]] as const) {
    await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const press = (amount: string) => pressRow(picker, amount)

  await expectOnlyPickableRows(picker, ['+$40.00', '+$30.00', '+$20.00'], 5000)
  await press('$20.00').click()
  await expectOnlyPickableRows(picker, ['+$40.00', '+$30.00', '+$20.00'], 3000)
  await press('$30.00').click()
  await expectOnlyPickableRows(picker, ['+$40.00', '+$30.00', '+$20.00'], 0)
  await picker.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(2)
})

// The edit window's height only eases one way after Link: it is measured on every frame from the press of Link until the
// new section has settled, and may grow or hold but never drop. Run for an expense picking refunds and a refund picking
// its expense, as their sections are different heights
for (const [anchor, size] of [
  ['expense', { width: 1920, height: 1080 }],
  ['refund', { width: 1920, height: 1080 }],
  ['expense', { width: 1280, height: 800 }],
  ['expense', { width: 390, height: 844 }],
  ['refund', { width: 390, height: 844 }],
] as const) {
  test(`the edit window never shrinks after Link is confirmed, from ${anchor === 'expense' ? 'an expense' : 'a refund'} at ${size.width}x${size.height}`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 100000 })
    const row = { accountId: account.id, categoryName: 'Groceries' }
    const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-6) })
    const refundId = await createTransaction(request, user, { ...row, amount: 2000, date: daysFromTodayInTestTimezone(-1) })
    await createTransaction(request, user, { ...row, amount: 3000, date: daysFromTodayInTestTimezone(-2) })

    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    const dialog = await openRow(page, anchor === 'expense' ? expenseId : refundId)
    await dialog.getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: anchor === 'expense' ? 'Link a refund' : 'Link to an expense', exact: true })
    await picker.getByTestId('link-candidate').first().getByRole('button').click()
    await page.waitForTimeout(800)

    // Samples the edit window and the picker on every frame, from just before Link is pressed, until the picker is gone
    const editHandle = await dialog.elementHandle()
    const pickerHandle = await picker.elementHandle()
    await page.evaluate(([edit, pick]) => {
      const sampled = { edit: [] as number[], picker: [] as number[] }
      const start = performance.now()
      const tick = () => {
        // The layout height, which the dialogue's own scale-down as it fades out does not change
        sampled.edit.push((edit as HTMLElement).offsetHeight)
        if (pick!.isConnected) sampled.picker.push((pick as HTMLElement).offsetHeight)
        if (performance.now() - start < 2500) requestAnimationFrame(tick)
      }
      ;(window as unknown as { __sampled: typeof sampled }).__sampled = sampled
      requestAnimationFrame(tick)
    }, [editHandle, pickerHandle])
    await picker.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(dialog.getByTestId('linked-transaction')).toHaveCount(1)
    await page.waitForTimeout(2500)
    const sampled = await page.evaluate(() => (window as unknown as { __sampled: { edit: number[]; picker: number[] } }).__sampled)
    for (const [name, heights] of Object.entries(sampled)) {
      const drops = heights.flatMap((height, index) => (index > 0 && height < heights[index - 1] - 0.5 ? [`${heights[index - 1]} -> ${height} at frame ${index}`] : []))
      expect(drops, `${name} height per frame: ${heights.map((height) => Math.round(height)).join(',')}`).toEqual([])
    }
  })
}

// Tab goes from the Filters button into the rows, a greyed row takes the focus ring at full strength with its reason
// in the tooltip, and the amount of a picked row reads at 4.5 to 1 against the picked fill it sits on
test('reaches the rows from Filters with Tab and keeps the focus ring of a greyed row at full strength', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3713, date: daysFromTodayInTestTimezone(-6) })
  for (const [amount, daysAgo] of [[3719, 1], [2000, 2], [1500, 3]] as const) {
    await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await expectOnlyPickableRows(picker, ['+$37.19', '+$20.00', '+$15.00'], 3713)
  const rows = picker.getByTestId('link-candidate')

  // The greyed $37.19 row is first. Tab from Filters lands on it, with its ring drawn and its reason shown
  await picker.getByRole('button', { name: 'Transaction filters' }).focus()
  await page.keyboard.press('Tab')
  const greyed = rows.first().getByRole('button')
  await expect(greyed).toBeFocused()
  const ringed = rows.first().locator('.app-transaction-row')
  await expect(ringed).toHaveCSS('outline-style', 'solid')
  await expect(ringed).not.toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)')
  await expect(ringed).toHaveCSS('opacity', '1')
  await expect(greyed).toHaveCSS('opacity', '1')
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: OVER_THE_EXPENSE })).toHaveCSS('opacity', '1')
  await page.keyboard.press('Tab')
  await expect(rows.nth(1).getByRole('button')).toBeFocused()

  // The amount of a picked row against the picked fill, which is drawn over the page, is at least 4.5 to 1
  await page.keyboard.press('Enter')
  await expect(rows.nth(1)).toHaveAttribute('data-picked', 'true')
  await page.mouse.move(0, 0)
  await expect.poll(() => rows.nth(1).evaluate((node) => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const toRgb = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data
      return { r, g, b, a: a / 255 }
    }

    // The background is the picked fill laid over each ancestor's, from the page inwards
    const layers: string[] = []
    for (let element: Element | null = node; element; element = element.parentElement) {
      layers.unshift(getComputedStyle(element).backgroundColor)
    }
    let background = { r: 255, g: 255, b: 255 }
    for (const layer of layers) {
      const { r, g, b, a } = toRgb(layer)
      background = { r: r * a + background.r * (1 - a), g: g * a + background.g * (1 - a), b: b * a + background.b * (1 - a) }
    }
    const text = toRgb(getComputedStyle(node.querySelector('[data-testid="transaction-amount"]')!).color)
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const [lr, lg, lb] = [r, g, b].map((channel) => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
    }
    const [lighter, darker] = [luminance(text), luminance(background)].sort((a, b) => b - a)
    return (lighter + 0.05) / (darker + 0.05)
  })).toBeGreaterThanOrEqual(4.5)
})

// A refund in another currency is not offered at all, not even greyed out, and counts as nothing that fits when the
// opening button decides whether to grey out
test('leaves out refunds in another currency and greys the opening button when only those are left', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const foreign = await createAccount(request, user, { name: 'Euro account', currency: 'EUR', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-6) })
  await createTransaction(request, user, { ...row, amount: 2000, date: daysFromTodayInTestTimezone(-2) })
  await createTransaction(request, user, { accountId: foreign.id, categoryName: 'Groceries', currency: 'EUR', amount: 3000, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  const open = expense.getByTestId('link-existing')
  await open.click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })

  // Only the $20.00 refund in the expense's own currency is listed, with nothing for the euro one
  await expectOnlyPickableRows(picker, ['+$20.00'], 5000)
  await pressRow(picker, '$20.00').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(picker).toBeHidden()

  // The euro refund is all that is left, which counts as nothing that fits
  await expect(open).toHaveAttribute('aria-disabled', 'true')
  await expect(open).toHaveAccessibleDescription(NO_REFUND_FITS)
})
