import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, daysFromTodayInTestTimezone, signUpUser, type SeededAccount, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import {
  addBridgeTransactions,
  addImportedItem,
  changeBridgeTransaction,
  isRead,
  linkToEmptyBankAccount,
  readReviewItems,
  readTransaction,
  reviewBlock,
  syncBankLinkNow,
  waitForReviewItems,
  type ReviewItem,
} from '../support/bankSync'
import { expectTransactionRow, MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// Bulk approve in the review block's header previews the corrections and removals waiting in the
// accounts the block shows, then applies exactly the items it previewed.
//
// The corrections come from the fake SimpleFIN Bridge: Everyday links to an empty bank account at
// Harbour Bank, the user adds two of the bank's transactions to the ledger, the bank then changes both,
// and a sync brings the changes in for review, so the preview and the approval are the server's own
// and what they saved is read back. SimpleFIN never reports a removal, so the removals bulk approval
// also applies are left to the backend route tests, and the toast's count of them to the unit tests

const COUNTDOWN = 'COUNTDOWN 123 AUCKLAND'
const UBER = 'UBER TRIP'
const UBER_REDATED = daysFromTodayInTestTimezone(-5)
const UNAVAILABLE = 'Bulk approve applies corrections and removals. New items need a merchant and category, so each is added on its own.'
const REFUSAL = 'Another change is saving one of these transactions. Please try again.'

type Setup = {
  user: TestUser
  everyday: SeededAccount
  scenarioId: string
  externalAccountId: string

  /** Each ledger transaction's id, by the bank's description of it */
  ids: Record<string, string>
}

// Signed up fresh for every test, which keeps every account here
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/**
 * Signs up with Everyday, linked to Everyday Chequing at Harbour Bank, whose $42.10 at Countdown and
 * $16.00 Uber trip the user added to the ledger. The bank then says $45.10 for Countdown, dates the trip
 * a day earlier and sends two new transactions, and a sync brings in all four for review
 */
async function start(page: Page, request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const { scenario, externalAccountId } = await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [
      { id: 'TRN-COUNTDOWN', posted: daysFromTodayInTestTimezone(-3), amount: '-42.10', description: COUNTDOWN },
      { id: 'TRN-UBER', posted: daysFromTodayInTestTimezone(-4), amount: '-16.00', description: UBER },
    ],
  })
  const ids = {
    [COUNTDOWN]: (await addImportedItem(request, user, everyday.id, COUNTDOWN)).id,
    [UBER]: (await addImportedItem(request, user, everyday.id, UBER)).id,
  }

  await changeBridgeTransaction(request, scenario.id, externalAccountId, 'TRN-COUNTDOWN', { amount: '-45.10' })
  await changeBridgeTransaction(request, scenario.id, externalAccountId, 'TRN-UBER', { posted: UBER_REDATED })
  await addBridgeTransactions(request, scenario.id, externalAccountId, [
    { posted: daysFromTodayInTestTimezone(-1), amount: '-12.00', description: 'CORNER BAKERY' },
    { posted: daysFromTodayInTestTimezone(-2), amount: '-8.75', description: 'CAFE ROMA' },
  ])
  await syncBankLinkNow(request, user, everyday.id)
  await waitForReviewItems(request, user, everyday.id, (items) => {
    const waiting = countKinds(items)
    return waiting.corrections === 2 && waiting.new === 2
  })
  await logInViaApi(page, user)
  return { user, everyday, scenarioId: scenario.id, externalAccountId, ids }
}

/** The corrections and new items waiting, counted */
function countKinds(items: ReviewItem[]): { corrections: number; new: number } {
  const count = (kind: string) => items.filter((item) => item.kind === kind).length
  return { corrections: count('correction'), new: count('new') }
}

