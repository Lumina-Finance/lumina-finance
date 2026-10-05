import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser, type SeededAccount, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import {
  answerAsBankImported,
  answerReviewItems,
  BANK_SOURCE,
  pageOf,
  reviewBlock,
  reviewItem,
  SEP_21,
  type BankSource,
  type ReviewItem,
} from '../support/bankSync'
import { contrastOf, expectTransactionRow, getAccountRow, MIN_TEXT_CONTRAST, MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// A correction or a removal opens from its row in the review block in a comparison with its ledger
// transaction, which accepts or keeps the bank's change, or removes or keeps the transaction.
//
// Nothing links an account on the server for a sync to bring in a correction, and no provider reports
// removals, so each test records a manual transaction, answers the app's reads of it as imported with
// the item waiting on it, and answers each decision as the server would: accepting writes the bank's
// amount and removing deletes the transaction, both through the real server. That stand-in tests the
// screen alone: the real decision routes, their refusals and their locking are left to the backend
// route tests

const COUNTDOWN = 'COUNTDOWN 123 AUCKLAND'
const EDITED_NOTE = 'You edited this. Accepting replaces your value with the bank\'s.'

type Setup = { user: TestUser; everyday: SeededAccount }

/** How the next decision fails: a status the server answers with, or no answer at all */
type Refusal = { status: number; detail: string } | 'network' | null

/** The items still waiting, the transaction's source as the app reads it, and each decision sent */
type Review = { waiting: ReviewItem[]; sources: Record<string, BankSource>; decisions: string[]; refusal: Refusal }

// Signed up fresh for every test, which keeps every account here
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/** Signs up with Everyday holding $100.00 */
async function start(page: Page, request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  return { user, everyday }
}

/**
 * Records a spend of `ledger` minor units on Sep 21 in Everyday, read as imported from SimpleFIN with
 * a correction or a removal of it waiting, the bank now sending `bank`, and the ledger's amount
 * counted as the user's edit when `edited` says so. Returns the transaction's id and its review
 */
async function addWaiting(
  page: Page,
  request: APIRequestContext,
  { user, everyday }: Setup,
  kind: 'correction' | 'removal',
  description: string,
  amounts: { ledger: number; bank: number; edited?: boolean },
): Promise<{ id: string; review: Review }> {
  const id = await createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount: amounts.ledger, date: SEP_21 })
  const bank = { ...BANK_SOURCE.bank_values, date: SEP_21, amount: amounts.bank, description }
  const edited: BankSource['edited_fields'] = amounts.edited ? ['amount'] : []
  const item = reviewItem(kind, kind, everyday.id, bank, {
    transaction_id: id,
    current: { ...bank, amount: amounts.ledger },
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: edited,
  })
  const review: Review = {
    waiting: [item],
    sources: { [id]: { ...BANK_SOURCE, bank_values: bank, edited_fields: edited, review_item_id: item.id } },
    decisions: [],
    refusal: null,
  }
  await answerAsBankImported(page, review.sources)
  await answerReviewItems(page, () => pageOf(review.waiting))
  await page.route((url) => url.href.startsWith(`${API_BASE_URL}/bank-review/items/`), (route) => answerDecision(route, request, user, review, id))
  return { id, review }
}

/**
 * Settles a decision on the waiting item the way the server would, or refuses it while `refusal`
 * says how. Each decision closes the item. Accepting writes the bank's amount, after which nothing
 * counts as edited, and keeping the current value counts the ledger's own as edited
 */
