import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, type SeededAccount, type TestUser } from '../support/api'
import { logInViaApi, openPage, waitForRequestsSoFar } from '../support/app'
import {
  addImportedItem,
  answerAsBankImported,
  answerLinksWith,
  answerReviewItems,
  BANK_SOURCE,
  changeBridgeTransaction,
  editTransaction,
  linkToEmptyBankAccount,
  pageOf,
  readReviewItems,
  readTransaction,
  reviewBlock,
  reviewItem,
  SEP_21,
  syncBankLinkNow,
  waitForReviewItems,
  type BankSource,
} from '../support/bankSync'
import { faintestText } from '../support/contrast'
import { expectTransactionRow, getAccountRow, MINUS } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the removal, failed decision and action alignment tests and the light
// theme's readable comparison test (these run at every size): the comparison fills a phone's screen and
// stacks its actions there, and a removal's rows each keep to one line even on a phone

// A correction or a removal opens from its row in the review block in a comparison with its ledger
// transaction. The comparison accepts or keeps the bank's change, or removes or keeps the transaction.
//
// A correction comes from the fake SimpleFIN Bridge: Everyday links to an empty bank account at
// Harbour Bank, the user adds the bank's Countdown spend to the ledger, the bank then changes its
// amount, and a sync brings that in for review, so every decision on it goes to the server and what it
// saved is read back. SimpleFIN never reports a removal, so a removal is answered in the server's
// place on a manual transaction read as imported, and so are its decisions, with canned answers. What
// removing or keeping does to the ledger is left to the backend tests

const COUNTDOWN = 'COUNTDOWN 123 AUCKLAND'

type Setup = { user: TestUser; everyday: SeededAccount; id: string }

// Signed up fresh for every test, keeping every account here
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/**
 * Signs up with Everyday, linked to Everyday Chequing at Harbour Bank. The user added its $42.10 spend at
 * Countdown three days ago to the ledger, changing the amount to `edited` minor units where
 * given. The bank then says $45.10, and a sync brings that in as a correction waiting for review.
 * Answers with the ledger transaction's id
 */
async function startWithCorrection(page: Page, request: APIRequestContext, edited?: number): Promise<Setup> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const { scenario, externalAccountId } = await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [{ id: 'TRN-COUNTDOWN', posted: daysFromTodayInTestTimezone(-3), amount: '-42.10', description: COUNTDOWN }],
  })
  const { id } = await addImportedItem(request, user, everyday.id, COUNTDOWN)
  if (edited !== undefined) await editTransaction(request, user, id, { amount: edited })
  await changeBridgeTransaction(request, scenario.id, externalAccountId, 'TRN-COUNTDOWN', { amount: '-45.10' })
  await syncBankLinkNow(request, user, everyday.id)
  await waitForReviewItems(request, user, everyday.id, (items) => items.some((item) => item.kind === 'correction'))
  await logInViaApi(page, user)
  return { user, everyday, id }
}

/**
 * Signs up with Everyday holding $100.00 and an $18.00 Uber trip on Sep 21, read as imported from
 * SimpleFIN with a removal of it waiting. Each decision on the removal is answered as the server answers
 * it, a removal with nothing and a keep with the transaction it kept, and the list is read as empty once
 * one has been sent. What a decision does to the ledger is the server's to decide and the backend
 * tests check it, so these answers are canned. Answers with the transaction's id and each decision sent
 */
async function startWithRemoval(page: Page, request: APIRequestContext): Promise<Setup & { decisions: string[] }> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  const id = await createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount: -1800, date: SEP_21 })
  const bank = { ...BANK_SOURCE.bank_values, date: SEP_21, amount: -1800, description: 'UBER TRIP' }
  const item = reviewItem('removal', 'removal', everyday.id, bank, { transaction_id: id, current: bank })
  const source: BankSource = { ...BANK_SOURCE, bank_values: bank, review_item_id: item.id }
  const kept = { ...await readTransaction(request, user, id), bank_source: { ...source, review_item_id: null } }
  const decisions: string[] = []

  // Only a linked account has bank items, so Everyday is linked
  await answerLinksWith(page, () => [everyday.id])
  await answerAsBankImported(page, { [id]: source })
  await answerReviewItems(page, () => decisions.length === 0 ? pageOf([item], { removal: 1 }) : pageOf([]))
  await page.route(`${API_BASE_URL}/bank-review/items/${item.id}/*`, (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1)!
    decisions.push(action)
    return action === 'remove-from-ledger' ? route.fulfill({ status: 204 }) : route.fulfill({ json: kept })
  })
  await logInViaApi(page, user)
  return { user, everyday, id, decisions }
}

/** Opens an item from its row in the review block, and answers with the comparison it opens */
async function openComparison(page: Page, description: string, title: string): Promise<Locator> {
  await reviewBlock(page).getByRole('button', { name: description }).click()
  const dialog = page.getByRole('dialog', { name: title })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Collects the reads of the transaction lists made from now on */
function watchLedgerReads(page: Page): string[] {
  const reads: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'GET' && request.url().startsWith(`${API_BASE_URL}/transactions?`)) reads.push(request.url())
  })
  return reads
}

