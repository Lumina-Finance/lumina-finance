import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  countLedgerTransactions,
  createAccount,
  createTransaction,
  daysFromTodayInTestTimezone,
  formatDateLabel,
  signUpUser,
  type TestUser,
} from '../support/api'
import { fact, logInViaApi } from '../support/app'
import { faintestText } from '../support/contrast'
import {
  addBridgeTransactions,
  changeBridgeBalances,
  errorToast,
  linkToSampleBankAccount,
  openBankLink,
  openBankLinkHoldingRead,
  syncBankLinkNow,
  waitForReviewItems,
  WORKER_RESULT_TIMEOUT_MS,
} from '../support/bankSync'
import { MINUS, readBoxes } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the button's layout test and the light theme's readable offer test,
// which run at every size: the button takes a row of its own under the amount on a phone, and the
// offer may not scroll sideways at any width

// The balance match a linked account offers whenever its ledger and the bank's balance differ, at the
// foot of the Bank link section's balance panel, run by the worker against the fake SimpleFIN Bridge.
// Everyday holds 1,000.00 from yesterday, and SimpleFIN's balance is 1,250.00, so the link imports
// from today, nothing comes in to review, and 250.00 is offered, dated yesterday. The offer's words,
// its sign and the cache writes behind a recording are covered by unit tests, and the amount it leaves
// out for each kind of item waiting for review by the server's tests, so the browser checks only that
// an item left out keeps the amount and asks for a review first
const SAMPLE_CHEQUING = 'Everyday Chequing'
const SYNCED_STATUS = /Synced (just now|\d+ minutes? ago)\./
const NOTHING_TO_MATCH = 'There is no difference to match'

// The width from which the amount and the button share a row
const OFFER_ROW_MIN_WIDTH = 640

type Setup = { user: TestUser; accountId: string; adjustmentDate: string; scenarioId: string; bankAccountId: string }

/** The offer's parts in the account's edit modal */
type Offer = { dialog: Locator; sentence: Locator; amount: Locator; record: Locator }

/** Signs up with Everyday holding 1,000.00 from yesterday, linked to the sample chequing account reading 1,250.00 */
async function linkWithGap(request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const adjustmentDate = daysFromTodayInTestTimezone(-1)
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 100000, date: adjustmentDate })
  const { scenario, connection } = await linkToSampleBankAccount(request, user, {
    accountId: account.id,
    bankAccountName: SAMPLE_CHEQUING,
    balances: { balance: '1250.00' },
  })
  const bankAccountId = connection.accounts.find((bankAccount) => bankAccount.name === SAMPLE_CHEQUING)!.external_id
  return { user, accountId: account.id, adjustmentDate, scenarioId: scenario.id, bankAccountId }
}

/** Links Everyday with its gap, logs in and opens the offer */
async function openOffer(page: Page, request: APIRequestContext): Promise<{ setup: Setup; offer: Offer }> {
  const setup = await linkWithGap(request)
  await logInViaApi(page, setup.user)
  const dialog = await openBankLink(page, setup.accountId, SYNCED_STATUS)
  const offer = {
    dialog,
    sentence: offerText(dialog, setup.adjustmentDate),
    amount: fact(dialog, /^Adjustment/),
    record: dialog.getByRole('button', { name: 'Record adjustment' }),
  }
  await expect(offer.sentence).toBeVisible({ timeout: WORKER_RESULT_TIMEOUT_MS })
  return { setup, offer }
}

/** The offer's sentence, naming the day before the import start as the app writes a day with its year */
function offerText(dialog: Locator, adjustmentDate: string): Locator {
  return dialog.getByText(`Adds a balance adjustment on ${formatDateLabel(adjustmentDate)}.`)
}

/** The bodies of the recordings the page sends */
function watchRecordings(page: Page): string[] {
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.url().endsWith('/bank-link/balance-match')) sent.push(request.postData() ?? '')
  })
  return sent
}

/** Records the match from another window, the way a second tab would */
async function recordElsewhere(request: APIRequestContext, { user, accountId }: Setup, amount: number): Promise<number> {
  const response = await request.post(`${API_BASE_URL}/accounts/${accountId}/bank-link/balance-match`, {
    headers: asUser(user),
    data: { offered_amount: amount },
  })
  return response.status()
}

