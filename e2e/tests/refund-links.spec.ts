// Runs on desktop only: the modal and the pickers are the same markup at every size, and the sizes are
// covered by the visual spec. The hint test on a list row sets its own widths
import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage, readSettledBox, SAVED_QUERY_CACHE_KEY } from '../support/app'
import { API_BASE_URL } from '../support/target'

// The refund icon a list row shows on a refund and on the expense it refunds
function linkIcon(page: Page, id: string) {
  return page.getByTestId(`transaction-row-${id}`).getByTestId('transaction-refund-link').filter({ visible: true })
}

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

// The edit window's Save button, which makes every link change held in the window
function saveButton(dialog: Locator) {
  return dialog.getByTestId('transaction-submit')
}

// The Refund button opens a second transaction prefilled as money coming back. Adding it only holds it in the
// expense's window, which creates and links it on Save, and both rows then show the link without a reload.
// Unlink is held the same way, and takes the link off both rows once saved
test('refunds an expense from its modal and shows the link on both rows', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const expenseId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4200,
    date: daysFromTodayInTestTimezone(-2),
  })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByTestId('transaction-refund').click()

  const refund = page.getByRole('dialog', { name: 'Add refund', exact: true })
  await expect(refund.getByLabel('Amount')).toHaveValue('42.00')
  await refund.getByTestId('transaction-submit').click()
  await expect(refund).toBeHidden()

  // The expense's window marks the refund as unsaved, and nothing is created or linked until Save
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(expense.getByTestId('linked-transaction')).toContainText('not saved yet')
  await expect(page.getByTestId('transaction-refund-link').filter({ visible: true })).toHaveCount(0)
  await saveButton(expense).click()
  await expect(expense).toBeHidden()
  await expect(linkIcon(page, expenseId)).toHaveAccessibleName('Refunded once')

  // Unlinking is held too, and takes the icon off both rows once saved
  const reopened = await openRow(page, expenseId)
  await reopened.getByRole('button', { name: /^Unlink / }).click()
  await expect(reopened.getByTestId('linked-transaction')).toHaveCount(0)
  await expect(linkIcon(page, expenseId)).toBeVisible()
  await saveButton(reopened).click()
  await expect(reopened).toBeHidden()
  await expect(page.getByTestId('transaction-refund-link').filter({ visible: true })).toHaveCount(0)
})

// Cancelling or closing the window drops every held change, the new refund and the picked link included
test('drops held links and refunds when the edit window is cancelled', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -5000, date: daysFromTodayInTestTimezone(-3) })
  await createTransaction(request, user, { ...row, amount: 1500, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await picker.getByTestId('link-candidate').getByRole('button').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)

  await expense.getByTestId('transaction-refund').click()
  const refund = page.getByRole('dialog', { name: 'Add refund', exact: true })
  await refund.getByLabel('Amount').fill('10.00')
  await refund.getByTestId('transaction-submit').click()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(2)

  await expense.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(expense).toBeHidden()
  await expect(page.getByTestId('transaction-refund-link').filter({ visible: true })).toHaveCount(0)
  const reopened = await openRow(page, expenseId)
  await expect(reopened.getByTestId('linked-transaction')).toHaveCount(0)
  await expect(page.getByTestId('transaction-amount').filter({ hasText: '$10.00' })).toHaveCount(0)
})

