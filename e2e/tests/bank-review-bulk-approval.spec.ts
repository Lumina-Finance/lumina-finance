import { expect, test, type APIRequestContext, type Locator, type Page, type Route } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser, type SeededAccount, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { answerReviewItems, pageOf, reviewBlock, reviewItem, SEP_21, type ReviewItem } from '../support/bankSync'
import { contrastOf, expectTransactionRow, MIN_TEXT_CONTRAST, MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// Bulk approve in the review block's header previews the corrections and removals waiting in the
// accounts the block shows, then applies exactly the items it previewed.
//
// Nothing links an account on the server for a sync to bring in a correction, and no provider reports
// removals, so each test records manual transactions, answers the review list with items waiting on
// them, and answers the preview and the approval as the server would: the approval writes the bank's
// values or deletes the transaction through the real server, and leaves waiting any item whose version
// moved since the preview. That stand-in tests the screen alone: the real preview and approval, their
// version checks and their locking are left to the backend route tests

const COUNTDOWN = 'COUNTDOWN 123 AUCKLAND'
const UBER = 'UBER TRIP'
const FRESHCO = 'FRESHCO 88'
const SEP_20 = `${SEP_21.slice(0, 4)}-09-20`
const UNAVAILABLE = 'Bulk approve applies corrections and removals. New items need a merchant and category, so each is added on its own.'

type SentItem = { id: string; version: number }

/** The items waiting, each ledger transaction's id by description, and each preview and approval asked for */
type Review = {
  user: TestUser
  everyday: SeededAccount
  waiting: ReviewItem[]
  ids: Record<string, string>
  previews: (string[] | null)[]
  approvals: SentItem[][]

  /** How the next approval is refused, applying nothing, or null to apply it */
  refusal: { status: number; detail: string } | null
}

// Signed up fresh for every test, which keeps every account here
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/**
 * Signs up with Everyday holding $100.00 and, all recorded on Sep 21, Countdown at $42.10 out with the
 * bank now saying $45.10, Uber at $16.00 out with the bank now dating it Sep 20, and FreshCo at $18.00
 * out, which the bank no longer reports, waiting for review above four new items
 */
async function start(page: Page, request: APIRequestContext): Promise<Review> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  const record = (amount: number) => createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount, date: SEP_21 })
  const ids: Record<string, string> = { [COUNTDOWN]: await record(-4210), [UBER]: await record(-1600), [FRESHCO]: await record(-1800) }
  // On the ledger transaction recorded with this description and amount, the bank now sending `bank`
  const waitingOn = (id: string, kind: 'correction' | 'removal', description: string, amount: number, bank: { date?: string; amount?: number } = {}) => {
    const ledger = { date: SEP_21, amount, raw_amount: null, description, merchant_name: null, category_hint: null }
    return reviewItem(id, kind, everyday.id, { ...ledger, ...bank }, {
      transaction_id: ids[description],
      current: ledger,
      changed_fields: Object.keys(bank) as ReviewItem['changed_fields'],
    })
  }
  const review: Review = {
    user,
    everyday,
    waiting: [
      waitingOn('countdown', 'correction', COUNTDOWN, -4210, { amount: -4510 }),
      waitingOn('uber', 'correction', UBER, -1600, { date: SEP_20 }),
      waitingOn('freshco', 'removal', FRESHCO, -1800),
      ...['one', 'two', 'three', 'four'].map((id) => reviewItem(id, 'new', everyday.id)),
    ],
    ids,
    previews: [],
    approvals: [],
    refusal: null,
  }
  await answerReviewItems(page, (accountIds) => pageOf(inScope(review, accountIds)))
  await page.route(`${API_BASE_URL}/bank-review/bulk-approve/preview`, (route) => answerPreview(route, review))
  await page.route(`${API_BASE_URL}/bank-review/bulk-approve`, (route) => answerApproval(route, request, review))
  await logInViaApi(page, user)
  return review
}

function inScope(review: Review, accountIds: string[]): ReviewItem[] {
  return review.waiting.filter((item) => accountIds.length === 0 || accountIds.includes(item.account_id))
}

/** Lists the corrections and removals waiting in the accounts asked for, each group with its net effect, as the server would */
async function answerPreview(route: Route, review: Review): Promise<void> {
  const { account_ids: accountIds } = route.request().postDataJSON() as { account_ids: string[] | null }
  review.previews.push(accountIds)
  const items = inScope(review, accountIds ?? [])
  const moved = (item: ReviewItem) => {
    const ledger = item.current?.amount ?? 0
    if (item.kind === 'removal') return -ledger
    return item.changed_fields.includes('amount') ? (item.bank.amount ?? 0) - ledger : 0
  }
  const groups = (['correction', 'removal'] as const).flatMap((kind) => {
    const listed = items.filter((item) => item.kind === kind)
    const amount = listed.reduce((sum, item) => sum + moved(item), 0)
    const netEffect = amount === 0 ? [] : [{ currency: review.everyday.currency, amount }]
    return listed.length === 0 ? [] : [{ kind, count: listed.length, net_effect: netEffect, items: listed }]
  })
  return route.fulfill({ json: { groups, excluded_count: items.filter((item) => item.kind === 'new').length } })
}

