import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, formatDateLabel, signUpUser, type TestUser } from '../support/api'
import { logInViaApi } from '../support/app'
import {
  errorToast,
  linkToEmptyBankAccount,
  linkToSampleBankAccount,
  openBankLink,
  openBankLinkHoldingRead,
  READ_LINK_STATUS,
  WORKER_RESULT_TIMEOUT_MS,
  type ReviewPage,
} from '../support/bankSync'
import { faintestText } from '../support/contrast'
import { readBoxes } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the test of an import that got nothing (run on the phone):
// the reminder and the offer below it each have to show whole at a phone's width

// The reminder a linked account's Bank link section shows once its import returned less history than
// it asked for, or none, run by the worker against the fake SimpleFIN Bridge. Everyday imports the
// sample chequing account from 45 days ago, with its earliest transaction 33 days old, or an empty
// bank account from 30 days ago, leaving a difference to match too. Which imports and
// catch-ups fall short, the reminder's words for each and the cache writes behind a dismissal are
// covered by backend and unit tests
const SAMPLE_CHEQUING = 'Everyday Chequing'
const SYNCED_STATUS = /Synced (just now|\d+ minutes? ago)\./
const LESS_HISTORY = 'Less history than your chosen start'
const NO_HISTORY = 'No history returned yet'
const LIMIT_NOTE = 'The bank probably keeps no more history.'
const DISMISS_FAILED_MESSAGE = 'The reminder could not be dismissed. Please try again.'

// Whatever the status reads once the import has ended
const ANY_STATUS = /.+\./

type HistoryReminder = { requested_start: string; earliest_returned: string | null }

type Setup = { user: TestUser; accountId: string; reminder: HistoryReminder }

/** Reads the account's history reminder as the server shows it */
async function readReminder(request: APIRequestContext, user: TestUser, accountId: string): Promise<HistoryReminder | null> {
  const response = await request.get(`${API_BASE_URL}/accounts/${accountId}/bank-link`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as { link: { history_reminder: HistoryReminder | null } | null }).link?.history_reminder ?? null
}

/** Signs up with Everyday, links it as given and waits for the worker to end its import and raise the reminder */
async function linkFallingShort(request: APIRequestContext, link: (user: TestUser, accountId: string) => Promise<unknown>): Promise<Setup> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await link(user, account.id)
  let reminder: HistoryReminder | null = null
  await expect.poll(async () => {
    reminder = await readReminder(request, user, account.id)
    return reminder !== null
  }, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(true)
  return { user, accountId: account.id, reminder: reminder! }
}

/** Links Everyday to the sample chequing account from 45 days ago. It returns history from 33 days ago */
async function linkGettingLess(request: APIRequestContext): Promise<Setup> {
  return linkFallingShort(request, (user, accountId) =>
    linkToSampleBankAccount(request, user, { accountId, bankAccountName: SAMPLE_CHEQUING, startDate: daysFromTodayInTestTimezone(-45) }))
}

/** Links Everyday to an empty bank account from 30 days ago. It returns nothing */
async function linkGettingNothing(request: APIRequestContext): Promise<Setup> {
  return linkFallingShort(request, (user, accountId) => linkToEmptyBankAccount(request, user, { accountId, startDate: daysFromTodayInTestTimezone(-30) }))
}

/** The earliest day of the bank items the account's import brought in for review */
async function readEarliestItem(request: APIRequestContext, { user, accountId }: Setup): Promise<string> {
  const response = await request.get(`${API_BASE_URL}/bank-review/items?account_id=${accountId}`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return ((await response.json()) as ReviewPage).items.map(({ bank }) => bank.date).sort()[0]
}

/** The reminder in the Bank link section, named by its title */
function reminderNote(dialog: Locator, title: string): Locator {
  return dialog.getByRole('note', { name: title })
}

/** The bodies of the dismissals the page sends */
function watchDismissals(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/bank-link/history-reminder/dismiss')) sent.push(request.postData() ?? '')
  })
  return sent
}

// A request held or refused here can still be on its way to the page when a test ends. That would
// otherwise surface as an error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('reminds that the import returned less history than it asked for, naming the day its history starts', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkGettingLess(request)
  const earliest = await readEarliestItem(request, setup)
  await logInViaApi(page, setup.user)

  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)

  const note = reminderNote(dialog, LESS_HISTORY)
  await expect(note).toContainText(
    `SimpleFIN returned transactions from ${formatDateLabel(earliest)}, not ${formatDateLabel(daysFromTodayInTestTimezone(-45))}. ${LIMIT_NOTE}`,
  )
  await expect(note.getByRole('button', { name: 'Dismiss' })).toBeVisible()
})

test('opens the bank link on Sync now rather than on the reminder\'s ✕ above it', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkGettingLess(request)
  await logInViaApi(page, setup.user)

  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)

  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
})

test('dismisses the reminder it showed for good, moving focus on to Sync now', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkGettingLess(request)
  const sent = watchDismissals(page)
  await logInViaApi(page, setup.user)
  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)
  const note = reminderNote(dialog, LESS_HISTORY)

  await note.getByRole('button', { name: 'Dismiss' }).click()

  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  await expect(note).toBeHidden()
  expect(sent).toEqual([JSON.stringify(setup.reminder)])
  expect(await readReminder(request, setup.user, setup.accountId)).toBeNull()

  // Neither the edit modal opened again nor the page loaded again shows it
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: /^Bank sync: .+ Open bank link$/ }).click()
  await expect(dialog.getByRole('button', { name: 'Unlink' })).toBeVisible()
  await expect(dialog.getByText(LESS_HISTORY)).toHaveCount(0)
  const again = await openBankLink(page, setup.accountId, ANY_STATUS)
  await expect(again.getByRole('button', { name: 'Unlink' })).toBeVisible()
  await expect(again.getByText(LESS_HISTORY)).toHaveCount(0)
})