/** The account's ledger transactions as stored, as their dates and amounts, smallest amount first, and their notes */
async function readLedger(request: APIRequestContext, { user, accountId }: Setup): Promise<{ rows: [string, number][]; notes: (string | null)[] }> {
  const response = await request.get(`${API_BASE_URL}/transactions?account_id=${accountId}`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  const stored = ((await response.json()) as { dt: string; amount: number; notes: string | null }[]).sort((a, b) => a.amount - b.amount)
  return { rows: stored.map(({ dt, amount }) => [dt, amount]), notes: stored.map(({ notes }) => notes) }
}

// A request held or refused here can still be on its way to the page when a test ends, and would
// otherwise surface as an error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test("offers to match SimpleFIN's balance under the balances, showing the offered amount with no field to change it, with the status still synced", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { offer } = await openOffer(page, request)

  await expect(fact(offer.dialog, 'Status')).toHaveText(/^Synced/)
  await expect(offer.dialog.getByText("Match SimpleFIN's balance", { exact: true })).toBeVisible()
  await expect(fact(offer.dialog, /^Difference/)).toHaveText(`${MINUS}$250.00`)
  await expect(offer.amount).toHaveText('+$250.00')
  await expect(offer.dialog.getByRole('textbox', { name: /adjustment/i })).toHaveCount(0)

  // How the figure is worked out opens as the keyboard reaches its icon, as it does on hover
  const how = offer.dialog.getByRole('button', { name: 'How the adjustment is worked out' })
  await how.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(how).toBeFocused()
  const hint = offer.dialog.locator('.app-tooltip-panel').filter({ hasText: "SimpleFIN's balance minus your ledger's" })
  await expect(hint.locator('..')).toHaveCSS('opacity', '1')
  await how.blur()
  await expect(hint.locator('..')).toHaveCSS('opacity', '0')
  await expect(offer.dialog.getByRole('button', { name: 'Skip', exact: true })).toHaveCount(0)
  const [caption, sentence] = await readBoxes(page, [offer.dialog.getByText(/^As of /), offer.sentence])
  expect(sentence.y).toBeGreaterThan(caption.y + caption.height)
})

test('keeps the offer when a sync brings an item to review, leaving the item out and asking for it to be reviewed first',NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { setup, offer } = await openOffer(page, request)
  await expect(offer.amount).toHaveText('+$250.00')

  // SimpleFIN's balance takes in a 4.50 coffee from today. That coffee waits for review
  await addBridgeTransactions(request, setup.scenarioId, setup.bankAccountId, [
    { posted: daysFromTodayInTestTimezone(0), amount: '-4.50', description: 'HARBOUR COFFEE' },
  ])
  await changeBridgeBalances(request, setup.scenarioId, setup.bankAccountId, { balance: '1245.50' })
  await syncBankLinkNow(request, setup.user, setup.accountId)
  await waitForReviewItems(request, setup.user, setup.accountId, (items) => items.some((item) => item.bank.description === 'HARBOUR COFFEE'))

  await page.reload()
  const dialog = await openBankLink(page, setup.accountId, SYNCED_STATUS)
  await expect(fact(dialog, /^Difference/)).toHaveText(`${MINUS}$245.50`)
  await expect(fact(dialog, /^Adjustment/)).toHaveText('+$250.00')
  await expect(dialog.getByText('Review the waiting items first if you entered any by hand.')).toBeVisible()
})

test('shows Record adjustment whole, beside the amount from the width it fits there and on a row of its own on a phone', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { offer } = await openOffer(page, request)

  // The amount's row, its label and figure, against the button
  const [field, recordBox] = await readBoxes(page, [offer.amount.locator('..'), offer.record])

  // The label sits in a box of its own inside the button, which clips it rather than the button
  const clipped = await offer.record.evaluate((button) =>
    [button, ...button.querySelectorAll('*')]
      .filter((part) => part.clientWidth > 0 && part.scrollWidth > part.clientWidth)
      .map((part) => part.outerHTML.slice(0, 80)),
  )
  expect(clipped).toEqual([])
  if (page.viewportSize()!.width >= OFFER_ROW_MIN_WIDTH) {
    expect(Math.abs((recordBox.y + recordBox.height) - (field.y + field.height))).toBeLessThan(0.5)
    expect(recordBox.x).toBeGreaterThan(field.x + field.width)
  } else {
    expect(recordBox.y).toBeGreaterThan(field.y + field.height)
    expect(Math.abs(recordBox.width - field.width)).toBeLessThan(0.5)
  }
})

