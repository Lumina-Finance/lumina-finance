import { expect, test, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage, waitForRequestsSoFar } from '../support/app'
import {
  addBridgeTransactions,
  isRead,
  linkToEmptyBankAccount,
  readLastSuccess,
  readReviewItems,
  reviewBlock,
  syncBankLinkNow,
  WORKER_RESULT_TIMEOUT_MS,
} from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the running balance and the refreshes Add Transaction holds back while open
// don't change with the width

// How often the app reads the list of bank links while no sync or import runs
const LINKS_IDLE_POLL_MS = 60 * 1000

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

// The tab stays in view while the page's clock moves past the link list's next read. That read finds the
// sync over. Coming back to the tab instead would also run the check for changes made elsewhere.
// That check refreshes the review inbox by itself once the dialogue closes
test('keeps the running balance in Add transaction when a bank sync ends behind it, then shows what the sync brought in', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Wallet', startingBalance: 100000 })
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const { scenario, externalAccountId } = await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
  })
  // The link's import is over and brought in nothing, so the page opens on the list of links as it
  // stays until the sync below, with nothing waiting for review
  await expect.poll(() => readLastSuccess(request, user, everyday.id), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBeNull()
  expect(await readReviewItems(request, user, everyday.id)).toEqual([])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install()
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  await dialog.getByRole('checkbox', { name: /Keep modal open after adding/ }).check()
  await chooseFromDropdown(dialog, 'Account', 'Wallet')
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  const amount = dialog.getByLabel('Amount')
  const submit = dialog.getByTestId('transaction-submit')

  await amount.fill('100.00')
  await submit.click()
  await expect(amount).toHaveValue('')
  await expect(dialog.getByText('$900.00', { exact: true })).toBeVisible()

  // Everyday's bank sync brings in a purchase behind the open dialogue. Reloading the balances once
  // the link list shows the sync over would count the first create twice
  const reloads = recordChecksAndReloads(page)
  const syncedBefore = await readLastSuccess(request, user, everyday.id)
  await addBridgeTransactions(request, scenario.id, externalAccountId, [
    { posted: daysFromTodayInTestTimezone(-1), amount: '-12.50', description: 'HARBOUR GROCER' },
  ])
  await syncBankLinkNow(request, user, everyday.id)
  await expect.poll(() => readLastSuccess(request, user, everyday.id), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBe(syncedBefore)
  const finishedSyncRead = page.waitForResponse(async (response) => {
    if (!isRead('/bank-sync/links')(new URL(response.url())) || !response.ok()) return false
    const links = (await response.json()) as { account_id: string; sync: { last_success_at: string | null } }[]
    return links.some((link) => link.account_id === everyday.id && link.sync.last_success_at !== syncedBefore)
  })
  await page.clock.runFor(LINKS_IDLE_POLL_MS)
  await finishedSyncRead

  await amount.fill('50.00')
  await submit.click()
  await expect(amount).toHaveValue('')
  await expect(dialog.getByText('$850.00', { exact: true })).toBeVisible()
  await waitForRequestsSoFar(page)
  expect(reloads, 'The bank sync reloaded the lists behind the open dialogue').toEqual([])

  // Closing runs the refresh the finished sync held back. That refresh alone reads the review inbox again,
  // and catches the list up with each create once. The dialogue fades out on the browser's own clock.
  // The page's clock has run ahead of it, so the checks don't wait for the fade to end
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(reviewBlock(page).getByRole('listitem').filter({ hasText: 'HARBOUR GROCER' })).toBeVisible()
  const amounts = page.getByTestId(/^transaction-row-/).getByTestId('transaction-amount').filter({ visible: true })
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