// Delete on a linked transaction asks what happens to the other side. The default keeps it and removes
// only the link, and ticking the box deletes both
test('asks whether deleting a linked expense also deletes its refund', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const kept = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-4) })
  const keptRefund = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1000, date: daysFromTodayInTestTimezone(-3) })
  const gone = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -2000, date: daysFromTodayInTestTimezone(-2) })
  const goneRefund = await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: 2000, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  for (const [refundId, expenseId] of [[keptRefund, kept], [goneRefund, gone]]) {
    await openRow(page, refundId)
    await page.getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: 'Link to an expense', exact: true })
    const amount = refundId === keptRefund ? '$10.00' : '$20.00'
    await picker.getByTestId('link-candidate').filter({ hasText: amount }).getByRole('button').click()
    await picker.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(picker).toBeHidden()

    // The link is held by the edit window and made when it is saved
    await saveButton(page.getByRole('dialog', { name: 'Edit transaction', exact: true })).click()
    await expect(page.getByRole('dialog', { name: 'Edit transaction', exact: true })).toBeHidden()
    await expect(linkIcon(page, expenseId)).toBeVisible()
  }

  // Leaving the choice alone keeps the refund and removes the link
  const keptDialog = await openRow(page, kept)
  await keptDialog.getByTestId('transaction-delete').click()
  const keepConfirm = page.getByRole('dialog', { name: 'Delete this transaction?', exact: true })
  await expect(keepConfirm.getByRole('checkbox', { name: 'Also delete the 1 linked transaction' })).not.toBeChecked()
  await expect(keepConfirm.getByRole('status')).toHaveCount(0)
  await keepConfirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByTestId(`transaction-row-${kept}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${keptRefund}`)).toBeVisible()
  await expect(linkIcon(page, keptRefund)).toHaveCount(0)

  // Ticking the box takes the refund along
  const goneDialog = await openRow(page, gone)
  await goneDialog.getByTestId('transaction-delete').click()
  const takeConfirm = page.getByRole('dialog', { name: 'Delete this transaction?', exact: true })
  const box = takeConfirm.getByRole('checkbox', { name: 'Also delete the 1 linked transaction' })

  // The tick is drawn all along and eases in with the fill, so the box never changes size
  const tick = box.locator('svg')
  await expect(tick).toHaveCSS('opacity', '0')
  await expect(tick).toHaveCSS('transition-property', 'opacity, scale')
  await expect(box).toHaveCSS('width', '20px')
  await expect(box).toHaveCSS('height', '20px')
  await box.check()
  await expect(tick).toHaveCSS('opacity', '1')
  await expect(box).toHaveCSS('width', '20px')
  await expect(box).toHaveCSS('height', '20px')
  await takeConfirm.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByTestId(`transaction-row-${gone}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${goneRefund}`)).toHaveCount(0)

  // The server agrees after a reload, not only the cached list
  await page.reload()
  await expect(page.getByTestId(`transaction-row-${keptRefund}`)).toBeVisible()
  await expect(page.getByTestId(`transaction-row-${gone}`)).toHaveCount(0)
  await expect(page.getByTestId(`transaction-row-${goneRefund}`)).toHaveCount(0)
})

// A link the server refuses on Save leaves the edit window open with the reason, instead of closing on a link that was
// not made
test('keeps the edit window open with the reason when Save is refused', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3000, date: daysFromTodayInTestTimezone(-3) })
  const otherExpenseId = await createTransaction(request, user, { ...row, amount: -2000, date: daysFromTodayInTestTimezone(-4) })
  const refundId = await createTransaction(request, user, { ...row, amount: 1200, date: daysFromTodayInTestTimezone(-1) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await picker.getByTestId('link-candidate').getByRole('button').click()

  // The refund is linked elsewhere before the press, so the server refuses this link
  const linked = await request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
    headers: asUser(user),
    data: { original_transaction_id: otherExpenseId },
  })
  expect(linked.ok()).toBe(true)
  await picker.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(picker).toBeHidden()
  await saveButton(expense).click()

  await expect(expense.getByRole('alert')).toContainText('already linked')
  await expect(expense).toBeVisible()
})