/**
 * Applies each item sent that still waits at the version sent, writing the bank's values or deleting
 * the transaction through the real server, and counts those sent that still wait
 */
async function answerApproval(route: Route, request: APIRequestContext, review: Review): Promise<void> {
  const { items } = route.request().postDataJSON() as { items: SentItem[] }
  review.approvals.push(items)
  if (review.refusal) return route.fulfill({ status: review.refusal.status, json: { detail: review.refusal.detail } })
  const headers = asUser(review.user)
  const applied: ReviewItem[] = []
  for (const sent of items) {
    const item = review.waiting.find((waiting) => waiting.id === sent.id && waiting.version === sent.version)
    if (!item || item.kind === 'new') continue
    const path = `${API_BASE_URL}/transactions/${String(item.transaction_id)}`
    const response = item.kind === 'removal'
      ? await request.delete(path, { headers })
      : await request.patch(path, { headers, data: item.changed_fields.includes('amount') ? { amount: item.bank.amount } : { dt: item.bank.date } })
    expect(response.ok(), `applying ${item.id} answered ${response.status()}`).toBe(true)
    applied.push(item)
  }
  review.waiting = review.waiting.filter((item) => !applied.includes(item))
  const stillWaiting = items.filter((sent) => review.waiting.some((item) => item.id === sent.id)).length
  const count = (kind: string) => applied.filter((item) => item.kind === kind).length
  return route.fulfill({
    json: { corrected: count('correction'), removed: count('removal'), failed: stillWaiting, applied_ids: applied.map((item) => item.id) },
  })
}

function bulkApprove(page: Page): Locator {
  return reviewBlock(page).getByRole('button', { name: 'Bulk approve' })
}

