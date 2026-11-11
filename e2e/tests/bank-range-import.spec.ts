import { expect, test, type APIRequestContext } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, formatDateLabel, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, typeDate } from '../support/app'
import {
  addBridgeBankAccount,
  addBridgeBankLogin,
  addBridgeTransactions,
  claimSetupToken,
  createEmptyBridgeScenario,
  openBankLink,
  readReviewItems,
  startBankImport,
  waitForReviewItems,
  WORKER_RESULT_TIMEOUT_MS,
  type ReviewItem,
} from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the date range fields and the restore option work the same at every size, and
// their layout is covered by unit tests

// A date range import, run by the worker against the fake SimpleFIN Bridge. The account links with a
// date range ending before today, so syncing picks up from today and the days between the range's end
// and today are left out. A later import from the Bank link section then brings back an item dismissed
// before, with the option ticked, alongside one the bank added since. How each window is fetched,
// counted and stored is covered by the server's tests, so the browser checks the choices it sends and
// what waits for review afterwards
const SYNCED_STATUS = /Synced (just now|\d+ minutes? ago)\./
const SAMPLE_CHEQUING = 'Everyday Chequing'
const RESTORE_LABEL = 'Bring back dismissed items'
const RESTORE_WARNING =
  "This may change the account's balance in ways that are hard to predict if it was brought up to date with a balance adjustment. Reconcile carefully afterwards."

// The days the bank reports, counted from today
const LINK_FROM = daysFromTodayInTestTimezone(-45)
const LINK_TO = daysFromTodayInTestTimezone(-10)
const EARLIEST = { posted: daysFromTodayInTestTimezone(-40), amount: '-12.00', description: 'BAKERY' }
const DISMISSED = { posted: daysFromTodayInTestTimezone(-30), amount: '-45.50', description: 'HARDWARE' }
const LATEST = { posted: daysFromTodayInTestTimezone(-20), amount: '-8.25', description: 'COFFEE' }
const AFTER_RANGE = { posted: daysFromTodayInTestTimezone(-5), amount: '-60.00', description: 'GROCER' }
const ADDED_LATER = { posted: daysFromTodayInTestTimezone(-28), amount: '-19.99', description: 'BOOKSHOP' }
const LATER_FROM = daysFromTodayInTestTimezone(-35)
const LATER_TO = daysFromTodayInTestTimezone(-25)

type Setup = { user: TestUser; accountId: string; scenarioId: string; bankAccountId: string }

/** Signs up with Everyday not linked, and a connection to a bank account reporting the four days above */
async function connectBank(request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const [account, scenario] = await Promise.all([createAccount(request, user, { name: 'Everyday' }), createEmptyBridgeScenario(request)])
  const connId = await addBridgeBankLogin(request, scenario.id, 'Harbour Bank')
  const bankAccountId = await addBridgeBankAccount(request, scenario.id, { connId, name: SAMPLE_CHEQUING, currency: 'CAD' })
  await addBridgeTransactions(request, scenario.id, bankAccountId, [EARLIEST, DISMISSED, LATEST, AFTER_RANGE])
  await claimSetupToken(request, user, scenario.setupToken)
  return { user, accountId: account.id, scenarioId: scenario.id, bankAccountId }
}

/** The items waiting, as their days and descriptions, earliest first */
function describeItems(items: ReviewItem[]): [string, string][] {
  return items.map((item): [string, string] => [item.bank.date, item.bank.description]).sort(([a], [b]) => a.localeCompare(b))
}

