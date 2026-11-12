import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, formatDateLabel, signUpUser, todayInTestTimezone, type TestUser } from '../support/api'
import { logInViaApi } from '../support/app'
import {
  linkToEmptyBankAccount,
  openBankLink,
  openBankLinkHoldingRead,
  READ_LINK_STATUS,
  WORKER_RESULT_TIMEOUT_MS,
  type BridgeTransaction,
} from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: which days the reminder names and how it is dismissed are the same at every size

// The reminder a linked account's Bank link section shows once a day alone still brings back as many
// transactions as SimpleFIN sends at once, run by the worker against the fake SimpleFIN Bridge.
// Everyday imports a bank account holding nothing booked but 1,000 holds from 30 days ago, so every
// part reaching today comes back with 1,000 transactions until today alone is kept. Nothing booked
// came back either, so the history reminder shows above it. Which days are flagged, and the cache
// writes behind a dismissal, are covered by backend and unit tests
const CUT_OFF = 'You may be missing some transactions'
const NO_HISTORY = 'No history returned yet'

// SimpleFIN's reported limit on the transactions one response holds
const HOLDS: BridgeTransaction[] = Array.from({ length: 1000 }, (_, index) => ({ pending: true, amount: '-1.00', description: `HOLD ${index + 1}` }))

// Whatever the status reads once the import has ended
const ANY_STATUS = /.+\./

type Reminders = { history_reminder: unknown; cut_off_day: string | null }

type Setup = { user: TestUser; accountId: string }

/** Reads the account's reminders as the server shows them */
async function readReminders(request: APIRequestContext, user: TestUser, accountId: string): Promise<Reminders> {
  const response = await request.get(`${API_BASE_URL}/accounts/${accountId}/bank-link`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  const { history_reminder, cut_off_day } = ((await response.json()) as { link: Reminders }).link
  return { history_reminder, cut_off_day }
}

/** Signs up with Everyday linked to the bank account holding 1,000 holds, and waits for the worker to end its import */
async function linkCutShort(request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToEmptyBankAccount(request, user, { accountId: account.id, startDate: daysFromTodayInTestTimezone(-30), transactions: HOLDS })
  await expect.poll(async () => {
    const { history_reminder, cut_off_day } = await readReminders(request, user, account.id)
    return history_reminder !== null && cut_off_day !== null
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(true)
  return { user, accountId: account.id }
}

/** The reminder in the Bank link section, named by its title */
function reminderNote(dialog: Locator, title: string): Locator {
  return dialog.getByRole('note', { name: title })
}

/** The bodies of the cut-off day dismissals the page sends */
function watchDismissals(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/bank-link/cut-off-day/dismiss')) sent.push(request.postData() ?? '')
  })
  return sent
}

test('reminds that some of today\'s transactions may be missing once today alone brings back as many as SimpleFIN sends at once', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkCutShort(request)
  await logInViaApi(page, setup.user)

  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)

  const note = reminderNote(dialog, CUT_OFF)
  await expect(note).toContainText(
    `SimpleFIN sent its maximum number of transactions for ${formatDateLabel(todayInTestTimezone())}, so that day may have more transactions. Please check that day's transactions.`,
  )
  await expect(note.getByRole('button', { name: 'Dismiss' })).toBeVisible()
  expect((await readReminders(request, setup.user, setup.accountId)).cut_off_day).toBe(todayInTestTimezone())
})

test('dismisses each reminder for good, focus moving from one ✕ to the next and then on to Sync now', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkCutShort(request)
  const sent = watchDismissals(page)
  await logInViaApi(page, setup.user)
  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)
  const history = reminderNote(dialog, NO_HISTORY)
  const cutOff = reminderNote(dialog, CUT_OFF)

  await history.getByRole('button', { name: 'Dismiss' }).click()
  await expect(cutOff.getByRole('button', { name: 'Dismiss' })).toBeFocused()
  await expect(history).toBeHidden()
  await page.keyboard.press('Enter')
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  await expect(cutOff).toBeHidden()

  expect(sent).toEqual([JSON.stringify({ day: todayInTestTimezone() })])
  expect(await readReminders(request, setup.user, setup.accountId)).toEqual({ history_reminder: null, cut_off_day: null })
  const again = await openBankLink(page, setup.accountId, ANY_STATUS)
  await expect(again.getByRole('button', { name: 'Unlink' })).toBeVisible()
  await expect(again.getByText(CUT_OFF)).toHaveCount(0)
  await expect(again.getByText(NO_HISTORY)).toHaveCount(0)
})

// A reminder can fold away before its dismissal answers, as a read of the link the server answers once
// the dismissal has gone through comes back without it. The modal reads the link again as it opens, and
// that read is held until the dismissal has reached the server, while the dismissal itself is held on
// its way there until the ✕s have been looked at, and its answer until the reminder has gone
test('spins only the dismissed reminder’s ✕, and moves focus on from it once its reminder folds away before its dismissal answers', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkCutShort(request)
  const dismissUrl = `${API_BASE_URL}/accounts/${setup.accountId}/bank-link/history-reminder/dismiss`
  let sendDismissal = () => {}
  const sendReleased = new Promise<void>((resolve) => { sendDismissal = resolve })
  let dismissalReached = () => {}
  const reached = new Promise<void>((resolve) => { dismissalReached = resolve })
  let answerDismissal = () => {}
  const answerReleased = new Promise<void>((resolve) => { answerDismissal = resolve })
  await page.route(dismissUrl, async (route) => {
    await sendReleased
    const response = await route.fetch()
    dismissalReached()
    await answerReleased
    await route.fulfill({ response })
  })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, READ_LINK_STATUS, reached)
  const history = reminderNote(dialog, NO_HISTORY)
  const historyDismiss = history.getByRole('button', { name: 'Dismiss' })
  const cutOffDismiss = reminderNote(dialog, CUT_OFF).getByRole('button', { name: 'Dismiss' })

  await historyDismiss.click()
  await expect(historyDismiss).toHaveAttribute('aria-busy', 'true')
  await expect(cutOffDismiss).not.toHaveAttribute('aria-busy', 'true')

  sendDismissal()
  await expect(history).toBeHidden()
  await expect(cutOffDismiss).toBeFocused()

  const answered = page.waitForResponse(dismissUrl)
  answerDismissal()
  expect((await answered).status()).toBe(200)
  expect((await readReminders(request, setup.user, setup.accountId)).history_reminder).toBeNull()
})