async function openBulkApproval(page: Page): Promise<Locator> {
  await bulkApprove(page).click()
  const dialog = page.getByRole('dialog', { name: 'Bulk approve' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The buttons heading the preview's groups, each opening its items */
function groupsIn(dialog: Locator): Locator {
  return dialog.locator('button[aria-expanded]')
}

/** A toast, an error toast being an alert */
function toast(page: Page, role: 'status' | 'alert', text: string | RegExp): Locator {
  return page.getByRole(role).filter({ hasText: text })
}

/** The reason beside the pointer, which the page draws outside the region it explains */
function shownReason(page: Page): Locator {
  return page.getByTestId('disabled-reason-tooltip').filter({ hasText: UNAVAILABLE })
}

test('previews the corrections and the removal waiting, then approves them, the toast landing with the block and the ledger', async ({ page, request }) => {
  const review = await start(page, request)
  await openPage(page, '/transactions')
  await expect(reviewBlock(page).getByTestId('review-count')).toHaveText('7')

  const dialog = await openBulkApproval(page)
  expect(review.previews).toEqual([null])

  // The corrections' group, listed first, lists its items once opened
  await expect(dialog.getByRole('listitem')).toHaveCount(0)
  await groupsIn(dialog).first().click()
  await expect(dialog.getByRole('listitem')).toHaveText([
    new RegExp(`^${COUNTDOWN}.*${MINUS}\\$45\\.10$`),
    new RegExp(`^${UBER}.*${MINUS}\\$16\\.00$`),
  ])

  await dialog.getByRole('button', { name: 'Approve 3' }).click()
  await expect(toast(page, 'status', '2 corrected, 1 removed.')).toBeVisible()

  // Read at once, since the toast waits for both
  const countdownAmount = page.getByTestId(`transaction-row-${review.ids[COUNTDOWN]}`).getByTestId('transaction-amount').filter({ visible: true })
  expect(await reviewBlock(page).getByTestId('review-count').textContent()).toBe('4')
  expect(await countdownAmount.textContent()).toContain(`${MINUS}$45.10`)

  await expect(dialog).toBeHidden()
  expect(review.approvals).toEqual([[{ id: 'countdown', version: 1 }, { id: 'uber', version: 1 }, { id: 'freshco', version: 1 }]])
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(4)
  await expectTransactionRow(page, review.ids[COUNTDOWN], `${MINUS}$45.10`)
  await expect(page.getByTestId(`transaction-row-${review.ids[FRESHCO]}`)).toHaveCount(0)
  await expect(bulkApprove(page)).toHaveAttribute('aria-disabled', 'true')
})

test('leaves waiting a correction the bank changed since the preview, showing what the bank sent, and says so in an error toast', async ({ page, request }) => {
  const review = await start(page, request)
  await openPage(page, '/transactions')
  const dialog = await openBulkApproval(page)
  const approve = dialog.getByRole('button', { name: 'Approve 3' })
  await expect(approve).toBeEnabled()

  // The bank sends $46.10 for Countdown while the preview is open
  review.waiting = review.waiting.map((item) => (item.id === 'countdown' ? { ...item, version: 2, bank: { ...item.bank, amount: -4610 } } : item))
  await approve.click()

  // Counting what it applied, then the one left waiting
  await expect(toast(page, 'alert', /^1 corrected, 1 removed\. 1 /)).toBeVisible()
  await expect(dialog).toBeHidden()

  const countdown = reviewBlock(page).getByRole('listitem').filter({ hasText: COUNTDOWN })
  await expect(countdown.getByTestId('review-item-amount')).toHaveText(`${MINUS}$46.10`)
  await expect(reviewBlock(page).getByTestId('review-count')).toHaveText('5')
  await expectTransactionRow(page, review.ids[COUNTDOWN], `${MINUS}$42.10`)
  await expect(page.getByTestId(`transaction-row-${review.ids[FRESHCO]}`)).toHaveCount(0)
})

test('says why an approval was refused beside the actions, leaving every item waiting, and sends it again when pressed again', async ({ page, request }) => {
  const review = await start(page, request)
  const refusal = { status: 409, detail: 'Another change is saving one of these transactions. Please try again.' }
  review.refusal = refusal
  await openPage(page, '/transactions')
  const dialog = await openBulkApproval(page)
  const approve = dialog.getByRole('button', { name: 'Approve 3' })

  await approve.click()
  await expect(dialog.getByRole('alert')).toHaveText(refusal.detail)
  await expect(approve).toBeEnabled()
  await expect(reviewBlock(page).getByTestId('review-count')).toHaveText('7')
  await expectTransactionRow(page, review.ids[FRESHCO], `${MINUS}$18.00`)

  review.refusal = null
  await approve.click()
  await expect(toast(page, 'status', '2 corrected, 1 removed.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(review.approvals).toHaveLength(2)
})

test('applies the items once when Approve is pressed twice', async ({ page, request }) => {
  const review = await start(page, request)
  await openPage(page, '/transactions')
  const dialog = await openBulkApproval(page)

  await dialog.getByRole('button', { name: 'Approve 3' }).dblclick()
  await expect(toast(page, 'status', '2 corrected, 1 removed.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(review.approvals).toHaveLength(1)
})

test('follows the account the list shows, and is unavailable where only new items wait, saying why', async ({ page, request }) => {
  const review = await start(page, request)
  const visa = await createAccount(request, review.user, { name: 'Visa' })
  review.waiting.push(reviewItem('visa', 'new', visa.id))

  await openPage(page, `/accounts/${visa.id}`)
  const bulk = bulkApprove(page)
  await expect(bulk).toHaveAttribute('aria-disabled', 'true')
  await expect(bulk).toHaveAccessibleDescription(UNAVAILABLE)
  await bulk.hover()
  await expect(shownReason(page)).toHaveCSS('opacity', '1')

  // Held back it still takes keyboard focus, and its full-strength label stays faded as half-transparent
  await page.mouse.move(0, 0)
  await bulk.focus()
  await expect(bulk).toHaveCSS('color', /0\.5\)$/)

  // Pressing it anyway opens nothing
  await bulk.click({ force: true })
  await expect(page.getByRole('dialog', { name: 'Bulk approve' })).toHaveCount(0)
  expect(review.previews).toEqual([])

  await openPage(page, `/accounts/${review.everyday.id}`)
  // Everyday's three, leaving out Visa's new item
  const dialog = await openBulkApproval(page)
  await expect(dialog.getByRole('button', { name: 'Approve 3' })).toBeEnabled()
  expect(review.previews).toEqual([[review.everyday.id]])
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`shows Bulk approve and an opened preview readably in the ${colorScheme} theme, Approve before Cancel, without scrolling sideways`, async ({ page, request }) => {
    await start(page, request)
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openPage(page, '/transactions')
    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)

    // The block's title keeps to one line beside the button, whose label reads on the block's tint
    const title = reviewBlock(page).getByRole('heading', { name: 'Waiting for review' })
    expect(await title.evaluate((heading) => heading.getBoundingClientRect().height < Number.parseFloat(getComputedStyle(heading).lineHeight) * 1.5)).toBe(true)
    expect(await contrastOf(bulkApprove(page))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)

    const dialog = await openBulkApproval(page)
    await groupsIn(dialog).first().click()
    await expect(dialog.getByRole('listitem')).toHaveCount(2)
    expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true)

    // A confirmation that changes records leads with its action
    const approveLeft = (await dialog.getByRole('button', { name: 'Approve 3' }).boundingBox())?.x ?? Number.POSITIVE_INFINITY
    expect(approveLeft).toBeLessThan((await dialog.getByRole('button', { name: 'Cancel' }).boundingBox())?.x ?? 0)

    const texts = [
      dialog.getByText('Everything below is applied at once. Nothing else in your ledger changes.'),
      ...await groupsIn(dialog).locator('span span').all(),
      dialog.getByRole('note'),
      ...await dialog.getByRole('listitem').locator('span span').all(),
    ]
    for (const text of texts) {
      expect(await contrastOf(text), `${await text.textContent()} in the ${colorScheme} theme`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
}