test('records the offered amount and closes the modal, leaving nothing to match', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const recordings = watchRecordings(page)
  const { setup, offer } = await openOffer(page, request)

  await offer.record.click()
  await expect(offer.dialog).toBeHidden()
  expect(recordings).toEqual(['{"offered_amount":25000}'])
  const ledger = await readLedger(request, setup)
  expect(ledger.rows).toEqual([[setup.adjustmentDate, 25000], [setup.adjustmentDate, 100000]])
  expect(ledger.notes[0]).toBe("Matched to SimpleFIN's balance")

  // Opened again, the balances match and nothing is offered
  const again = await openBankLink(page, setup.accountId, SYNCED_STATUS)
  await expect(fact(again, 'Ledger')).toHaveText('$1,250.00')
  await expect(fact(again, /^Difference/)).toHaveText('None')
  await expect(again.getByRole('button', { name: 'Record adjustment' })).toHaveCount(0)
})

test('offers the match again once a new gap opens after an earlier one was recorded', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { setup, offer } = await openOffer(page, request)
  await offer.record.click()
  await expect(offer.sentence).toBeHidden()

  // SimpleFIN's balance rises by 20.00 with nothing new to review
  await changeBridgeBalances(request, setup.scenarioId, setup.bankAccountId, { balance: '1270.00' })
  await syncBankLinkNow(request, setup.user, setup.accountId)

  await page.reload()
  const again = await openBankLink(page, setup.accountId, SYNCED_STATUS)
  await expect(fact(again, /^Difference/)).toHaveText(`${MINUS}$20.00`, { timeout: WORKER_RESULT_TIMEOUT_MS })
  await expect(fact(again, /^Adjustment/)).toHaveText('+$20.00')
})