function toast(page: Page, text: string): Locator {
  return page.getByRole('status').filter({ hasText: text })
}

/** How many lines a cell's text runs to */
function linesOf(cell: Locator): Promise<number> {
  return cell.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
  })
}

function needsReview(row: Locator): Locator {
  return row.getByRole('button', { name: 'Needs review. Show the waiting item' })
}

test("accepts a bank change over an amount the user edited, writing the bank's amount and clearing the marker", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday, id } = await startWithCorrection(page, request, -4000)
  await openPage(page, '/transactions')
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(needsReview(row)).toBeVisible()
  await expect(row.getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(1)

  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
  await dialog.getByRole('button', { name: 'Accept bank change' }).click()
  await expect(toast(page, 'Applied the bank change.')).toBeVisible()
  await expect(dialog).toBeHidden()

  // The ledger holds the bank's amount, no longer the user's own
  await expectTransactionRow(page, id, `${MINUS}$45.10`)
  await expect(needsReview(row)).toHaveCount(0)
  await expect(row.getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(0)
  await expect(reviewBlock(page)).toBeHidden()
  expect(await readTransaction(request, user, id)).toMatchObject({ amount: -4510, bank_source: { edited_fields: [] } })
  expect(await readReviewItems(request, user, everyday.id)).toEqual([])
})

test("keeps the current value, counting it as edited, clearing the marker and keeping the day's total without reading the ledger again", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday, id } = await startWithCorrection(page, request)
  await openPage(page, '/transactions')
  const row = page.getByTestId(`transaction-row-${id}`)
  const dayTotal = page.getByTestId('day-total')
  await expect(dayTotal).toHaveText(`${MINUS}$42.10`)

  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
  const ledgerReads = watchLedgerReads(page)
  await dialog.getByRole('button', { name: 'Keep current value' }).click()
  await expect(toast(page, 'Kept the current values.')).toBeVisible()
  await expect(dialog).toBeHidden()

  await expect(reviewBlock(page)).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$42.10`)
  await expect(needsReview(row)).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'From SimpleFIN, edited', exact: true })).toBeVisible()

  // The day's total still counts the row, though the server answers with a copy of the kept transaction
  // that leaves out the converted amounts the total sums
  await expect(dayTotal).toHaveText(`${MINUS}$42.10`)
  await waitForRequestsSoFar(page)
  expect(ledgerReads).toEqual([])
  expect(await readTransaction(request, user, id)).toMatchObject({ amount: -4210, bank_source: { edited_fields: ['amount'] } })
  expect(await readReviewItems(request, user, everyday.id)).toEqual([])
})

test('removes a transaction the bank no longer reports, reading the ledger again', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { decisions } = await startWithRemoval(page, request)
  await openPage(page, '/transactions')

  const dialog = await openComparison(page, 'UBER TRIP', 'Review bank removal')

  // On one line in each row, even on a phone
  const gone = dialog.getByRole('cell', { name: 'Gone from the bank' })
  await expect(gone).toHaveCount(3)
  for (const cell of await gone.all()) expect(await linesOf(cell)).toBe(1)

  const ledgerReads = watchLedgerReads(page)
  await dialog.getByRole('button', { name: 'Remove from ledger' }).click()
  await expect(toast(page, 'Removed the transaction from the ledger.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(decisions).toEqual(['remove-from-ledger'])
  await expect(reviewBlock(page)).toBeHidden()

  // The server removes the transaction, so the ledger is read again to show it gone, as keeping one
  // never reads it. The test can hear of the read after the block has gone, so it waits for it
  await expect.poll(() => ledgerReads).not.toEqual([])
})

test('keeps a transaction the bank no longer reports, clearing the marker without reading the ledger again', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { id, decisions } = await startWithRemoval(page, request)
  await openPage(page, '/transactions')
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(needsReview(row)).toBeVisible()

  const dialog = await openComparison(page, 'UBER TRIP', 'Review bank removal')
  const ledgerReads = watchLedgerReads(page)
  await dialog.getByRole('button', { name: 'Keep transaction' }).click()
  await expect(toast(page, 'Kept the transaction.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(decisions).toEqual(['keep-transaction'])

  await expect(reviewBlock(page)).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$18.00`)
  await expect(needsReview(row)).toHaveCount(0)
  await waitForRequestsSoFar(page)
  expect(ledgerReads).toEqual([])
})

