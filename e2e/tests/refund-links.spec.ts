// Runs on desktop only: the modal and the pickers are the same markup at every size, and the sizes are
// covered by the visual spec
import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// The link icon a list row shows on a refund and on the expense it refunds
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

  // The expense's window names the refund as not saved yet, and nothing is created or linked until Save
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(expense.getByTestId('linked-transaction')).toContainText('Not saved yet')
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
  await picker.getByTestId('link-candidate').getByRole('button').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()

  // The picker closes and the edit window stays, naming the refund as not saved yet, and the rows show no link
  await expect(picker).toBeHidden()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(expense.getByTestId('linked-transaction')).toContainText('Not saved yet')
  await expect(linkIcon(page, refundId)).toHaveCount(0)

  // Save makes the link, and both rows show it
  await saveButton(expense).click()
  await expect(expense).toBeHidden()
  await expect(linkIcon(page, refundId)).toHaveAccessibleName('Refund of an expense')
  await expect(linkIcon(page, expenseId)).toBeVisible()
})

// The exact amount comes first and the nearest after it, a row is picked by pressing it and unpicked by
// pressing it again, and the Link button is live only while one is picked
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

  // The exact amount leads even though it is the oldest, then the nearer 4900 and 4800. 9000 is more than the whole
  // expense, so it is listed greyed out
  await expect(rows).toHaveCount(4)
  await expect(rows.getByTestId('transaction-amount')).toHaveText(['+$50.00', '+$49.00', '+$48.00', '+$90.00'])
  await expect(picker.locator('[data-refused=true]')).toHaveCount(1)
  await expect(linkButton).toBeDisabled()

  // Pressing a row picks it. Pressing it again clears the pick
  const picked = picker.locator('[data-picked=true]')
  await rows.nth(1).getByRole('button').click()

  // The $49.00 pick leaves $1.00, which fits none of the others, so they stay listed greyed out
  await expect(rows).toHaveCount(4)
  await expect(picker.locator('[data-refused=true]')).toHaveCount(3)
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
  await expect(rows).toHaveCount(4)
  await expect(picker.locator('[data-refused=true]')).toHaveCount(1)
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

// The explanation, search field and Filters button stay put while only the candidate rows scroll under them, and
// the picker stays within 70% of the edit window's height from 750px wide, and the stacked window's 84% below that
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

  // The rows ease in and the centred dialog grows with them, so measuring waits until two reads in a row agree
  let lastTop = -1
  await expect
    .poll(async () => {
      const top = (await search.boundingBox())!.y
      const settled = top === lastTop
      lastTop = top
      return settled
    }, { intervals: [200] })
    .toBe(true)
  const viewport = page.viewportSize()!
  const panel = await picker.boundingBox()
  // The edit window is 86vh tall, though it shrinks a little behind the picker, so its size is taken from the screen
  const share = viewport.width >= 750 ? 0.7 * viewport.height * 0.86 : viewport.height * 0.84
  expect(panel!.height).toBeLessThanOrEqual(share + 1)

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

// Opening and closing Filters moves only the list area: the explanation, the search field and the Filters button
// keep their places in the dialog before, during and after, at a desktop, a laptop and a phone size
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
      picker.getByText(/^Pick money that came in/),
      picker.getByPlaceholder('Merchant or note…'),
      phone ? picker.getByRole('button', { name: /^Filters/ }) : picker.getByRole('button', { name: 'Transaction filters' }),
    ]
    // Measured from the dialog's own top, since a dialog that grows with the panel is centred and so moves as a whole.
    // Everything is read in one call, as the dialog moves between separate reads while it grows
    const tops = () =>
      picker.evaluate((dialog, isPhone) => {
        const dialogTop = dialog.getBoundingClientRect().top
        const explanation = [...dialog.querySelectorAll('p')].find((p) => p.textContent?.startsWith('Pick money that came in'))
        const filters = isPhone
          ? [...dialog.querySelectorAll('button')].find((button) => /^Filters/.test(button.textContent ?? ''))
          : dialog.querySelector('button[aria-label="Transaction filters"]')
        const search = dialog.querySelector('input[placeholder="Merchant or note…"]')
        return [explanation, search, filters].map((node) => node!.getBoundingClientRect().top - dialogTop)
      }, phone)
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

    const opening = await watch(() => header[2].click())
    const closing = await watch(() => (phone ? page.keyboard.press('Escape') : header[2].click()))
    for (const sample of [...opening, ...closing]) {
      sample.forEach((top, index) => expect(Math.abs(top - resting[index])).toBeLessThanOrEqual(0.5))
    }
  })
}