// An expense and its refunds read as one chain from either side, with a badge for how much came back and what is
// left to refund. Both follow a link removed in the window before Save
test('shows an expense and its refunds as one chain with what is left to refund', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 100000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const link = (refundId: string, expenseId: string) =>
    request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
      headers: asUser(user),
      data: { original_transaction_id: expenseId },
    })
  const orderId = await createTransaction(request, user, { ...row, amount: -64000, date: daysFromTodayInTestTimezone(-20) })
  const refundIds: string[] = []
  // Linked newest first, so the chain has to put them in date order itself
  for (const [amount, days] of [[12000, -5], [32000, -15], [20000, -10]]) {
    const refundId = await createTransaction(request, user, { ...row, amount, date: daysFromTodayInTestTimezone(days) })
    expect((await link(refundId, orderId)).status()).toBe(204)
    refundIds.push(refundId)
  }
  // Money in, linked to nothing and dated before every refund, so the picker offers it as an older refund
  await createTransaction(request, user, { ...row, amount: 12000, date: daysFromTodayInTestTimezone(-18), notes: 'Store credit' })
  const lampId = await createTransaction(request, user, { ...row, amount: -18000, date: daysFromTodayInTestTimezone(-12) })
  const lampRefundId = await createTransaction(request, user, { ...row, amount: 4500, date: daysFromTodayInTestTimezone(-3) })
  expect((await link(lampRefundId, lampId)).status()).toBe(204)

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  await test.step('an expense refunded in full by three refunds', async () => {
    const order = await openRow(page, orderId)
    await expect(order.getByTestId('linked-transaction')).toContainText(['+$320.00', '+$200.00', '+$120.00'])
    await expect(order.getByTestId('refund-count')).toHaveText('· 3, 3 linked')
    await expect(order.getByTestId('refund-status')).toHaveText('Refunded in full')
    await expect(order.getByTestId('refund-room')).toHaveText('$0.00')

    // The first refund sits twice as far from the expense as the refunds sit from each other, read again until the
    // rows have finished growing in
    await expect(async () => {
      const [expenseBox, firstBox, secondBox] = await Promise.all([
        order.getByTestId('refund-chain-expense').boundingBox(),
        order.getByTestId('linked-transaction').nth(0).boundingBox(),
        order.getByTestId('linked-transaction').nth(1).boundingBox(),
      ])
      const leadGap = firstBox!.y - (expenseBox!.y + expenseBox!.height)
      const refundGap = secondBox!.y - (firstBox!.y + firstBox!.height)
      expect(refundGap).toBeGreaterThan(0)
      expect(leadGap).toBeCloseTo(refundGap * 2, 0)
    }).toPass()

    // Unlinking the newest refund is held until Save, and gives its amount back at once
    await order.getByRole('button', { name: /^Unlink / }).last().click()
    await expect(order.getByTestId('linked-transaction')).toHaveCount(2)
    await expect(order.getByTestId('refund-count')).toHaveText('· 2, 2 linked')
    await expect(order.getByTestId('refund-status')).toHaveText('Partly refunded')
    await expect(order.getByTestId('refund-room')).toHaveText('$120.00')

    // An older refund linked from the picker is held until Save, and takes its place by date above the saved ones
    await order.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
    const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
    await picker.getByPlaceholder('Merchant or note…').fill('Store credit')
    await expect(picker.getByTestId('link-candidate')).toHaveCount(1)
    await picker.getByTestId('link-candidate').getByRole('button').click()
    await picker.getByRole('button', { name: 'Link', exact: true }).click()
    await expect(picker).toBeHidden()
    await expect(order.getByTestId('linked-transaction')).toContainText(['+$120.00', '+$320.00', '+$200.00'])
    // Only the held link sits in the dashed border, and a screen reader hears that it is not saved yet
    const held = order.locator('[data-not-saved]')
    await expect(held).toHaveCount(1)
    await expect(order.getByTestId('linked-transaction').first()).toHaveAttribute('data-not-saved', 'true')
    await expect(held).toContainText('not saved yet')
    await expect(held).toHaveCSS('border-top-style', 'dashed')

    // The border draws past the row's text on every side, and the row that grows it into place clips, so the whole
    // border has to sit inside that row to show its edges once the row has finished growing in
    await expect(async () => {
      const [heldBox, heldRowBox] = await Promise.all([
        held.boundingBox(),
        order.getByTestId('linked-row').filter({ has: page.locator('[data-not-saved]') }).boundingBox(),
      ])
      expect(heldBox!.x).toBeGreaterThanOrEqual(heldRowBox!.x)
      expect(heldBox!.y).toBeGreaterThanOrEqual(heldRowBox!.y)
      expect(heldBox!.x + heldBox!.width).toBeLessThanOrEqual(heldRowBox!.x + heldRowBox!.width)
      expect(heldBox!.y + heldBox!.height).toBeLessThanOrEqual(heldRowBox!.y + heldRowBox!.height)
    }).toPass()
    await expect(order.getByTestId('refund-room')).toHaveText('$0.00')
    await order.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(order).toBeHidden()
  })

  await test.step('a refund shows its expense with every refund of it', async () => {
    const refund = await openRow(page, refundIds[1])
    await expect(refund.getByTestId('linked-transaction')).toContainText('−$640.00')
    await expect(refund.getByTestId('refund-chain-sibling')).toHaveCount(2)
    await expect(refund.getByTestId('refund-chain-self')).toContainText('This refund')
    // The Refund of heading carries no count
    await expect(refund.getByTestId('refund-count')).toHaveCount(0)
    await expect(refund.getByTestId('refund-status')).toHaveText('Refunded in full')
    await expect(refund.getByTestId('refund-room')).toHaveText('$0.00')
    await refund.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(refund).toBeHidden()
  })

  await test.step('an expense refunded in part', async () => {
    const lamp = await openRow(page, lampId)
    await expect(lamp.getByTestId('refund-count')).toHaveText('· 1, 1 linked')
    await expect(lamp.getByTestId('refund-status')).toHaveText('Partly refunded')
    await expect(lamp.getByTestId('refund-room')).toHaveText('$135.00')
  })

  await test.step('a refund that fails to load leaves what is left to refund unsaid, and still offers the link', async () => {
    const failing: string[] = []
    await page.route(
      (url) => url.pathname.endsWith(`/transactions/${lampRefundId}`),
      (route) => {
        failing.push(route.request().url())
        return route.fulfill({ status: 500 })
      },
    )
    // The app restores its saved cache on load, the refund included, so the next load starts without it
    await page.addInitScript((key) => localStorage.removeItem(key), SAVED_QUERY_CACHE_KEY)
    await page.reload()
    const lamp = await openRow(page, lampId)
    await expect.poll(() => failing.length).toBeGreaterThan(0)
    await expect(lamp.getByRole('alert')).toContainText('something went wrong loading the linked transaction')
    await expect(lamp.getByTestId('refund-room')).toHaveCount(0)
    await expect(lamp.getByText('Loading…', { exact: true })).toHaveCount(0)
    await expect(lamp.getByTestId('link-existing')).toBeVisible()
  })
})

