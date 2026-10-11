import { expect, test, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

/**
 * Tells the app the window has come back to the front, which is what switching to another window
 * and back does. The app's check for changes made elsewhere listens for this event
 */
async function returnToWindow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
}

/** Records every check for changes made elsewhere, and every reload of the account or transaction lists, from now on */
function recordChecksAndReloads(page: Page): string[] {
  const reloads: string[] = []
  const listPaths = new Set([`${API_BASE_URL}/me/cache-status`, `${API_BASE_URL}/accounts`, `${API_BASE_URL}/transactions`])
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (request.method() === 'GET' && listPaths.has(`${url.origin}${url.pathname}`)) reloads.push(request.url())
  })
  return reloads
}

test('keeps the running balance in Add Transaction right after switching windows', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing', startingBalance: 100000 })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  await dialog.getByRole('checkbox', { name: /Keep modal open after adding/ }).check()
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  const amount = dialog.getByLabel('Amount')
  const submit = dialog.getByTestId('transaction-submit')

  await amount.fill('100.00')
  await submit.click()
  await expect(amount).toHaveValue('')
  await expect(dialog.getByText('$900.00', { exact: true })).toBeVisible()

  // The first create changed the account on the server, so coming back to the window finds a
  // change. Reloading the balance under the open dialogue would count that create twice
  const reloads = recordChecksAndReloads(page)
  await returnToWindow(page)
  await amount.fill('50.00')
  await submit.click()
  await expect(amount).toHaveValue('')
  await expect(dialog.getByText('$850.00', { exact: true })).toBeVisible()
  // The check would start the moment the window came back, so by the time the create it raced has
  // answered, any check or reload it set off has already been sent
  expect(reloads, 'The window switch checked for changes or reloaded the lists behind the open dialogue').toEqual([])

  // Closing catches the page up, showing each create once beside the starting balance's row
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  const amounts = page.getByTestId(/^transaction-row-/).getByTestId('transaction-amount').filter({ visible: true })
  await expect(amounts).toHaveCount(3)
  await expect(amounts.filter({ hasText: '-$100.00' })).toHaveCount(1)
  await expect(amounts.filter({ hasText: '-$50.00' })).toHaveCount(1)
})

test('shows a change made in another window once Add Transaction closes', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const id = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250 })
  await returnToWindow(page)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()

  // Nothing brings the window to the front again, so the row arrives only if closing the
  // dialogue runs the check it held back
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeVisible()
})
