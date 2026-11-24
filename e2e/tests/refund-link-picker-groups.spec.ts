// The Link a refund picker's groups, the reasons on its likely matches, the folded row of what can't be linked and the
// preview of the chain linking makes. Runs on desktop, as the picker is the same markup at every size. The phone test
// sets its own 375x667 size to check the preview stays in view while the list scrolls
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

async function createMerchant(request: APIRequestContext, user: TestUser, name: string) {
  const response = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name } })
  expect(response.status()).toBe(201)
}

async function link(request: APIRequestContext, user: TestUser, refundId: string, expenseId: string) {
  const response = await request.post(`${API_BASE_URL}/transactions/${refundId}/refund-link`, {
    headers: asUser(user),
    data: { original_transaction_id: expenseId },
  })
  expect(response.ok()).toBe(true)
}

/**
 * A $420.00 Harbor Electronics expense with two $142.50 refunds linked, so $135.00 is left. The likely money in is a
 * $135.00 Harbor refund and a $60.00 Harbor credit. A $130.00 Northwind Supply payment fits too. A $3,200.00 payroll
 * deposit and a $140.00 Corner Shop payment are more than what's left. For the $135.00 refund, a $135.00 Northwind
 * Supply bill and a $1,000.00 Harbor order are likely expenses, a $200.00 dinner fits, and a $50.00 Corner Shop
 * purchase has less left than the refund
 */
async function seed(request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 500000 })
  for (const name of ['Harbor Electronics', 'Northwind Supply', 'Payroll Co', 'Corner Shop']) {
    await createMerchant(request, user, name)
  }
  const at = (merchantName: string, amount: number, daysAgo: number, categoryName = 'Groceries') =>
    createTransaction(request, user, { accountId: account.id, categoryName, merchantName, amount, date: daysFromTodayInTestTimezone(-daysAgo) })
  const expenseId = await at('Harbor Electronics', -42000, 12)
  for (const daysAgo of [11, 10]) await link(request, user, await at('Harbor Electronics', 14250, daysAgo), expenseId)
  const ids = {
    expenseId,
    harborRefund: await at('Harbor Electronics', 13500, 1),
    harborCredit: await at('Harbor Electronics', 6000, 2),
    northwind: await at('Northwind Supply', 13000, 3),
    payroll: await at('Payroll Co', 320000, 4, 'Salary'),
    corner: await at('Corner Shop', 14000, 5),
    northwindBill: await at('Northwind Supply', -13500, 6),
    harborOrder: await at('Harbor Electronics', -100000, 7),
    dinner: await at('Corner Shop', -20000, 8, 'Dining'),
    cornerPurchase: await at('Corner Shop', -5000, 9),
  }
  return { user, account, ids }
}

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

async function openPicker(page: Page, request: APIRequestContext, from: 'expense' | 'refund') {
  const { user, account, ids } = await seed(request)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openRow(page, from === 'expense' ? ids.expenseId : ids.harborRefund)
  await dialog.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: from === 'expense' ? 'Link a refund' : 'Link to an expense', exact: true })
  await expect(picker).toBeVisible()
  return { dialog, picker }
}

