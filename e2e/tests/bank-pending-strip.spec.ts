import { expect, test, type APIRequestContext, type Locator, type Page, type Response } from '@playwright/test'

import { createAccount, createGroup, createTransaction, signUpUser, todayInTestTimezone, type SeededAccount } from '../support/api'
import { filterTransactions, logInViaApi, openPage, watchServerRequests } from '../support/app'
import { answerLinksWith, isRead, pageOf, reviewItem, SEP_21 } from '../support/bankSync'
import { contrastOf, MIN_TEXT_CONTRAST, MINUS, readBoxes } from '../support/selectors'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop only, apart from the closed strip test and the light theme's readable text test.
// Those run at every size: a phone moves the explanation inside the opened strip, and the strip has to fit every
// width

// Transactions the bank hasn't posted yet show in a muted strip under the review block, read-only
// and outside the ledger.
//
// Each test answers the pending list with what it needs, except the one that reads the server's own
// empty list, since a sync would report every transaction as of the moment it ran rather than the
// times and days a test sets. The test that needs a sync to finish answers the link list too, so the
// sync ends when the test says

const THIS_YEAR = todayInTestTimezone().slice(0, 4)
const SEP_23 = `${THIS_YEAR}-09-23`
const SEP_20 = `${THIS_YEAR}-09-20`

// Below this width the explanation leaves the closed strip for the inside of the opened one
const PHONE_LAYOUT_BELOW_PX = 640

const HOUR_MS = 60 * 60 * 1000

// How long the strip stays open after the bank was asked, long enough for its rows to move past just now
const CHECK_AGE_MS = 5 * 60 * 1000

// The reads of bank items the list's accounts hold. Only the user's own personal accounts have them
const BANK_ITEM_READS = ['/bank-sync/pending', '/bank-review/items', '/bank-review/backlogs']

type PendingTransaction = {
  id: string
  account_id: string
  date: string
  amount: number | null
  raw_amount: string | null
  description: string
  observed_at: string
}

type Accounts = { everyday: SeededAccount; visa: SeededAccount; savings: SeededAccount }

/** When the bank was asked this many hours ago */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString()
}

/** Builds a pending transaction on an account, $18.00 out on Sep 23 and reported 3 hours ago unless told otherwise */
function pendingTransaction(id: string, accountId: string, fields: Partial<PendingTransaction> = {}): PendingTransaction {
  return {
    id,
    account_id: accountId,
    date: SEP_23,
    amount: -1800,
    raw_amount: null,
    description: `UBER TRIP ${id}`,
    observed_at: hoursAgo(3),
    ...fields,
  }
}

/** Answers the pending list with what `answer` returns for the accounts asked for, all accounts being none */
async function answerPending(page: Page, answer: (accountIds: string[]) => PendingTransaction[]): Promise<void> {
  await page.route(isRead('/bank-sync/pending'), (route) =>
    route.fulfill({ json: answer(new URL(route.request().url()).searchParams.getAll('account_id')) }))
}

/** Whether a response answers the pending list for this many accounts, all accounts being none */
function isPendingRead(accountCount: number) {
  return (response: Response) => {
    const url = new URL(response.url())
    return isRead('/bank-sync/pending')(url) && url.searchParams.getAll('account_id').length === accountCount
  }
}

/** Signs up with Everyday, a Visa card and Savings, Everyday holding a $42.50 grocery spend today */
async function start(page: Page, request: APIRequestContext): Promise<Accounts> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const visa = await createAccount(request, user, { name: 'Visa', accountKind: 'revolving', accountType: 'credit_card' })
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  await createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount: -4250 })
  await logInViaApi(page, user)
  return { everyday, visa, savings }
}

function pendingStrip(page: Page): Locator {
  return page.getByRole('region', { name: 'Pending bank transactions' })
}

function isPhoneLayout(page: Page): boolean {
  return page.viewportSize()!.width < PHONE_LAYOUT_BELOW_PX
}

/**
 * Answers the pending list with Everyday's Uber trip and coffee and Visa's hotel hold, reported three
 * days earlier: all three for a read of every account, and an account's own for a read of that
 * account alone. Which transactions a read holds is the server's to decide and the backend tests
 * check that, so each read the tests make has its answer canned
 *
 * @returns The accounts each read asked for, in the order asked
 */