test('keeps the offer when a recording never reaches the server, saying something went wrong', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { setup, offer } = await openOffer(page, request)
  await page.route(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/balance-match`, (route) => route.abort('failed'), { times: 1 })

  await offer.record.click()

  await expect(errorToast(page, 'Oops, something went wrong. Please try again.')).toBeVisible()
  await expect(offer.sentence).toBeVisible()
  expect(await countLedgerTransactions(request, setup.user)).toBe(1)
})

test('folds the offer away when a recording finds it recorded in another window, saying why', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { setup, offer } = await openOffer(page, request)
  let recordedElsewhere = 0
  await page.route(`${API_BASE_URL}/accounts/${setup.accountId}/bank-link/balance-match`, async (route) => {
    recordedElsewhere = await recordElsewhere(request, setup, 25000)
    await route.continue()
  }, { times: 1 })

  await offer.record.click()

  await expect(errorToast(page, NOTHING_TO_MATCH)).toBeVisible()
  await expect(offer.sentence).toBeHidden()
  expect(recordedElsewhere).toBe(200)
  expect(await countLedgerTransactions(request, setup.user)).toBe(2)
})

// A read of the link can come back without the offer before a recording does, as one the server
// answered once the gap was recorded in another window does. The modal reads the link again as it
// opens, and that read is held until the gap has been recorded, while the recording's refusal is held
// until the offer has gone
test('says why the server refused a recording whose offer a read of the link had already folded away', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkWithGap(request)
  const matchUrl = `${API_BASE_URL}/accounts/${setup.accountId}/bank-link/balance-match`
  let recorded = () => {}
  const recordedElsewhere = new Promise<void>((resolve) => { recorded = resolve })
  let releaseRefusal = () => {}
  const refusalReleased = new Promise<void>((resolve) => { releaseRefusal = resolve })
  let elsewhereStatus = 0
  await page.route(matchUrl, async (route) => {
    elsewhereStatus = await recordElsewhere(request, setup, 25000)
    recorded()
    const response = await route.fetch()
    await refusalReleased
    await route.fulfill({ response })
  })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, SYNCED_STATUS, recordedElsewhere, WORKER_RESULT_TIMEOUT_MS)

  await dialog.getByRole('button', { name: 'Record adjustment' }).click()
  await expect(offerText(dialog, setup.adjustmentDate)).toHaveCount(0)

  const refused = page.waitForResponse(matchUrl)
  releaseRefusal()
  expect((await refused).status()).toBe(409)
  await expect(errorToast(page, NOTHING_TO_MATCH)).toBeVisible()
  expect(elsewhereStatus).toBe(200)
  expect(await countLedgerTransactions(request, setup.user)).toBe(2)
})

// The offer can fold away with Record adjustment holding focus before the recording answers, as a read
// of the link the server answered once the recording had reached it leaves the offer out. The modal
// reads the link again as it opens, and that read is held until the recording has reached the server,
// while the recording's own answer is held until the offer has gone
test('moves focus on from a recording whose offer folds away before it answers', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkWithGap(request)
  const matchUrl = `${API_BASE_URL}/accounts/${setup.accountId}/bank-link/balance-match`
  let recordingReached = () => {}
  const reached = new Promise<void>((resolve) => { recordingReached = resolve })
  let releaseAnswer = () => {}
  const answerReleased = new Promise<void>((resolve) => { releaseAnswer = resolve })
  await page.route(matchUrl, async (route) => {
    const response = await route.fetch()
    recordingReached()
    await answerReleased
    await route.fulfill({ response })
  })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, SYNCED_STATUS, reached, WORKER_RESULT_TIMEOUT_MS)

  // The modal opens with Sync now focused, after Record adjustment
  const syncNow = dialog.getByRole('button', { name: 'Sync now' })
  await expect(syncNow).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(dialog.getByRole('button', { name: 'Record adjustment' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(offerText(dialog, setup.adjustmentDate)).toHaveCount(0)
  await expect(syncNow).toBeFocused()

  // The modal closes once the recording answers
  const answered = page.waitForResponse(matchUrl)
  releaseAnswer()
  expect((await answered).status()).toBe(200)
  await expect(dialog).toBeHidden()
})

// A read of the link can fold the offer away while focus is elsewhere in the modal, as one the server
// answered once the gap was recorded in another window does. The modal reads the link again as it
// opens, and that read is held until the gap has been recorded
test('leaves focus where the person put it when a read of the link folds the offer away', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const setup = await linkWithGap(request)
  let recorded = () => {}
  const recordedElsewhere = new Promise<void>((resolve) => { recorded = resolve })
  await logInViaApi(page, setup.user)
  const dialog = await openBankLinkHoldingRead(page, setup.accountId, SYNCED_STATUS, recordedElsewhere, WORKER_RESULT_TIMEOUT_MS)
  await expect(dialog.getByRole('button', { name: 'Sync now' })).toBeFocused()
  const name = dialog.getByLabel('Account name')
  await name.click()

  expect(await recordElsewhere(request, setup, 25000)).toBe(200)
  recorded()
  await expect(offerText(dialog, setup.adjustmentDate)).toHaveCount(0)
  await expect(name).toBeFocused()
})

for (const colorScheme of ['light', 'dark'] as const) {
  // Only the light run measures the offer's width, so only it runs at every size
  test(`keeps the offer readable in the ${colorScheme} theme${colorScheme === 'light' ? ', with no sideways scroll' : ''}`, colorScheme === 'light' ? AT_EVERY_SIZE_NEEDS_BANK_SYNC : NEEDS_BANK_SYNC, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const { setup, offer } = await openOffer(page, request)
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    for (const text of [
      offer.dialog.getByText("Match SimpleFIN's balance", { exact: true }),
      offerText(offer.dialog, setup.adjustmentDate),
      offer.dialog.getByRole('term').filter({ hasText: /^Adjustment/ }),
      offer.amount,
    ]) {
      await expect(text).toBeVisible()
      expect((await faintestText(text)).contrast).toBeGreaterThanOrEqual(4.5)
    }

    // The layout is the same in either theme, so it is measured in the light one only
    if (colorScheme === 'light') {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
  })
}