/** Collects the accounts each preview the page asks for from now on covers, all of them being null */
function watchPreviews(page: Page): (string[] | null)[] {
  const previews: (string[] | null)[] = []
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url() === `${API_BASE_URL}/bank-review/bulk-approve/preview`) {
      previews.push((sent.postDataJSON() as { account_ids: string[] | null }).account_ids)
    }
  })
  return previews
}

/** Counts the approvals the page sends from now on */
function watchApprovals(page: Page): { count: number } {
  const approvals = { count: 0 }
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url() === `${API_BASE_URL}/bank-review/bulk-approve`) approvals.count += 1
  })
  return approvals
}

/** The kinds of the items still waiting in the account, and its two transactions as the server holds them */
async function readSaved(request: APIRequestContext, { user, everyday, ids }: Setup) {
  const [waiting, countdown, uber] = await Promise.all([
    readReviewItems(request, user, everyday.id),
    readTransaction(request, user, ids[COUNTDOWN]),
    readTransaction(request, user, ids[UBER]),
  ])
  return { waiting: countKinds(waiting), countdown: { amount: countdown.amount }, uber: { dt: uber.dt } }
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

test('previews the corrections waiting, then approves them, the toast landing with the block and the ledger', async ({ page, request }) => {
  const setup = await start(page, request)
  const previews = watchPreviews(page)
  await openPage(page, '/transactions')
  await expect(reviewBlock(page).getByTestId('review-count')).toHaveText('4')

  const dialog = await openBulkApproval(page)
  expect(previews).toEqual([null])

  // The corrections' group lists its items once opened
  await expect(dialog.getByRole('listitem')).toHaveCount(0)
  await groupsIn(dialog).first().click()
  await expect(dialog.getByRole('listitem')).toHaveText([
    new RegExp(`^${COUNTDOWN}.*${MINUS}\\$45\\.10$`),
    new RegExp(`^${UBER}.*${MINUS}\\$16\\.00$`),
  ])

  await dialog.getByRole('button', { name: 'Approve 2' }).click()
  await expect(toast(page, 'status', '2 corrected.')).toBeVisible()

  // Read at once, since the toast waits for both
  const countdownAmount = page.getByTestId(`transaction-row-${setup.ids[COUNTDOWN]}`).getByTestId('transaction-amount').filter({ visible: true })
  expect(await reviewBlock(page).getByTestId('review-count').textContent()).toBe('2')
  expect(await countdownAmount.textContent()).toContain(`${MINUS}$45.10`)

  await expect(dialog).toBeHidden()
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(2)
  await expectTransactionRow(page, setup.ids[COUNTDOWN], `${MINUS}$45.10`)
  await expect(bulkApprove(page)).toHaveAttribute('aria-disabled', 'true')

  // Both took the bank's values, leaving the new items waiting
  expect(await readSaved(request, setup)).toEqual({ waiting: { corrections: 0, new: 2 }, countdown: { amount: -4510 }, uber: { dt: UBER_REDATED } })
})

test('leaves waiting a correction the bank changed since the preview, showing what the bank sent, and says so in an error toast', async ({ page, request }) => {
  const setup = await start(page, request)
  await openPage(page, '/transactions')
  const dialog = await openBulkApproval(page)
  const approve = dialog.getByRole('button', { name: 'Approve 2' })
  await expect(approve).toBeEnabled()

  // The bank sends $46.10 for Countdown while the preview is open, which a sync brings in. The page's
  // reads of its links are held meanwhile, as between two of its polls, so it doesn't read the preview
  // again and approves the one it shows. Once the approval is on its way they go on, since the answer
  // waits for the lists it refreshes
  let releaseLinkReads!: () => void
  const linkReadsHeld = new Promise<void>((resolve) => { releaseLinkReads = resolve })
  await page.route(isRead('/bank-sync/links'), async (route) => {
    await linkReadsHeld
    await route.fallback()
  })
  await changeBridgeTransaction(request, setup.scenarioId, setup.externalAccountId, 'TRN-COUNTDOWN', { amount: '-46.10' })
  await syncBankLinkNow(request, setup.user, setup.everyday.id)
  await waitForReviewItems(request, setup.user, setup.everyday.id, (items) => items.some((item) => item.bank.amount === -4610))
  const approval = page.waitForRequest((sent) => sent.method() === 'POST' && sent.url() === `${API_BASE_URL}/bank-review/bulk-approve`)
  await approve.click()
  await approval
  releaseLinkReads()

  // Counting what it applied, then the one left waiting
  await expect(toast(page, 'alert', /^1 corrected\. 1 /)).toBeVisible()
  await expect(dialog).toBeHidden()

  const countdown = reviewBlock(page).getByRole('listitem').filter({ hasText: COUNTDOWN })
  await expect(countdown.getByTestId('review-item-amount')).toHaveText(`${MINUS}$46.10`)
  await expect(reviewBlock(page).getByTestId('review-count')).toHaveText('3')
  await expectTransactionRow(page, setup.ids[COUNTDOWN], `${MINUS}$42.10`)
  expect(await readSaved(request, setup)).toEqual({ waiting: { corrections: 1, new: 2 }, countdown: { amount: -4210 }, uber: { dt: UBER_REDATED } })
})

test('says why an approval was refused beside the actions, leaving every item waiting, and sends it again when pressed again', async ({ page, request }) => {
  const setup = await start(page, request)

  // The first approval is refused as the server refuses one only while another change holds a
  // transaction, and the next goes on to the server
  let refused = false
  await page.route(`${API_BASE_URL}/bank-review/bulk-approve`, (route) => {
    if (refused) return route.fallback()
    refused = true
    return route.fulfill({ status: 409, json: { detail: REFUSAL } })
  })
  const approvals = watchApprovals(page)
  await openPage(page, '/transactions')
  const dialog = await openBulkApproval(page)
  const approve = dialog.getByRole('button', { name: 'Approve 2' })

  await approve.click()
  await expect(dialog.getByRole('alert')).toHaveText(REFUSAL)
  await expect(approve).toBeEnabled()
  await expect(reviewBlock(page).getByTestId('review-count')).toHaveText('4')
  await expectTransactionRow(page, setup.ids[COUNTDOWN], `${MINUS}$42.10`)

  await approve.click()
  await expect(toast(page, 'status', '2 corrected.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(approvals.count).toBe(2)
  expect(await readSaved(request, setup)).toEqual({ waiting: { corrections: 0, new: 2 }, countdown: { amount: -4510 }, uber: { dt: UBER_REDATED } })
})

test('applies the items once when Approve is pressed twice', async ({ page, request }) => {
  await start(page, request)
  const approvals = watchApprovals(page)
  await openPage(page, '/transactions')
  const dialog = await openBulkApproval(page)

  await dialog.getByRole('button', { name: 'Approve 2' }).dblclick()
  await expect(toast(page, 'status', '2 corrected.')).toBeVisible()
  await expect(dialog).toBeHidden()
  expect(approvals.count).toBe(1)
})

test('follows the account the list shows, and is unavailable where only new items wait, saying why', async ({ page, request }) => {
  const setup = await start(page, request)
  const visa = await createAccount(request, setup.user, { name: 'Visa' })
  await linkToEmptyBankAccount(request, setup.user, {
    accountId: visa.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [{ posted: daysFromTodayInTestTimezone(-2), amount: '-60.00', description: 'HOTEL HOLD' }],
  })
  await waitForReviewItems(request, setup.user, visa.id, (items) => items.length === 1)
  const previews = watchPreviews(page)

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
  expect(previews).toEqual([])

  await openPage(page, `/accounts/${setup.everyday.id}`)
  // Everyday's two, leaving out Visa's new item
  const dialog = await openBulkApproval(page)
  await expect(dialog.getByRole('button', { name: 'Approve 2' })).toBeEnabled()
  expect(previews).toEqual([[setup.everyday.id]])
})