// The picker lists only what linking would accept, so an expense is offered money that came in and a
// search narrows it
test('links an existing refund to an expense from the picker', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -3000, date: daysFromTodayInTestTimezone(-3) })
  const refundId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1200, date: daysFromTodayInTestTimezone(-1), notes: 'Store credit' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -800, date: daysFromTodayInTestTimezone(-2) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()

  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await expect(picker.getByTestId('link-candidate')).toHaveCount(1)
  await picker.getByPlaceholder('Merchant or note…').fill('nothing like this')
  await expect(picker.getByText('Nothing matches that search.', { exact: true })).toBeVisible()
  await picker.getByPlaceholder('Merchant or note…').fill('Store credit')
  // The search waits for typing to pause, and the row from before it can still be fading out, so the row is picked
  // once the search's own result has replaced the empty message, or the pick lands on the fading row and is dropped
  await expect(picker.getByText('Nothing matches that search.', { exact: true })).toBeHidden()
  await picker.getByTestId('link-candidate').getByRole('button').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()

  // The picker closes and the edit window stays, marking the refund as unsaved, and the rows show no link
  await expect(picker).toBeHidden()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(expense.getByTestId('linked-transaction')).toContainText('not saved yet')
  await expect(linkIcon(page, refundId)).toHaveCount(0)

  // Save makes the link, and both rows show it
  await saveButton(expense).click()
  await expect(expense).toBeHidden()
  await expect(linkIcon(page, refundId)).toHaveAccessibleName('Refund of an expense')
  await expect(linkIcon(page, expenseId)).toBeVisible()
})