test('says why a decision failed in the comparison, leaving the item waiting', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { id } = await startWithCorrection(page, request)

  // Decisions fail in ways the server can't be made to here: refused over a removal SimpleFIN never
  // reports, then with no answer at all
  let failure: 'refused' | 'no answer' = 'refused'
  await page.route((url) => url.href.startsWith(`${API_BASE_URL}/bank-review/items/`), (route) => failure === 'refused'
    ? route.fulfill({ status: 409, json: { detail: 'This transaction has a bank removal waiting. Please decide the removal first' } })
    : route.abort())
  await openPage(page, '/transactions')
  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')

  // A refusal says the server's reason
  await dialog.getByRole('button', { name: 'Accept bank change' }).click()
  const reason = dialog.getByRole('alert')
  await expect(reason).toHaveText('This transaction has a bank removal waiting. Please decide the removal first')
  await expect(reason).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Accept bank change' })).toBeEnabled()

  // A decision that gets no answer says to try again
  failure = 'no answer'
  await dialog.getByRole('button', { name: 'Keep current value' }).click()
  await expect(reason).toHaveText('Something went wrong. Please try again.')

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(1)
  await expect(needsReview(page.getByTestId(`transaction-row-${id}`))).toBeVisible()
})

test('goes on to the accounts once the account whose item was reviewed on its page is deleted', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday } = await startWithCorrection(page, request)
  await openPage(page, `/accounts/${everyday.id}`)
  const comparison = await openComparison(page, COUNTDOWN, 'Review bank change')
  await comparison.getByRole('button', { name: 'Close' }).click()
  await expect(comparison).toBeHidden()

  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const editor = page.getByRole('dialog')
  await editor.getByRole('button', { name: 'Delete account', exact: true }).click()
  await editor.getByRole('button', { name: 'Continue', exact: true }).click()
  const typedName = editor.getByRole('textbox', { name: 'Type "Everyday" to delete.' })
  await typedName.fill('Everyday')
  await typedName.press('Enter')

  await expect(page).toHaveURL(/\/accounts$/)
  await expect(page.getByRole('heading', { name: 'Accounts', level: 1 })).toBeVisible()
  await expect(getAccountRow(page, 'Everyday')).toHaveCount(0)
})

test('starts focus on keeping the current value when the comparison opens from the keyboard', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await startWithCorrection(page, request)
  await openPage(page, '/transactions')

  await reviewBlock(page).getByRole('button', { name: COUNTDOWN }).focus()
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Review bank change' })
  await expect(dialog.getByRole('button', { name: 'Keep current value' })).toBeFocused()
})

// The ledger-changing action starts where the title starts and the keeping one ends where the close
// button above it ends, at every width, as the other confirmations' do
test('lines the comparison actions up with its header', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  await startWithCorrection(page, request)
  await openPage(page, '/transactions')

  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
  // Measured together and polled, since the panel scales in as it opens and edges read mid-animation
  // drift apart by however far it has to go
  const readEdgeOffsets = async () => {
    const [title, close, keep, accept] = await Promise.all([
      dialog.getByRole('heading', { name: 'Review bank change', exact: true }).boundingBox(),
      dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox(),
      dialog.getByRole('button', { name: 'Keep current value', exact: true }).boundingBox(),
      dialog.getByRole('button', { name: 'Accept bank change', exact: true }).boundingBox(),
    ])
    return {
      left: Math.round(accept!.x - title!.x) || 0,
      right: Math.round(keep!.x + keep!.width - (close!.x + close!.width)) || 0,
    }
  }

  await expect.poll(readEdgeOffsets).toEqual({ left: 0, right: 0 })
})

test('gives each value column room for a bank description on one line at 1440 wide', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await startWithCorrection(page, request)
  await page.setViewportSize({ width: 1440, height: 900 })
  await openPage(page, '/transactions')

  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
  const values = dialog.getByTestId('comparison-description').getByRole('cell')
  await expect(values).toHaveText([COUNTDOWN, COUNTDOWN])
  for (const value of await values.all()) expect(await linesOf(value)).toBe(1)
})

for (const colorScheme of ['light', 'dark'] as const) {
  // Only the light run measures the comparison's width, so only it runs at every size
  test(`compares an edited correction readably in the ${colorScheme} theme${colorScheme === 'light' ? ', without scrolling sideways' : ''}`, colorScheme === 'light' ? AT_EVERY_SIZE_NEEDS_BANK_SYNC : NEEDS_BANK_SYNC, async ({ page, request }) => {
    await startWithCorrection(page, request, -4000)
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openPage(page, '/transactions')
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    // The layout is the same in either theme, so it is measured in the light one only
    const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
    if (colorScheme === 'light') expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true)
    const texts = [
      dialog.getByText('SimpleFIN sent new values for a transaction you already approved. Nothing changes unless you accept the new values.'),
      ...await dialog.getByRole('columnheader').all(),
      ...await dialog.getByRole('rowheader').all(),
      ...await dialog.getByRole('cell').all(),
    ]
    for (const text of texts) {
      expect((await faintestText(text)).contrast, `${await text.textContent()} in the ${colorScheme} theme`).toBeGreaterThanOrEqual(4.5)
    }
  })
}
