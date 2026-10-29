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

// The Refund button opens a second transaction prefilled as money coming back, and saving it links the
// two, which both rows then show without a reload, and Unlink takes the link off both again
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

  // The expense's own window stays open and now names the refund, and both rows on the list show the link
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(linkIcon(page, expenseId)).toHaveAccessibleName('Refunded once')

  // Unlinking from the expense's modal takes the icon off both rows at once
  await expense.getByRole('button', { name: /^Unlink / }).click()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(0)
  await expect(page.getByTestId('transaction-refund-link').filter({ visible: true })).toHaveCount(0)
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
    await expect(linkIcon(page, expenseId)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Edit transaction', exact: true })).toBeHidden()
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

// A link the server refuses leaves the picker open with the reason, instead of closing on a link that was not made
test('keeps the picker open when the link is refused', async ({ page, request }) => {
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

  await expect(picker.getByRole('alert')).toBeVisible()
  await expect(picker).toBeVisible()
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

  // The picker closes and the edit window stays, now naming the refund, with both rows on the list showing the link
  await expect(picker).toBeHidden()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(linkIcon(page, refundId)).toHaveAccessibleName('Refund of an expense')
  await expect(linkIcon(page, expenseId)).toBeVisible()
})

// The exact amount comes first and the nearest after it, a row is picked by pressing it and unpicked by
// pressing it again, and the Link button is live only while one is picked
test('lists the closest amounts first and links the row that is picked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const expenseId = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -5000, date: daysFromTodayInTestTimezone(-6) })
  for (const [amount, daysAgo, category] of [[9000, 1, 'Groceries'], [4800, 2, 'Groceries'], [5000, 5, 'Groceries'], [5200, 3, 'Dining']] as const) {
    await createTransaction(request, user, { accountId: account.id, categoryName: category, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  }

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const expense = await openRow(page, expenseId)
  await expense.getByRole('button', { name: 'Link an existing refund', exact: true }).click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const rows = picker.getByTestId('link-candidate')
  const linkButton = picker.getByRole('button', { name: 'Link', exact: true })

  // The exact amount leads even though it is the oldest, then 4800 and 5200 are the same distance away,
  // so the newer of them, 4800, comes first, and 9000 is the farthest
  await expect(rows).toHaveCount(4)
  await expect(rows.getByTestId('transaction-amount')).toHaveText(['+$50.00', '+$48.00', '+$52.00', '+$90.00'])
  await expect(linkButton).toBeDisabled()

  // Pressing a row picks it and fades the others. Pressing it again clears the pick
  await rows.nth(1).getByRole('button').click()
  await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  await expect(rows.nth(0).getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  await expect(linkButton).toBeEnabled()

  // The picked row takes the accent border and fill, and the others dim their icons well past a faded section's
  await expect(rows.nth(1)).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(rows.nth(1)).not.toHaveCSS('box-shadow', await rows.nth(0).evaluate((row) => getComputedStyle(row).boxShadow))
  await expect(rows.nth(0)).toHaveCSS('--app-faded-icon-opacity', '0.3')
  await expect(rows.nth(1)).not.toHaveCSS('--app-faded-icon-opacity', '0.3')

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
  await rows.nth(1).getByRole('button').click()
  await expect(rows.nth(1).getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  await expect(linkButton).toBeDisabled()

  // The list's category filter narrows the candidates, which keep their order
  await picker.getByRole('button', { name: 'Transaction filters' }).click()
  await picker.getByRole('tab', { name: 'Category' }).click()
  await picker.getByRole('checkbox', { name: 'Dining' }).click()
  await picker.getByRole('button', { name: 'Apply filters' }).click()
  await expect(rows).toHaveCount(1)
  await expect(rows.getByTestId('transaction-amount')).toHaveText('+$52.00')

  await rows.getByRole('button').click()
  await expect(linkButton).toBeEnabled()
  await linkButton.click()
  await expect(picker).toBeHidden()
  await expect(expense.getByTestId('linked-transaction')).toHaveCount(1)
  await expect(linkIcon(page, expenseId)).toBeVisible()
})

// The explanation, search field and Filters button stay put while only the candidate rows scroll under them, and
// the picker is held to about 70% of the create transaction window's height
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
  const viewport = page.viewportSize()!
  const panel = await picker.boundingBox()
  expect(panel!.height).toBeLessThanOrEqual(viewport.height * 0.6 + 1)

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
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: 5200, date: daysFromTodayInTestTimezone(-3) })

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
// keep their top edges before, during and after, at a desktop, a laptop and a phone size
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
    const tops = () => Promise.all(header.map((element) => element.evaluate((node) => node.getBoundingClientRect().top)))
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