// The exact amount comes first among the likely matches and the nearest follow it, a row is picked by pressing it and
// unpicked by pressing it again, and the Link button is live only while one is picked
test('lists the closest amounts first and links the row that is picked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-6) })
  for (const [amount, daysAgo, category] of [[9000, 1, 'Groceries'], [4800, 2, 'Groceries'], [5000, 5, 'Groceries'], [4900, 3, 'Dining']] as const) {
    await createTransaction(request, user, { accountId: account.id, categoryName: category, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const rows = picker.getByTestId('link-candidate')
  const linkButton = picker.getByRole('button', { name: 'Link', exact: true })

  // The exact amount leads as a likely match even though it is the oldest, then the nearer 4900 and 4800. 9000 is more
  // than the whole expense, so it folds into the row of what can't be linked
  const folded = picker.getByRole('button', { name: /can't be linked/ })
  await expect(rows).toHaveCount(3)
  await expect(rows.getByTestId('transaction-amount')).toHaveText(['+$50.00', '+$49.00', '+$48.00'])
  await expect(folded).toHaveText("1 refund can't be linked: it's more than the $50.00 left to refund")
  await expect(linkButton).toBeDisabled()

  // Pressing a row picks it. Pressing it again clears the pick
  const picked = picker.locator('[data-picked=true]')
  await rows.nth(1).getByRole('button').click()

  // The $49.00 pick leaves $1.00. None of the others fit that, so they fold away with the $90.00
  await expect(rows).toHaveCount(1)
  await expect(folded).toHaveText("3 refunds can't be linked: each is more than the $1.00 left to refund")
  await expect(picked.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  await expect(linkButton).toBeEnabled()

  // The picked row takes the accent border and fill
  await expect(picked).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(picked).not.toHaveCSS('box-shadow', 'rgba(0, 0, 0, 0) 0px 0px 0px 1px inset')

  // The open filter panel covers the search row and the list edge to edge, so nothing behind shows beside it
  const filtersButton = picker.getByRole('button', { name: 'Transaction filters' })
  await filtersButton.click()
  const edges = (locator: Locator) => locator.evaluate((node) => {
    const { left, right } = node.getBoundingClientRect()
    return { left, right }
  })
  const searchRow = picker.getByPlaceholder('Merchant or note…').locator('xpath=ancestor::div[contains(@class, "flex-1")][1]')
  const [search, list] = [await edges(searchRow), await edges(picker.getByTestId('link-candidates'))]
  await expect.poll(async () => {
    const glass = await edges(picker.locator('.app-range-glass'))
    return Math.max(Math.abs(glass.left - search.left), Math.abs(glass.left - list.left), Math.abs(glass.right - list.right))
  }).toBeLessThanOrEqual(0.5)
  await filtersButton.click()
  await picked.getByRole('button').click()
  await expect(rows).toHaveCount(3)
  await expect(folded).toHaveText("1 refund can't be linked: it's more than the $50.00 left to refund")
  await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  await expect(linkButton).toBeDisabled()

  // The list's category filter narrows the candidates, which keep their order
  await picker.getByRole('button', { name: 'Transaction filters' }).click()
  await picker.getByRole('tab', { name: 'Category' }).click()
  await picker.getByRole('checkbox', { name: 'Dining' }).click()
  await picker.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.getByTestId('transaction-amount')).toHaveText('+$49.00')

  await rows.getByRole('button').click()
  await expect(linkButton).toBeEnabled()
  await linkButton.click()
  await expect(picker).toBeHidden()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await saveButton(expense).click()
  await expect(expense).toBeHidden()
  await expect(linkIcon(page, expenseId)).toBeVisible()
})

// The search field and Filters button stay put while only the candidate rows scroll under them
test('keeps the picker header in place while its rows scroll', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-10) })
  for (let day = 1; day <= 14; day++) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1000 + day * 100, date: daysFromTodayInTestTimezone(-day) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await openRow(page, expenseId)
  await page.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const rows = picker.getByTestId('link-candidate')
  await expect(rows).toHaveCount(14)

  const search = picker.getByPlaceholder('Merchant or note…')

  // The picker and its rows ease in, so measuring waits until no animation runs and three reads in a row agree. Two
  // reads could agree while a busy run held a frame back mid-ease
  const reads: number[] = []
  await expect
    .poll(async () => {
      const moving = await page.evaluate(() => document.getAnimations().some((animation) => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity))
      reads.push(moving ? -1 : (await search.boundingBox())!.y)
      const last = reads.slice(-3)
      return last.length === 3 && last.every((top) => top >= 0 && top === last[0])
    }, { intervals: [250] })
    .toBe(true)
  // The last row starts below the dialog's visible body, and scrolling it into view leaves the header where it was
  const searchBefore = await search.boundingBox()
  await rows.last().scrollIntoViewIfNeeded()
  const scrolled = await rows.first().evaluate((row) => row.closest('[data-tooltip-bounds]')!.scrollTop)
  expect(scrolled).toBeGreaterThan(0)
  await expect(search).toBeInViewport({ ratio: 1 })
  const searchAfter = await search.boundingBox()
  expect(searchAfter!.y).toBeCloseTo(searchBefore!.y, 0)
})