async function answerDecision(route: Route, request: APIRequestContext, user: TestUser, review: Review, id: string): Promise<void> {
  const [, itemId, action] = /\/bank-review\/items\/([^/]+)\/([a-z-]+)$/.exec(new URL(route.request().url()).pathname) ?? []
  if (route.request().method() !== 'POST' || !review.waiting.some((item) => item.id === itemId)) {
    return route.fulfill({ status: 404, json: { detail: 'Review item not found' } })
  }
  review.decisions.push(action)
  if (review.refusal === 'network') return route.abort()
  if (review.refusal) return route.fulfill({ status: review.refusal.status, json: { detail: review.refusal.detail } })

  review.waiting = []
  const headers = asUser(user)
  if (action === 'remove-from-ledger') {
    const response = await request.delete(`${API_BASE_URL}/transactions/${id}`, { headers })
    expect(response.ok(), `deleting the transaction answered ${response.status()}`).toBe(true)
    return route.fulfill({ status: 204 })
  }

  const source = review.sources[id]
  if (action === 'accept-change') {
    const response = await request.patch(`${API_BASE_URL}/transactions/${id}`, { headers, data: { amount: source.bank_values.amount } })
    expect(response.ok(), `writing the bank's amount answered ${response.status()}`).toBe(true)
  }
  const edited: BankSource['edited_fields'] = action === 'accept-change' ? [] : action === 'keep-current' ? ['amount'] : source.edited_fields
  review.sources[id] = { ...source, edited_fields: edited, review_item_id: null }
  const transaction = await request.get(`${API_BASE_URL}/transactions/${id}`, { headers })
  return route.fulfill({ json: { ...await transaction.json(), bank_source: review.sources[id] } })
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

function needsReview(row: Locator): Locator {
  return row.getByRole('button', { name: 'Needs review. Show the waiting item' })
}

test("accepts a bank change over an amount the user edited, writing the bank's amount and clearing the marker", async ({ page, request }) => {
  const setup = await start(page, request)
  const { id, review } = await addWaiting(page, request, setup, 'correction', COUNTDOWN, { ledger: -4000, bank: -4510, edited: true })
  await openPage(page, '/transactions')
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(needsReview(row)).toBeVisible()

  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
  await expect(dialog.getByText('Correction from SimpleFIN', { exact: true })).toBeVisible()
  await expect(dialog).toContainText('SimpleFIN sent new values for a transaction you already approved. Nothing changes unless you accept.')
  await expect(dialog.getByRole('columnheader')).toHaveText(['Field', 'In your ledger', 'From bank'])
  await expect(dialog.getByRole('rowheader')).toHaveText(['Date', 'Amount', 'Bank description'])
  await expect(dialog.getByTestId('comparison-amount').getByRole('cell')).toHaveText([`${MINUS}$40.00`, `${MINUS}$45.10`, EDITED_NOTE])

  await dialog.getByRole('button', { name: 'Accept bank change' }).click()
  await expect(toast(page, 'Bank change applied.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(review.decisions).toEqual(['accept-change'])

  // The ledger holds the bank's amount, which is no longer the user's own
  await expectTransactionRow(page, id, `${MINUS}$45.10`)
  await expect(needsReview(row)).toHaveCount(0)
  await expect(row.getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(0)
  await expect(reviewBlock(page)).toBeHidden()
})

test('keeps the current value, which then counts as edited, clearing the marker without reading the ledger again', async ({ page, request }) => {
  const setup = await start(page, request)
  const { id, review } = await addWaiting(page, request, setup, 'correction', COUNTDOWN, { ledger: -4210, bank: -4510 })
  await openPage(page, '/transactions')
  const row = page.getByTestId(`transaction-row-${id}`)

  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
  await expect(dialog.getByTestId('comparison-amount').getByRole('cell')).toHaveText([`${MINUS}$42.10`, `${MINUS}$45.10`])

  const ledgerReads = watchLedgerReads(page)
  await dialog.getByRole('button', { name: 'Keep current value' }).click()
  await expect(toast(page, 'Current values kept.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(review.decisions).toEqual(['keep-current'])

  await expect(reviewBlock(page)).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$42.10`)
  await expect(needsReview(row)).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'From SimpleFIN, edited', exact: true })).toBeVisible()
  expect(ledgerReads).toEqual([])

  // The transaction's own modal offers the bank's amount the user kept out
  await row.click()
  const edit = page.getByRole('dialog', { name: 'Edit Transaction', exact: true })
  await expect(edit.locator('#txn-amount-bank-value')).toHaveText(`Bank: ${MINUS}$45.10`)
  await expect(edit.getByRole('button', { name: 'Restore bank value' })).toBeVisible()
})

test("removes a transaction the bank no longer reports, raising the account's balance", async ({ page, request }) => {
  const setup = await start(page, request)
  const { id, review } = await addWaiting(page, request, setup, 'removal', 'UBER TRIP', { ledger: -1800, bank: -1800 })
  await openPage(page, '/accounts')
  await expect(getAccountRow(page, 'Everyday')).toContainText('$82.00')
  await openPage(page, '/transactions')

  const dialog = await openComparison(page, 'UBER TRIP', 'Review bank removal')
  await expect(dialog.getByText('Removal from SimpleFIN', { exact: true })).toBeVisible()
  await expect(dialog).toContainText('SimpleFIN no longer reports this transaction. It stays in your ledger unless you remove it.')
  await expect(dialog.getByRole('columnheader')).toHaveText(['Field', 'In your ledger', 'Bank'])
  await expect(dialog.getByRole('cell', { name: 'No longer reported' })).toHaveCount(3)
  await expect(dialog.getByTestId('comparison-amount').getByRole('cell').first()).toHaveText(`${MINUS}$18.00`)

  await dialog.getByRole('button', { name: 'Remove from ledger' }).click()
  await expect(toast(page, 'Transaction removed from the ledger.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(review.decisions).toEqual(['remove-from-ledger'])
  await expect(page.getByTestId(`transaction-row-${id}`)).toHaveCount(0)
  await expect(reviewBlock(page)).toBeHidden()

  await openPage(page, '/accounts')
  await expect(getAccountRow(page, 'Everyday')).toContainText('$100.00')
})

test('keeps a transaction the bank no longer reports, clearing the marker without reading the ledger again', async ({ page, request }) => {
  const setup = await start(page, request)
  const { id, review } = await addWaiting(page, request, setup, 'removal', 'UBER TRIP', { ledger: -1800, bank: -1800 })
  await openPage(page, '/transactions')
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(needsReview(row)).toBeVisible()

  const dialog = await openComparison(page, 'UBER TRIP', 'Review bank removal')
  const ledgerReads = watchLedgerReads(page)
  await dialog.getByRole('button', { name: 'Keep transaction' }).click()
  await expect(toast(page, 'Transaction kept.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(review.decisions).toEqual(['keep-transaction'])

  await expect(reviewBlock(page)).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$18.00`)
  await expect(needsReview(row)).toHaveCount(0)
  expect(ledgerReads).toEqual([])
})

test('says why a decision failed in the comparison, leaving the item waiting', async ({ page, request }) => {
  const setup = await start(page, request)
  const { id, review } = await addWaiting(page, request, setup, 'correction', COUNTDOWN, { ledger: -4210, bank: -4510 })
  await openPage(page, '/transactions')
  const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')

  // A refusal says the server's reason
  review.refusal = { status: 409, detail: 'This transaction has a bank removal waiting, so decide that first' }
  await dialog.getByRole('button', { name: 'Accept bank change' }).click()
  const reason = dialog.getByRole('alert')
  await expect(reason).toHaveText('This transaction has a bank removal waiting, so decide that first')
  await expect(reason).toBeInViewport()
  await expect(dialog.getByRole('button', { name: 'Accept bank change' })).toBeEnabled()

  // A decision that gets no answer says to try again
  review.refusal = 'network'
  await dialog.getByRole('button', { name: 'Keep current value' }).click()
  await expect(reason).toHaveText('Something went wrong. Please try again.')
  expect(review.decisions).toEqual(['accept-change', 'keep-current'])

  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(dialog).toBeHidden()
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(1)
  await expect(needsReview(page.getByTestId(`transaction-row-${id}`))).toBeVisible()
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`compares an edited correction readably in the ${colorScheme} theme, without scrolling sideways`, async ({ page, request }) => {
    const setup = await start(page, request)
    await addWaiting(page, request, setup, 'correction', COUNTDOWN, { ledger: -4000, bank: -4510, edited: true })
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openPage(page, '/transactions')
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    const dialog = await openComparison(page, COUNTDOWN, 'Review bank change')
    expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true)
    const texts = [
      dialog.getByText('SimpleFIN sent new values for a transaction you already approved. Nothing changes unless you accept.'),
      ...await dialog.getByRole('columnheader').all(),
      ...await dialog.getByRole('rowheader').all(),
      ...await dialog.getByRole('cell').all(),
    ]
    for (const text of texts) {
      expect(await contrastOf(text), `${await text.textContent()} in the ${colorScheme} theme`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
}