test('keeps the reminder when a dismissal never reaches the server, saying something went wrong', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkGettingLess(request)
  await logInViaApi(page, setup.user)
  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)
  await page.route(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/history-reminder/dismiss`, (route) => route.abort('failed'), { times: 1 })
  const note = reminderNote(dialog, LESS_HISTORY)

  await note.getByRole('button', { name: 'Dismiss' }).click()

  await expect(errorToast(page, DISMISS_FAILED_MESSAGE)).toBeVisible()
  await expect(note).toBeVisible()
  expect(await readReminder(request, setup.user, setup.accountId)).toEqual(setup.reminder)
})

test('says why the server refuses a dismissal once the account was unlinked in another window, showing it unlinked', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkGettingLess(request)
  await logInViaApi(page, setup.user)
  const dialog = await openBankLink(page, setup.accountId, ANY_STATUS)
  let unlinkedElsewhere = 0
  await page.route(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/history-reminder/dismiss`, async (route) => {
    unlinkedElsewhere = (await request.delete(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link`, { headers: asUser(setup.user) })).status()
    await route.continue()
  }, { times: 1 })

  await reminderNote(dialog, LESS_HISTORY).getByRole('button', { name: 'Dismiss' }).click()

  await expect(errorToast(page, 'This account is not linked to a bank')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Reconnect bank account' })).toBeVisible()
  await expect(dialog.getByText(LESS_HISTORY)).toHaveCount(0)
  expect(unlinkedElsewhere).toBe(200)
})

// A read of the link can come back without the reminder before its dismissal answers, as one the server
// answered once the account was unlinked in another window does. The modal reads the link again as it
// opens, and that read is held until the account has been unlinked, while the dismissal's refusal is
// held until the reminder has gone
test('says why the server refused a dismissal whose reminder a read of the link had already folded away', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkGettingLess(request)
  const linkUrl = `${API_BASE_URL}/accounts/${setup.accountId}/bank-link`
  const dismissUrl = `${linkUrl}/history-reminder/dismiss`
  let unlinked = () => {}
  const unlinkedElsewhere = new Promise<void>((resolve) => { unlinked = resolve })
  let answerRefusal = () => {}
  const refusalReleased = new Promise<void>((resolve) => { answerRefusal = resolve })
  let unlinkStatus = 0
  await page.route(dismissUrl, async (route) => {
    unlinkStatus = (await request.delete(linkUrl, { headers: asUser(setup.user) })).status()
    unlinked()
    const response = await route.fetch()
    await refusalReleased
    await route.fulfill({ response })
  })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, READ_LINK_STATUS, unlinkedElsewhere)

  await reminderNote(dialog, LESS_HISTORY).getByRole('button', { name: 'Dismiss' }).click()
  await expect(dialog.getByRole('button', { name: 'Reconnect bank account' })).toBeVisible()
  await expect(dialog.getByText(LESS_HISTORY)).toHaveCount(0)

  const refused = page.waitForResponse(dismissUrl)
  answerRefusal()
  expect((await refused).status()).toBe(404)
  await expect(errorToast(page, 'This account is not linked to a bank')).toBeVisible()
  expect(unlinkStatus).toBe(200)
})

test('shows the reminder of an import that got nothing above the balance match offer, each whole on a phone', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  test.skip(test.info().project.name !== 'phone', 'It checks the layout a phone gets')
  await page.setViewportSize({ width: 390, height: 844 })
  const setup = await linkGettingNothing(request)
  await logInViaApi(page, setup.user)

  const dialog = await openBankLink(page, setup.accountId, SYNCED_STATUS)

  const note = reminderNote(dialog, NO_HISTORY)
  await expect(note).toContainText(formatDateLabel(daysFromTodayInTestTimezone(-30)))
  const record = dialog.getByRole('button', { name: 'Record adjustment' })
  await expect(record).toBeVisible()

  // The ✕ sits in the reminder's corner beside the title, and the offer follows below the reminder
  const [box, title, dismiss, recordBox] = await readBoxes(page, [note, note.getByText(NO_HISTORY), note.getByRole('button', { name: 'Dismiss' }), record])
  expect(dismiss.x).toBeGreaterThanOrEqual(title.x + title.width)
  expect(dismiss.x + dismiss.width).toBeLessThanOrEqual(box.x + box.width)
  expect(dismiss.y).toBeGreaterThanOrEqual(box.y)
  expect(recordBox.y).toBeGreaterThan(box.y + box.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps the reminder readable in the ${colorScheme} theme`, NEEDS_BANK_SYNC, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const setup = await linkGettingNothing(request)
    await logInViaApi(page, setup.user)
    const dialog = await openBankLink(page, setup.accountId, SYNCED_STATUS)
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    const note = reminderNote(dialog, NO_HISTORY)
    for (const text of [note.getByText(NO_HISTORY, { exact: true }), note.getByText(/hasn't returned any posted transactions from/)]) {
      await expect(text).toBeVisible()
      expect((await faintestText(text)).contrast).toBeGreaterThanOrEqual(4.5)
    }
  })
}