/** The link's date range import and its outcome, as the server has them */
async function readRange(request: APIRequestContext, { user, accountId }: Setup): Promise<{ range_import: unknown; range_outcome: unknown }> {
  const response = await request.get(`${API_BASE_URL}/accounts/${accountId}/bank-link`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  const { link } = (await response.json()) as { link: { range_import: unknown; range_outcome: unknown } }
  return { range_import: link.range_import, range_outcome: link.range_outcome }
}

test('links with a date range ending before today, then imports a range again bringing back a dismissed item', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await connectBank(request)
  const { user, accountId } = setup
  await logInViaApi(page, user)

  // Linking with a date range says syncing picks up from today and leaves the days after To alone
  const dialog = await openBankLink(page, accountId, 'Not linked')
  await dialog.getByRole('button', { name: 'Link bank account' }).click()
  const flow = page.getByRole('dialog', { name: 'Link bank account' })
  await flow.getByRole('radio', { name: new RegExp(`^${SAMPLE_CHEQUING}`) }).click()
  await flow.getByRole('button', { name: 'Continue' }).click()
  const dateRange = flow.getByRole('radio', { name: /^Custom dates/ })
  await dateRange.focus()
  await page.keyboard.press('Space')
  await expect(dateRange).toBeChecked()
  await typeDate(page, 'From', LINK_FROM)
  await typeDate(page, 'To', LINK_TO)
  await expect(flow.getByText(`Syncing picks up from today. The days after ${formatDateLabel(LINK_TO)} stay as you entered them.`)).toBeVisible()

  const linked = page.waitForResponse((answer) => answer.url() === `${API_BASE_URL}/accounts/${accountId}/bank-link` && answer.request().method() === 'POST')
  await flow.getByRole('button', { name: 'Link and import' }).click()
  const link = await linked
  expect(link.status()).toBe(201)
  expect(link.request().postDataJSON()).toMatchObject({ start_date: LINK_FROM, end_date: LINK_TO })
  await expect(flow).toBeHidden()
  await startBankImport(request, user, accountId)

  // The range brings in its three days and nothing after To
  const linkedItems = await waitForReviewItems(request, user, accountId, (items) => items.length === 3)
  expect(describeItems(linkedItems)).toEqual([
    [EARLIEST.posted, EARLIEST.description],
    [DISMISSED.posted, DISMISSED.description],
    [LATEST.posted, LATEST.description],
  ])
  const dismissed = linkedItems.find((item) => item.bank.description === DISMISSED.description)!
  const dismissal = await request.post(`${API_BASE_URL}/bank-review/items/${dismissed.id}/dismiss`, { headers: asUser(user) })
  expect(dismissal.status()).toBe(204)
  await addBridgeTransactions(request, setup.scenarioId, setup.bankAccountId, [ADDED_LATER])

  // A later range from the Bank link section, once the link's own import has finished
  await expect.poll(async () => (await readRange(request, setup)).range_import, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBeNull()
  const section = await openBankLink(page, accountId, SYNCED_STATUS)
  const openImport = section.getByRole('button', { name: 'Import a date range' })
  await expect(openImport).not.toHaveAttribute('aria-disabled', 'true')
  await openImport.click()
  const rangeDialog = page.getByRole('dialog', { name: 'Import a date range' })
  await typeDate(page, 'From', LATER_FROM)
  await typeDate(page, 'To', LATER_TO)

  // The warning shows only once the option is ticked, here from the keyboard
  const restore = rangeDialog.getByRole('checkbox', { name: RESTORE_LABEL })
  const warning = rangeDialog.getByRole('status').filter({ hasText: RESTORE_WARNING })
  await expect(restore).not.toBeChecked()
  await expect(warning).toBeHidden()
  await restore.focus()
  await page.keyboard.press('Space')
  await expect(restore).toBeChecked()
  await expect(warning).toBeVisible()

  const imported = page.waitForResponse((answer) => answer.url().endsWith(`/accounts/${accountId}/bank-link/range-import`))
  await rangeDialog.getByRole('button', { name: 'Import', exact: true }).click()
  const answer = await imported
  expect(answer.status()).toBe(200)
  expect(answer.request().postDataJSON()).toEqual({ first_day: LATER_FROM, last_day: LATER_TO, restores_dismissed: true })
  await expect(rangeDialog).toBeHidden()

  // The dismissed item waits again beside the one the bank added, and nothing already waiting comes twice
  await waitForReviewItems(request, user, accountId, (items) => items.length === 4)
  await expect.poll(async () => (await readRange(request, setup)).range_import, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBeNull()
  expect(describeItems(await readReviewItems(request, user, accountId))).toEqual([
    [EARLIEST.posted, EARLIEST.description],
    [DISMISSED.posted, DISMISSED.description],
    [ADDED_LATER.posted, ADDED_LATER.description],
    [LATEST.posted, LATEST.description],
  ])
  expect((await readRange(request, setup)).range_outcome).toBeNull()
})