async function answerThreePending(page: Page, { everyday, visa, savings }: Accounts): Promise<string[][]> {
  const uber = pendingTransaction('uber', everyday.id, { description: 'UBER TRIP' })
  const coffee = pendingTransaction('coffee', everyday.id, { description: 'HARBOUR COFFEE', date: SEP_21, amount: -450 })
  const hotel = pendingTransaction('hotel', visa.id, { description: 'HOTEL HOLD', date: SEP_20, amount: -24000, observed_at: hoursAgo(72) })
  const answers = new Map<string, PendingTransaction[]>([
    ['', [uber, coffee, hotel]],
    [everyday.id, [uber, coffee]],
    [visa.id, [hotel]],
    [savings.id, []],
  ])
  const asked: string[][] = []
  await answerPending(page, (accountIds) => {
    asked.push(accountIds)
    return answers.get(accountIds.join()) ?? []
  })
  return asked
}

test('shows the pending count closed, and each pending transaction newest first once opened', AT_EVERY_SIZE, async ({ page, request }) => {
  await answerThreePending(page, await start(page, request))

  await openPage(page, '/transactions')

  // Closed, with the explanation beside the count except on phones, where it waits inside
  const strip = pendingStrip(page)
  const toggle = strip.getByRole('button', { name: /^3 pending/ })
  const rows = strip.getByRole('listitem')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toHaveAccessibleName(isPhoneLayout(page) ? '3 pending' : '3 pending · Not in your balance until the bank settles them')
  await expect(rows).toHaveCount(0)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(rows).toHaveCount(3)
  const explanationInside = strip.getByText('Not in your balance until the bank settles them.')
  if (isPhoneLayout(page)) await expect(explanationInside).toBeVisible()
  else await expect(explanationInside).toBeHidden()
  await expect(rows.nth(0)).toContainText('UBER TRIP')
  await expect(rows.nth(0)).toContainText('Sep 23 · Everyday · Pending · Checked 3 hours ago')
  await expect(rows.nth(0)).toContainText(`${MINUS}$18.00`)
  await expect(rows.nth(1)).toContainText('Sep 21 · Everyday · Pending · Checked 3 hours ago')
  await expect(rows.nth(2)).toContainText('Sep 20 · Visa · Pending · Checked 3 days ago')
  await expect(rows.nth(2)).toContainText(`${MINUS}$240.00`)
})

test('opens nothing from a pending row', async ({ page, request }) => {
  await answerThreePending(page, await start(page, request))
  await openPage(page, '/transactions')
  const strip = pendingStrip(page)
  await strip.getByRole('button', { name: /^3 pending/ }).click()

  const row = strip.getByRole('listitem').first()
  await row.click()

  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(row).not.toBeFocused()
})

test('counts only the accounts the list is filtered to, hiding for those with nothing pending', async ({ page, request }) => {
  const accounts = await start(page, request)
  const asked = await answerThreePending(page, accounts)
  await openPage(page, '/transactions')
  const strip = pendingStrip(page)
  await expect(strip.getByRole('button', { name: /^3 pending/ })).toBeVisible()

  await filterTransactions(page, 'Accounts', 'Visa')

  await expect(strip.getByRole('button', { name: /^1 pending/ })).toBeVisible()
  expect(asked.at(-1)).toEqual([accounts.visa.id])

  await filterTransactions(page, 'Accounts', 'Visa')
  await filterTransactions(page, 'Accounts', 'Savings')

  await expect(strip).toBeHidden()
  expect(asked.at(-1)).toEqual([accounts.savings.id])
})

test("shows only an account's own pending transactions on its page, leaving out its name", async ({ page, request }) => {
  const accounts = await start(page, request)
  await answerThreePending(page, accounts)

  await openPage(page, `/accounts/${accounts.everyday.id}`)

  const strip = pendingStrip(page)
  const rows = strip.getByRole('listitem')
  await strip.getByRole('button', { name: /^2 pending/ }).click()
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('Sep 23 · Pending · Checked 3 hours ago')
  await expect(strip).not.toContainText('Everyday')
})

// Asked as the page's clock starts, since a real sync can't be timed to it
test('words when the bank was last asked anew as minutes pass with the strip open', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const checkedAt = new Date()
  await answerPending(page, () => [pendingTransaction('uber', everyday.id, { observed_at: checkedAt.toISOString() })])
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.install({ time: checkedAt })
  const allLanded = watchServerRequests(page)
  await openPage(page, '/transactions')
  const strip = pendingStrip(page)
  const row = strip.getByRole('listitem')
  await strip.getByRole('button', { name: /^1 pending/ }).click()
  await expect(row).toContainText('Checked just now')

  await allLanded()
  await page.clock.runFor(CHECK_AGE_MS)
  await expect(row).toContainText('Checked 5 minutes ago')
})

