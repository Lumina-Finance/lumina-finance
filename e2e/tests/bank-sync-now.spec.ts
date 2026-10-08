import { expect, test, type APIRequestContext } from '@playwright/test'

import { asUser, createAccount, signUpUser, type TestUser } from '../support/api'
import { fact, logInViaApi, openPage } from '../support/app'
import { linkToSampleBankAccount, readConnection, WORKER_RESULT_TIMEOUT_MS } from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// Sync now on a linked account, run by the worker against the fake SimpleFIN Bridge. What disables
// the button and how it reads while the sync starts are covered by the Bank link section's unit tests
const SAMPLE_CHEQUING = 'Everyday Chequing'

/** Reads when the account last synced, as the server has it */
async function readLastSuccess(request: APIRequestContext, user: TestUser, accountId: string): Promise<string | null> {
  const response = await request.get(`${API_BASE_URL}/accounts/${accountId}/bank-link`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { link: { sync: { last_success_at: string | null } } }).link.sync.last_success_at
}

test('reaches Synced in a background tab without the window being focused, spending one request', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })

  // The bank's balance matches the empty ledger, so no opening balance waits to be confirmed
  const { connection } = await linkToSampleBankAccount(request, user, {
    accountId: account.id,
    bankAccountName: SAMPLE_CHEQUING,
    balances: { balance: '0.00' },
  })

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const bankSync = page.getByRole('button', { name: /^Bank sync: Synced (just now|\d+ minutes? ago)\. Open bank link$/ })
  await expect(bankSync).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  await bankSync.click()
  const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })

  // The one button, whatever it reads as the sync starts
  const syncNow = dialog.getByRole('button', { name: /^(Sync now|Starting sync|Sync started)$/ })
  await expect(syncNow).toHaveAccessibleName('Sync now')
  const syncedBefore = await readLastSuccess(request, user, account.id)
  const usedBefore = (await readConnection(request, user, connection.id))!.request_budget.used

  await syncNow.click()
  await expect(syncNow).toHaveAccessibleName('Starting sync')
  await expect(syncNow).toBeFocused()

  // The user moves to another tab, so this one runs in the background and its window isn't focused
  // again. The app reads the tab's visibility, which this sets as the browser would
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })

  // Only the background poll can find the worker started the sync. The status read Synced just now
  // before it too, so the sync is known to have finished once the server's last success moves
  await expect(syncNow).toHaveAccessibleName('Sync started', { timeout: WORKER_RESULT_TIMEOUT_MS })
  await expect(syncNow).toHaveAccessibleName('Sync now', { timeout: WORKER_RESULT_TIMEOUT_MS })
  await expect(syncNow).toBeFocused()
  await expect.poll(() => readLastSuccess(request, user, account.id), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBe(syncedBefore)

  // The background tab's poll then finds the sync over. A button greyed for the sync running keeps
  // the name Sync now, so only the status and the button's state show the dialog got there
  await expect(fact(dialog, 'Status')).toHaveText(/^Synced just now/, { timeout: WORKER_RESULT_TIMEOUT_MS })
  await expect(syncNow).not.toHaveAttribute('aria-disabled', 'true')

  // The request is counted before the sync records its success
  expect((await readConnection(request, user, connection.id))!.request_budget.used).toBe(usedBefore + 1)

  // Escape still closes the modal, since the button kept the focus throughout
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
