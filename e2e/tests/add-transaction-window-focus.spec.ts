import { expect, test, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage, setTabHidden } from '../support/app'
import { isRead, linkToEmptyBankAccount, readLastSuccess, syncBankLinkNow, WORKER_RESULT_TIMEOUT_MS } from '../support/bankSync'
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

test('keeps the running balance in Add transaction right after switching windows', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing', startingBalance: 100000 })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
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
  await expect(amounts.filter({ hasText: '−$100.00' })).toHaveCount(1)
  await expect(amounts.filter({ hasText: '−$50.00' })).toHaveCount(1)
})

test('keeps the running balance in Add transaction when a bank sync ends while the tab is away', async ({ page, request }) => {
  const user = await signUpUser(request)
  const wallet = await createAccount(request, user, { name: 'Wallet', startingBalance: 100000 })
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await linkToEmptyBankAccount(request, user, { accountId: everyday.id, startDate: daysFromTodayInTestTimezone(-10) })
  // The link's import is over, so the page opens on the list of links as it stays until the sync below
  await expect.poll(() => readLastSuccess(request, user, everyday.id), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBeNull()
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${wallet.id}`)

  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  await dialog.getByRole('checkbox', { name: /Keep modal open after adding/ }).check()
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  const amount = dialog.getByLabel('Amount')
  const submit = dialog.getByTestId('transaction-submit')

  await amount.fill('100.00')
  await submit.click()
  await expect(amount).toHaveValue('')
  await expect(dialog.getByText('$900.00', { exact: true })).toBeVisible()

  // Another account's bank sync ends while the tab is in the background. Coming back reads the list
  // of links, which finds the sync over, and reloading the balances under the open dialogue would
  // count the first create twice
  const reloads = recordChecksAndReloads(page)
  const syncedBefore = await readLastSuccess(request, user, everyday.id)
  await setTabHidden(page, true)
  await syncBankLinkNow(request, user, everyday.id)
  await expect.poll(() => readLastSuccess(request, user, everyday.id), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBe(syncedBefore)
  const linksRead = page.waitForResponse((response) => isRead('/bank-sync/links')(new URL(response.url())))
  await setTabHidden(page, false)
  await linksRead

  await amount.fill('50.00')
  await submit.click()
  await expect(amount).toHaveValue('')
  await expect(dialog.getByText('$850.00', { exact: true })).toBeVisible()
  // The list of links answered before the create was sent, so by the time the create has answered,
  // any check or reload the answer set off has already been sent
  expect(reloads, 'The bank sync reloaded the lists behind the open dialogue').toEqual([])

  // Closing catches the page up, showing each create once beside the starting balance's row
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  const amounts = page.getByTestId(/^transaction-row-/).getByTestId('transaction-amount').filter({ visible: true })
  await expect(amounts).toHaveCount(3)
  await expect(amounts.filter({ hasText: '−$100.00' })).toHaveCount(1)
  await expect(amounts.filter({ hasText: '−$50.00' })).toHaveCount(1)
})

test('shows a change made in another window once Add transaction closes', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday Chequing' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const id = await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250 })
  await returnToWindow(page)
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()

  // Nothing brings the window to the front again, so the row arrives only if closing the
  // dialogue runs the check it held back
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeVisible()
})