// On a phone the list's filters open as a full-screen sheet, which has to draw above the picker that opened it,
// since clicking its Apply button fails while the picker covers it
test('narrows the picker with the filter sheet on a phone', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-4) })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 4800, date: daysFromTodayInTestTimezone(-2) })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: 4900, date: daysFromTodayInTestTimezone(-3) })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await openRow(page, expenseId)
  await page.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  await expect(picker.getByTestId('link-candidate')).toHaveCount(2)

  await picker.getByRole('button', { name: /^Filters/ }).click()
  const sheet = page.getByRole('dialog', { name: 'Transaction filters', exact: true })
  await sheet.getByRole('combobox', { name: 'Filters', exact: true }).click()
  await page.getByRole('option', { name: /^Category/ }).click()
  await sheet.getByRole('checkbox', { name: 'Dining' }).click()
  await sheet.getByRole('button', { name: 'Apply filters' }).click()
  await expect(picker.getByTestId('link-candidate')).toHaveCount(1)
})

// Opening and closing Filters moves only the list area: the search field and the Filters button keep their places in
// the dialogue before, during and after, at a desktop, a laptop and a phone size
for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]) {
  test(`keeps the picker header still while Filters opens and closes at ${size.width}x${size.height}`, async ({ page, request }) => {
    await page.setViewportSize(size)
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-10) })
    for (let day = 1; day <= 8; day++) {
      await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1000 + day * 100, date: daysFromTodayInTestTimezone(-day) })
    }

    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    await openRow(page, expenseId)
    await page.getByTestId('link-existing').click()
    const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
    await expect(picker.getByTestId('link-candidate')).toHaveCount(8)

    const phone = size.width < 750
    const header = [
      picker.getByPlaceholder('Merchant or note…'),
      phone ? picker.getByRole('button', { name: /^Filters/ }) : picker.getByRole('button', { name: 'Transaction filters' }),
    ]
    // Measured from the dialog's own top, since a dialog that grows with the panel is centred and so moves as a whole.
    // Everything is read in one call, as the dialog moves between separate reads while it grows
    const tops = () =>
      picker.evaluate((dialog, isPhone) => {
        const dialogTop = dialog.getBoundingClientRect().top
        const filters = isPhone
          ? [...dialog.querySelectorAll('button')].find((button) => /^Filters/.test(button.textContent ?? ''))
          : dialog.querySelector('button[aria-label="Transaction filters"]')
        const search = dialog.querySelector('input[placeholder="Merchant or note…"]')
        return [search, filters].map((node) => node!.getBoundingClientRect().top - dialogTop)
      }, phone)
    // Read once the dialogue has finished opening and everything moving in it has come to rest, including an
    // animation the app cancels on the way, as its entrance animation leaves these a fraction of a pixel off
    await readSettledBox(picker)
    const resting = await tops()

    // Opening Filters from a body scrolled down is the case that moved the header, since the pinned block un-sticks
    await picker.locator('[data-tooltip-bounds]').evaluate((body) => {
      body.scrollTop = 150
    })
    await expect.poll(tops).toEqual(resting)

    // Samples every 100ms for a second after a click, which covers the panel's opening or closing animation
    const watch = async (action: () => Promise<unknown>) => {
      await action()
      const samples = [await tops()]
      for (let sample = 0; sample < 10; sample++) {
        await page.waitForTimeout(100)
        samples.push(await tops())
      }
      return samples
    }

    const opening = await watch(() => header[1].click())
    const closing = await watch(() => (phone ? page.keyboard.press('Escape') : header[1].click()))
    for (const sample of [...opening, ...closing]) {
      sample.forEach((top, index) => expect(Math.abs(top - resting[index])).toBeLessThanOrEqual(0.5))
    }
  })
}