test('reads neither pending transactions nor review items for a list filtered to group accounts alone', async ({ page, request }) => {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const joint = await createAccount(request, user, { name: 'Joint', groupId: await createGroup(request, user, 'Household') })
  await createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount: -4250 })
  await createTransaction(request, user, { accountId: joint.id, categoryName: 'Groceries', amount: -1800 })
  await logInViaApi(page, user)

  // Everyday's hold answers every read, so a read made for no account in particular would show it
  await answerPending(page, () => [pendingTransaction('uber', everyday.id)])
  await openPage(page, '/transactions')
  const strip = pendingStrip(page)
  const transactionRows = page.getByTestId(/^transaction-row-/)
  await expect(strip.getByRole('button', { name: /^1 pending/ })).toBeVisible()
  await expect(transactionRows).toHaveCount(2)

  const bankReads: string[] = []
  page.on('request', (sent) => {
    const url = new URL(sent.url())
    if (BANK_ITEM_READS.some((path) => isRead(path)(url))) bankReads.push(sent.url())
  })
  await filterTransactions(page, 'Accounts', 'Joint')

  // Once the list shows Joint's transaction alone, any read made for the filter has gone out
  await expect(transactionRows).toHaveCount(1)
  await expect(strip).toBeHidden()
  expect(bankReads).toEqual([])
})

test('refreshes when a linked account finishes a sync, a posted transaction moving to the review block', async ({ page, request }) => {
  const { everyday } = await start(page, request)

  // Read every couple of seconds while it syncs, the sync ending with a later success that posted the Uber trip
  let synced = false
  await answerLinksWith(page, () => [everyday.id], () => ({
    last_success_at: synced ? `${SEP_23}T12:00:00Z` : `${SEP_23}T08:00:00Z`,
    sync_in_progress: !synced,
  }))
  const coffee = pendingTransaction('coffee', everyday.id, { description: 'HARBOUR COFFEE', amount: -450 })
  await answerPending(page, () => (synced ? [coffee] : [pendingTransaction('uber', everyday.id, { description: 'UBER TRIP' }), coffee]))
  await page.route(isRead('/bank-review/items'), (route) => route.fulfill({
    json: synced ? pageOf([reviewItem('uber-posted', 'new', everyday.id, { description: 'UBER TRIP', amount: -1800 })], { new: 1 }) : pageOf([]),
  }))

  await openPage(page, '/transactions')

  const strip = pendingStrip(page)
  const rows = strip.getByRole('listitem')
  await strip.getByRole('button', { name: /^2 pending/ }).click()
  await expect(rows).toHaveCount(2)

  synced = true
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('HARBOUR COFFEE')
  const reviewRows = page.getByRole('region', { name: 'Waiting for review' }).getByRole('listitem')
  await expect(reviewRows).toHaveCount(1)
  await expect(reviewRows.first()).toContainText('UBER TRIPNew')
})

test('says in the strip that pending transactions could not load, and reads only them again', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const reads = { pending: 0, review: 0 }
  let pendingFails = true
  await page.route(isRead('/bank-sync/pending'), (route) => {
    reads.pending += 1
    return pendingFails
      ? route.fulfill({ status: 500, json: { detail: 'Something went wrong' } })
      : route.fulfill({ json: [pendingTransaction('uber', everyday.id, { description: 'UBER TRIP' })] })
  })
  await page.route(isRead('/bank-review/items'), (route) => {
    reads.review += 1
    return route.fallback()
  })

  await openPage(page, '/transactions')

  // Said inside the strip's frame. The frame counts nothing while the transactions are unknown
  const strip = pendingStrip(page)
  const failure = strip.getByRole('alert').filter({ hasText: 'Pending bank transactions could not load.' })
  await expect(failure).toBeVisible()
  await expect(strip.getByRole('button', { name: /pending/ })).toHaveCount(0)

  // Trying again reads the pending transactions alone, and focus goes on to the strip's toggle
  // rather than falling to the top of the page with the retry
  const reviewReads = reads.review
  const pendingReads = reads.pending
  pendingFails = false
  await failure.getByRole('button', { name: 'Try again' }).click()
  await expect(strip.getByRole('button', { name: /^1 pending/ })).toBeFocused()
  await expect(failure).toBeHidden()
  expect(reads.pending).toBe(pendingReads + 1)
  expect(reads.review).toBe(reviewReads)
})

