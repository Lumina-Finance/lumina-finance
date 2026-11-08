import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { fact, logInViaApi, openPage, setTabHidden, watchServerRequests } from '../support/app'
import {
  buildLinkAnswer,
  changeProviders,
  claimSetupToken,
  createSampleBridgeScenario,
  isRead,
  linkToSampleBankAccount,
  readConnection,
  readLastSuccess,
  WORKER_RESULT_TIMEOUT_MS,
  type SeededConnection,
} from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what a sync asks of the bank and how its wording ages are the same at every size

// Sync now on a linked account, run by the worker against the fake SimpleFIN Bridge. What disables
// the button and how it reads while the sync starts are covered by the Bank link section's unit tests,
// apart from its reason keeping up with the time while the page stays open
const SAMPLE_CHEQUING = 'Everyday Chequing'

// When the connection's spent requests free up after the page opens, and how long it then stays open.
// The wait is worded to the nearest minute, so 10 minutes 15 seconds reads "in 10 minutes", and five
// minutes on "in 5 minutes", each for 45 seconds of real time passing under the page's clock
const REQUEST_FREES_UP_AFTER_MS = (10 * 60 + 15) * 1000
const BANK_LINK_OPEN_MS = 5 * 60 * 1000

// Long enough before the page opens that its Synced label reads the same throughout, so only the
// reason's own refresh can change what the button says
const SYNCED_BEFORE_MS = 3 * 60 * 60 * 1000

test('checks nothing in a background tab while the sync runs, and shows it Synced on coming back, spending one request', async ({ page, request }) => {
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
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })

  // The one button, whatever it reads as the sync starts
  const syncNow = dialog.getByRole('button', { name: /^(Sync now|Starting sync|Sync started)$/ })
  await expect(syncNow).toHaveAccessibleName('Sync now')
  const syncedBefore = await readLastSuccess(request, user, account.id)
  const usedBefore = (await readConnection(request, user, connection.id))!.request_budget.used

  await syncNow.click()
  await expect(syncNow).toHaveAccessibleName('Starting sync')
  await expect(syncNow).toBeFocused()

  // The user moves to another tab, so this one goes to the background and nothing it shows needs
  // the link list read on the timer
  await setTabHidden(page, true)
  const linkReads: string[] = []
  page.on('request', (sent) => {
    if (isRead('/bank-sync/links')(new URL(sent.url()))) linkReads.push(sent.url())
  })

  // The status read Synced just now before the sync too, so the sync is known to have finished once
  // the server's last success moves
  await expect.poll(() => readLastSuccess(request, user, account.id), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBe(syncedBefore)
  expect(linkReads).toEqual([])

  // Coming back reads the list and finds the sync over. A button greyed for the sync running
  // keeps the name Sync now, so only the status and the button's state show the dialogue got there
  await setTabHidden(page, false)
  await expect(syncNow).toHaveAccessibleName('Sync now')
  await expect(syncNow).toBeFocused()
  await expect(fact(dialog, 'Status')).toHaveText(/^Synced just now/)
  await expect(syncNow).not.toHaveAttribute('aria-disabled', 'true')

  // The request is counted before the sync records its success
  expect((await readConnection(request, user, connection.id))!.request_budget.used).toBe(usedBefore + 1)

  // Escape still closes the modal, since the button kept the focus throughout
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})

// The link and its connection's spent budget are answered here, spent as the page's clock starts,
// since the server's requests can't be timed to it. The worker is answered as running, so the spent
// budget is what holds Sync now back
test('words when more requests are available anew as minutes pass with the bank link open', async ({ page, request }) => {
  const user = await signUpUser(request)
  const scenario = await createSampleBridgeScenario(request)
  const [account, connection] = await Promise.all([
    createAccount(request, user, { name: 'Everyday' }),
    claimSetupToken(request, user, scenario.setupToken),
  ])
  const spentAt = new Date()
  const syncedAt = new Date(spentAt.getTime() - SYNCED_BEFORE_MS).toISOString()
  const availableAgainAt = new Date(spentAt.getTime() + REQUEST_FREES_UP_AFTER_MS).toISOString()
  await page.route(`${API_BASE_URL}/accounts/${account.id}/bank-link`, (route) => route.fulfill({
    json: {
      account_id: account.id,
      link: { ...buildLinkAnswer(account.id, { last_success_at: syncedAt }), connection_id: connection.id },
      previous_link: null,
    },
  }))
  await page.route(isRead('/bank-sync/connections'), async (route) => {
    const response = await route.fetch()
    const connections = (await response.json() as SeededConnection[]).map((listed) => ({
      ...listed,
      request_budget: { ...listed.request_budget, used: listed.request_budget.limit, available_again_at: availableAgainAt },
    }))
    await route.fulfill({ response, json: connections })
  })
  await changeProviders(page, (body) => {
    body.sync_running = true
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: spentAt })
  await logInViaApi(page, user)
  const allLanded = watchServerRequests(page)
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Bank sync: Synced 3 hours ago. Open bank link' }).click()
  const syncNow = page.getByRole('dialog', { name: 'Edit account', exact: true }).getByRole('button', { name: 'Sync now' })
  const spent = (when: string) => `This connection has used its 20 SimpleFIN requests in the last 24 hours. More are available ${when}.`
  await expect(syncNow).toHaveAccessibleDescription(spent('in 10 minutes'))

  await allLanded()
  await page.clock.runFor(BANK_LINK_OPEN_MS)
  await expect(syncNow).toHaveAccessibleDescription(spent('in 5 minutes'))
})