// The row's title is stretched over the whole row by a layer, so an icon that explains itself on hover has to sit
// above it. The pointer must land on the icon itself, or its hint never shows
async function expectPointerLandsOn(icon: Locator) {
  await icon.scrollIntoViewIfNeeded()
  await expect
    .poll(() =>
      icon.evaluate((node) => {
        const { x, y, width, height } = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(x + width / 2, y + height / 2))
      }),
    )
    .toBe(true)
  await icon.hover({ timeout: 2000 })
}

// A refunded expense's refund icon keeps its "Refunded once" hint in a list at a wide and a phone width
for (const width of [1280, 390]) {
  test(`shows the refund link hint on a list row at ${width}px wide`, async ({ page, request }) => {
    await page.setViewportSize({ width, height: 844 })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
    const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4200, date: daysFromTodayInTestTimezone(-2) })
    const refundId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: 1000, date: daysFromTodayInTestTimezone(-1) })
    const linked = await request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
      headers: asUser(user),
      data: { original_transaction_id: expenseId },
    })
    expect(linked.ok()).toBe(true)

    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    const icon = linkIcon(page, expenseId)
    await expect(icon).toHaveAttribute('title', 'Refunded once')
    await expectPointerLandsOn(icon)
  })
}

// An expense that is already refunded once is still listed in the picker for a second refund, and its icon keeps
// its hint there too
test('shows the refund link hint on a row of the link picker', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -4200, date: daysFromTodayInTestTimezone(-3) })
  const firstRefundId = await createTransaction(request, user, { ...row, amount: 1000, date: daysFromTodayInTestTimezone(-2) })
  const secondRefundId = await createTransaction(request, user, { ...row, amount: 500, date: daysFromTodayInTestTimezone(-1) })
  const linked = await request.post(`${API_BASE_URL}/transactions/${firstRefundId}/refund-link`, {
    headers: asUser(user),
    data: { original_transaction_id: expenseId },
  })
  expect(linked.ok()).toBe(true)

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  await openRow(page, secondRefundId)
  await page.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link to an expense', exact: true })
  const icon = picker.getByTestId('link-candidate').getByTestId('transaction-refund-link')
  await expect(icon).toHaveAttribute('title', 'Refunded once')
  await expectPointerLandsOn(icon)
})