const group = (picker: Locator, key: 'likely' | 'other') => picker.getByTestId(`link-group-${key}`)
const amounts = (scope: Locator) => scope.getByTestId('link-candidate').getByTestId('transaction-amount')
const folded = (picker: Locator) => picker.getByRole('button', { name: /can't be linked/ })
const preview = (picker: Locator) => picker.getByTestId('link-chain-preview')

function rowWith(scope: Locator, merchant: string, amount: string) {
  return scope
    .getByTestId('link-candidate')
    .filter({ hasText: merchant })
    .filter({ has: scope.page().getByTestId('transaction-amount').filter({ hasText: amount }) })
}

// Example 1: the header names the expense, the likely matches lead with their reasons, every other refund that fits
// follows, what is more than is left folds into one row, and the preview shows the chain as it stands
test('groups an expense picker by fit and previews the chain as it stands', async ({ page, request }) => {
  const { picker } = await openPicker(page, request, 'expense')

  await expect(picker.getByText(/^Harbor Electronics · .+ · −\$420\.00$/)).toBeVisible()
  await expect(picker.getByText(/^Pick money that comes in/)).toHaveCount(0)

  await expect(group(picker, 'likely').getByRole('heading')).toHaveText('Likely matches')
  await expect(amounts(group(picker, 'likely'))).toHaveText(['+$135.00', '+$60.00'])
  await expect(group(picker, 'likely').getByTestId('link-candidate').nth(0).getByTestId('likely-chip')).toHaveText(['Same merchant', 'Exact amount'])
  await expect(group(picker, 'likely').getByTestId('link-candidate').nth(1).getByTestId('likely-chip')).toHaveText(['Same merchant'])
  await expect(group(picker, 'other').getByRole('heading')).toHaveText('Other money in')
  await expect(group(picker, 'other').getByTestId('link-candidate')).toHaveText([/Northwind Supply/])
  await expect(group(picker, 'other').getByTestId('likely-chip')).toHaveCount(0)

  await expect(folded(picker)).toHaveText("2 can't be linked, each more than what's left")
  await expect(folded(picker)).toHaveAttribute('aria-expanded', 'false')
  await folded(picker).click()
  const unlinkable = picker.getByTestId('unlinkable-candidates').getByTestId('link-candidate')
  await expect(unlinkable).toHaveCount(2)
  for (const row of await unlinkable.all()) {
    await expect(row).toContainText('This refund is more than the $135.00 left to refund')
  }

  await expect(preview(picker)).toContainText('Harbor Electronics')
  await expect(preview(picker).getByTestId('refund-chain-note')).toHaveText('2 refunds linked')
  await expect(preview(picker).getByTestId('refund-chain-new')).toHaveCount(0)
  await expect(preview(picker).getByTestId('refund-status')).toHaveText('Partly refunded')
  await expect(preview(picker).getByTestId('refund-room')).toHaveText('$135.00')
})

// Example 2: picking the exact refund adds it to the preview marked New, refunded in full, and Link makes the same
// chain in the Refunds section
test('previews a pick that refunds in full and links the same chain', async ({ page, request }) => {
  const { dialog, picker } = await openPicker(page, request, 'expense')

  await rowWith(group(picker, 'likely'), 'Harbor Electronics', '+$135.00').getByRole('button').click()
  await expect(preview(picker).getByTestId('refund-chain-new')).toHaveCount(1)
  await expect(preview(picker).getByTestId('refund-status')).toHaveText('Refunded in full')
  await expect(preview(picker).getByTestId('refund-room')).toHaveText('$0.00')
  // The rows that no longer fit fold away while the picked one stays in its group
  await expect(amounts(group(picker, 'likely'))).toHaveText(['+$135.00'])
  await expect(folded(picker)).toHaveText("4 can't be linked, nothing is left to refund")

  await picker.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(picker).toBeHidden()
  await expect(dialog.getByTestId('linked-transaction')).toHaveCount(3)
  await expect(dialog.getByTestId('refund-status')).toHaveText('Refunded in full')
  await expect(dialog.getByTestId('refund-room')).toHaveText('$0.00')
})

// Example 3: a partial pick folds the rows it leaves no room for, and unpicking brings them back to their groups. A
// screen reader hears the new totals from their polite live region
test('folds the rows a partial pick leaves no room for and brings them back', async ({ page, request }) => {
  const { picker } = await openPicker(page, request, 'expense')
  const credit = rowWith(group(picker, 'likely'), 'Harbor Electronics', '+$60.00').getByRole('button')

  await credit.click()
  const totals = preview(picker).locator('[aria-live="polite"]')
  await expect(totals).toHaveAttribute('aria-atomic', 'true')
  await expect(totals).toContainText('Partly refunded')
  await expect(totals).toContainText('$75.00')
  await expect(folded(picker)).toHaveText("4 can't be linked, each more than what's left")
  await expect(amounts(group(picker, 'likely'))).toHaveText(['+$60.00'])
  await expect(group(picker, 'other')).toHaveCount(0)

  await credit.click()
  await expect(totals).toContainText('$135.00')
  await expect(folded(picker)).toHaveText("2 can't be linked, each more than what's left")
  await expect(amounts(group(picker, 'likely'))).toHaveText(['+$135.00', '+$60.00'])
  await expect(amounts(group(picker, 'other'))).toHaveText(['+$130.00'])
})

// Example 4: a search narrows every group, and a group left with no rows drops its heading
test('hides a group and its heading when a search leaves it empty', async ({ page, request }) => {
  const { picker } = await openPicker(page, request, 'expense')

  await picker.getByPlaceholder('Merchant or note…').fill('north')
  await expect(group(picker, 'likely')).toHaveCount(0)
  await expect(picker.getByRole('heading', { name: 'Likely matches' })).toHaveCount(0)
  await expect(group(picker, 'other').getByTestId('link-candidate')).toHaveText([/Northwind Supply/])
  await expect(folded(picker)).toHaveCount(0)
})

// Example 5: a refund's picker offers as likely the expenses from its merchant or with exactly its amount left, folds
// the one with less left, and previews the chain of the expense picked with this refund marked New
test('groups a refund picker by fit and previews the picked expense chain', async ({ page, request }) => {
  const { picker } = await openPicker(page, request, 'refund')

  await expect(picker.getByText(/^Harbor Electronics · .+ · \+\$135\.00$/)).toBeVisible()
  await expect(amounts(group(picker, 'likely'))).toHaveText(['−$420.00', '−$135.00', '−$1,000.00'])
  await expect(group(picker, 'likely').getByTestId('link-candidate').nth(0).getByTestId('likely-chip')).toHaveText(['Same merchant', 'Exact amount'])
  await expect(group(picker, 'likely').getByTestId('link-candidate').nth(1).getByTestId('likely-chip')).toHaveText(['Exact amount'])
  await expect(group(picker, 'likely').getByTestId('link-candidate').nth(2).getByTestId('likely-chip')).toHaveText(['Same merchant'])
  await expect(group(picker, 'other').getByRole('heading')).toHaveText('Other expenses')
  await expect(amounts(group(picker, 'other'))).toHaveText(['−$200.00'])
  await expect(folded(picker)).toHaveText("1 can't be linked, with less than this refund left")

  // Before a pick the preview shows this refund, marked New, under a prompt to pick its expense
  await expect(preview(picker)).toContainText('Pick the expense this refund gives money back for.')
  await expect(preview(picker).getByTestId('refund-chain-new')).toHaveCount(1)

  await rowWith(group(picker, 'likely'), 'Harbor Electronics', '−$420.00').getByRole('button').click()
  await expect(preview(picker)).not.toContainText('Pick the expense')
  await expect(preview(picker).getByTestId('refund-chain-note')).toHaveText('2 refunds linked')
  await expect(preview(picker).getByTestId('refund-chain-new')).toHaveCount(1)
  await expect(preview(picker).getByTestId('refund-status')).toHaveText('Refunded in full')
  await expect(preview(picker).getByTestId('refund-room')).toHaveText('$0.00')
})

// The keyboard reaches the likely matches, the other rows, the folded row and its rows once open, then the buttons, in
// that order
test('reaches every row, the folded row and Link in order with Tab', async ({ page, request }) => {
  const { picker } = await openPicker(page, request, 'expense')
  await expect(picker.getByPlaceholder('Merchant or note…')).toBeFocused()
  await picker.getByRole('button', { name: 'Transaction filters' }).focus()

  const expected = [
    rowWith(group(picker, 'likely'), 'Harbor Electronics', '+$135.00').getByRole('button'),
    rowWith(group(picker, 'likely'), 'Harbor Electronics', '+$60.00').getByRole('button'),
    rowWith(group(picker, 'other'), 'Northwind Supply', '+$130.00').getByRole('button'),
    folded(picker),
  ]
  for (const control of expected) {
    await page.keyboard.press('Tab')
    await expect(control).toBeFocused()
  }
  await page.keyboard.press('Enter')
  await page.keyboard.press('Tab')
  await expect(picker.getByTestId('unlinkable-candidates').getByTestId('link-candidate').first().getByRole('button')).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(picker.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
})

// On a short phone the preview and the buttons stay in view while the list scrolls under the header
test('keeps the preview in view on a phone while the list scrolls', async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 667 })
  const { picker } = await openPicker(page, request, 'expense')
  await rowWith(group(picker, 'likely'), 'Harbor Electronics', '+$60.00').getByRole('button').click()
  await folded(picker).click()

  const body = picker.locator('[data-tooltip-bounds]')
  await body.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  for (const control of [preview(picker).getByTestId('refund-room'), picker.getByRole('button', { name: 'Link', exact: true })]) {
    await expect(control).toBeInViewport({ ratio: 1 })
  }
  // The list keeps room to show at least one row
  expect((await body.boundingBox())!.height).toBeGreaterThanOrEqual(120)
})