test("reads the server's pending transactions for every account and for several filtered to, showing no strip when none are pending", async ({ page, request }) => {
  const { visa } = await start(page, request)

  const everyAccount = page.waitForResponse(isPendingRead(0))
  await openPage(page, '/transactions')
  expect((await everyAccount).status()).toBe(200)

  await filterTransactions(page, 'Accounts', 'Visa')
  const twoAccounts = page.waitForResponse(isPendingRead(2))
  await filterTransactions(page, 'Accounts', 'Savings')
  const read = await twoAccounts
  expect(read.status()).toBe(200)
  expect(new URL(read.url()).searchParams.getAll('account_id')).toContain(visa.id)

  await expect(pendingStrip(page)).toBeHidden()
  await expect(page.getByText('Pending bank transactions could not load.')).toHaveCount(0)
})

for (const colorScheme of ['light', 'dark'] as const) {
  // Only the light run places the strip, so only it runs at every size
  test(`${colorScheme === 'light' ? 'sits under the review block and above the list, its' : 'keeps its'} text readable in the ${colorScheme} theme`, colorScheme === 'light' ? AT_EVERY_SIZE : {}, async ({ page, request }) => {
    const { everyday, visa } = await start(page, request)
    await page.route(isRead('/bank-review/items'), (route) => route.fulfill({ json: pageOf([reviewItem('everyday-1', 'new', everyday.id)], { new: 1 }) }))
    await answerPending(page, () => [
      pendingTransaction('uber', everyday.id, { description: 'UBER TRIP WITH A LONGER BANK DESCRIPTION THAN MOST' }),
      pendingTransaction('refund', visa.id, { description: 'HARBOUR REFUND', amount: 4250 }),
    ])
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })

    await openPage(page, '/transactions')

    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    const strip = pendingStrip(page)
    const toggle = strip.getByRole('button', { name: /^2 pending/ })
    const rows = strip.getByRole('listitem')
    await toggle.click()
    await expect(rows).toHaveCount(2)

    // The layout is the same in either theme, so it is measured in the light one only
    const uber = rows.filter({ hasText: 'UBER TRIP' })
    if (colorScheme === 'light') {
      // Under the review block and above the first transaction, within the page, with no sideways scroll
      // at any width. The three are measured together, since the page can still be settling above them
      const block = page.getByRole('region', { name: 'Waiting for review' })
      const firstTransaction = page.getByTestId(/^transaction-row-/).first()
      const [blockBox, stripBox, transactionBox] = await readBoxes(page, [block, strip, firstTransaction])
      const viewportWidth = page.viewportSize()!.width
      expect(stripBox.y).toBeGreaterThanOrEqual(blockBox.y + blockBox.height)
      expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(transactionBox.y)
      expect(stripBox.x).toBeGreaterThanOrEqual(0)
      expect(stripBox.x + stripBox.width).toBeLessThanOrEqual(viewportWidth)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

      // Each amount sits beside its text rather than over it, a long description wrapping instead
      const [description, amount] = [
        await uber.getByText('UBER TRIP WITH A LONGER BANK DESCRIPTION THAN MOST').boundingBox(),
        await uber.getByText(`${MINUS}$18.00`).boundingBox(),
      ]
      expect(amount!.x).toBeGreaterThanOrEqual(description!.x + description!.width)
      expect(amount!.x + amount!.width).toBeLessThanOrEqual(stripBox.x + stripBox.width)
      expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(24)
    }

    // The toggle's words are measured as they first show, then again over the tint a pointer that
    // can hover gives it
    const toggleTexts = [
      strip.getByText('2 pending', { exact: true }),
      strip.getByText('Not in your balance until the bank settles them').filter({ visible: true }),
    ]
    for (const text of toggleTexts) {
      expect(await contrastOf(text), await text.textContent() ?? '').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
    await toggle.hover()
    const texts = [
      ...toggleTexts,
      uber.getByText('UBER TRIP WITH A LONGER BANK DESCRIPTION THAN MOST'),
      uber.getByText('Sep 23 · Everyday · Pending · Checked 3 hours ago'),
      uber.getByText(`${MINUS}$18.00`),
      rows.filter({ hasText: 'HARBOUR REFUND' }).getByText('+$42.50'),
    ]
    for (const text of texts) {
      expect(await contrastOf(text), await text.textContent() ?? '').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
}
