// The Refund button on an expense's edit window: it starts a refund of what is left, it is held off with its reason
// once the linked refunds make the expense whole, and its border shows only under the pointer or on keyboard focus
import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

const FULLY_REFUNDED = 'This expense is already fully refunded'

async function openRow(page: Page, id: string) {
  await page.getByTestId(`transaction-row-${id}`).click()
  const dialog = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  await expect(dialog).toBeVisible()
  return dialog
}

// Picks the refund with this amount in the picker and confirms it, so the window holds it until Save
async function holdLink(page: Page, dialog: Locator, amount: string) {
  await dialog.getByTestId('link-existing').click()
  const picker = page.getByRole('dialog', { name: 'Link a refund', exact: true })
  const amountText = page.getByTestId('transaction-amount').filter({ hasText: amount })
  await picker.getByTestId('link-candidate').filter({ has: amountText }).getByRole('button').click()
  await picker.getByRole('button', { name: 'Link', exact: true }).click()
  await expect(picker).toBeHidden()
}

// A $37.13 expense with $20.00 and $12.00 of money in to link, and the $20.00 refund already saved against it
async function expenseWithOneSavedRefund(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3713, date: daysFromTodayInTestTimezone(-6) })
  await createTransaction(request, user, { ...row, amount: 2000, date: daysFromTodayInTestTimezone(-2) })
  await createTransaction(request, user, { ...row, amount: 1200, date: daysFromTodayInTestTimezone(-1) })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const first = await openRow(page, expenseId)
  await holdLink(page, first, '+$20.00')
  await first.getByTestId('transaction-submit').click()
  await expect(first).toBeHidden()
  return { expenseId, dialog: await openRow(page, expenseId) }
}

// Refund starts at the expense less the linked refunds, to the cent, counting the changes held until Save
test('starts the refund at what is left, counting held links and unlinks', async ({ page, request }) => {
  const { dialog } = await expenseWithOneSavedRefund(page, request)
  const refund = page.getByRole('dialog', { name: 'Add refund', exact: true })
  const startAmount = async () => {
    await dialog.getByTestId('transaction-refund').click()
    await expect(refund).toBeVisible()
    const value = await refund.getByLabel('Amount').inputValue()
    await refund.getByRole('button', { name: 'Cancel' }).click()
    await expect(refund).toBeHidden()
    return value
  }

  // $37.13 less the $20.00 saved link is $17.13, which a float sum would not give exactly
  expect(await startAmount()).toBe('17.13')

  // A $12.00 link held until Save comes off too
  await holdLink(page, dialog, '+$12.00')
  expect(await startAmount()).toBe('5.13')

  // Unlinking the saved $20.00 is held as well, and gives its money back
  await dialog.getByRole('button', { name: /^Unlink / }).first().click()
  expect(await startAmount()).toBe('25.13')
})

// Once the linked refunds total the whole expense the button is held off, with its reason in the shared tooltip
test('holds the Refund button off once the linked refunds make the expense whole', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const row = { accountId: account.id, categoryName: 'Groceries' }
  const expenseId = await createTransaction(request, user, { ...row, amount: -3713, date: daysFromTodayInTestTimezone(-6) })
  await createTransaction(request, user, { ...row, amount: 2000, date: daysFromTodayInTestTimezone(-2) })
  await createTransaction(request, user, { ...row, amount: 1713, date: daysFromTodayInTestTimezone(-1) })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openRow(page, expenseId)
  const button = dialog.getByTestId('transaction-refund')
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')

  // Two held links that total the expense hold the button off before anything is saved
  await holdLink(page, dialog, '+$20.00')
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')
  await holdLink(page, dialog, '+$17.13')
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  await button.hover()
  const tooltip = page.getByTestId('disabled-reason-tooltip').filter({ hasText: FULLY_REFUNDED })
  await expect(tooltip).toBeVisible()
  await expect(button).toHaveCSS('cursor', 'not-allowed')

  // Pressing it opens nothing, from the mouse and the keyboard
  await button.click({ force: true })
  await button.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: 'Add refund', exact: true })).toHaveCount(0)

  // Keyboard focus shows the reason and keeps the focus ring, as a greyed button does elsewhere
  await page.mouse.move(0, 0)
  await button.blur()
  await button.focus()
  await expect(page.getByTestId('disabled-reason-tooltip').filter({ hasText: FULLY_REFUNDED })).toBeVisible()
  await expect(button).toHaveCSS('outline-style', 'solid')

  // Unlinking one of them held gives the room back and the button works again
  await dialog.getByRole('button', { name: /^Unlink / }).first().click()
  await expect(button).not.toHaveAttribute('aria-disabled', 'true')
  await button.click()
  await expect(page.getByRole('dialog', { name: 'Add refund', exact: true })).toBeVisible()
})

// The icon rests with no border and its border eases in under the pointer and on keyboard focus
test('shows the Refund icon with no border until the pointer or focus is on it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 50000 })
  const expenseId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -3713,
    date: daysFromTodayInTestTimezone(-6),
  })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = await openRow(page, expenseId)
  const button = dialog.getByTestId('transaction-refund')
  await page.mouse.move(0, 0)
  await expect(button).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')

  // The border is a transition, not a jump: caught partway it is neither clear nor final
  const border = () => button.evaluate((node) => getComputedStyle(node).borderTopColor)
  await button.hover()
  await expect(button).not.toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')
  const hovered = await border()
  await page.mouse.move(0, 0)
  await expect(button).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)')

  // Focus from the keyboard looks as hover does, with its border, and keeps the focus ring since it rests borderless
  await button.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(button).toBeFocused()
  await expect.poll(border).toBe(hovered)
  await expect(button).toHaveCSS('outline-style', 'solid')
  await expect(button).not.toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)')
})
