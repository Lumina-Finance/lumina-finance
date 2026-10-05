import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  createAccount,
  createTransaction,
  signUpUser,
  todayInTestTimezone,
  type SeededAccount,
  type TestUser,
} from '../support/api'
import { filterTransactions, logInViaApi, openPage } from '../support/app'
import { answerAsBankImported, answerLinksWith, BANK_SOURCE } from '../support/bankSync'
import { MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// Bank items waiting for review show in a block above the transaction list, outside the ledger.
//
// Nothing links an account on the server for a sync to bring items in, so each test answers the
// review list with the items it needs. The backlogs are the server's own, which read nothing
// waiting, unless a test answers them too, and the link list isn't served yet, so the one test that
// needs a sync to finish answers it

// Bank dates in today's year, which the block shows without a year
const THIS_YEAR = todayInTestTimezone().slice(0, 4)
const SEP_21 = `${THIS_YEAR}-09-21`

// What WCAG AA asks of the block's text, all of it small
const MIN_TEXT_CONTRAST = 4.5

type ItemKind = 'new' | 'correction' | 'removal'

type BankValues = {
  date: string
  amount: number | null
  raw_amount: string | null
  description: string
  merchant_name: string | null
  category_hint: string | null
}

type ReviewItem = {
  id: string
  kind: ItemKind
  account_id: string
  bank: BankValues
  current: BankValues | null
  changed_fields: ('date' | 'amount' | 'description')[]
  [field: string]: unknown
}

type ReviewPage = { items: ReviewItem[]; counts: Record<ItemKind, number>; next_cursor: string | null }

type Backlog = { account_id: string; waiting_new_count: number; paused: boolean; review_warning: boolean }

type Accounts = { user: TestUser; everyday: SeededAccount; visa: SeededAccount; savings: SeededAccount }

/**
 * Builds an item of a kind on an account, $12.50 out on Sep 21 unless told otherwise. A correction
 * or removal is about a ledger transaction of $18.00 out
 */
function reviewItem(id: string, kind: ItemKind, accountId: string, bank: Partial<BankValues> = {}, fields: Partial<ReviewItem> = {}): ReviewItem {
  const values = { date: SEP_21, amount: -1250, raw_amount: null, description: `GROCER ${id}`, merchant_name: null, category_hint: null, ...bank }
  return {
    id,
    kind,
    account_id: accountId,
    provider: 'simplefin',
    provider_name: 'SimpleFIN',
    external_transaction_id: `TRN-${id}`,
    received_at: `${SEP_21}T12:00:00Z`,
    version: 1,
    bank: values,
    transaction_id: kind === 'new' ? null : `transaction-${id}`,
    current: kind === 'new' ? null : { ...values, amount: -1800 },
    changed_fields: kind === 'correction' ? ['amount'] : [],
    protected_fields: [],
    ...fields,
  }
}

/** One page holding every one of these items, counted by kind */
function pageOf(items: ReviewItem[]): ReviewPage {
  const count = (kind: ItemKind) => items.filter((item) => item.kind === kind).length
  return { items, counts: { new: count('new'), correction: count('correction'), removal: count('removal') }, next_cursor: null }
}

/** Whether a request reads this API path, whatever its query */
function isRead(path: string) {
  return (url: URL) => url.href.split('?')[0] === `${API_BASE_URL}${path}`
}

/**
 * Answers the review list with what `answer` returns for the accounts and cursor asked for, all
 * accounts being none, or fails it with the status returned
 */
async function answerReviewItems(page: Page, answer: (accountIds: string[], cursor: string | null) => ReviewPage | number): Promise<void> {
  await page.route(isRead('/bank-review/items'), (route) => {
    const url = new URL(route.request().url())
    const answered = answer(url.searchParams.getAll('account_id'), url.searchParams.get('cursor'))
    return typeof answered === 'number'
      ? route.fulfill({ status: answered, json: { detail: 'Something went wrong' } })
      : route.fulfill({ json: answered })
  })
}

/** Answers the backlogs with what `answer` returns for the accounts asked for, all accounts being none */
async function answerBacklogs(page: Page, answer: (accountIds: string[]) => Backlog[]): Promise<void> {
  await page.route(isRead('/bank-review/backlogs'), (route) =>
    route.fulfill({ json: answer(new URL(route.request().url()).searchParams.getAll('account_id')) }))
}

/** Signs up with Everyday, a Visa card and Savings, Everyday holding a $42.50 grocery spend today */
async function start(page: Page, request: APIRequestContext): Promise<Accounts> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const visa = await createAccount(request, user, { name: 'Visa', accountKind: 'revolving', accountType: 'credit_card' })
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  await createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount: -4250 })
  await logInViaApi(page, user)
  return { user, everyday, visa, savings }
}

/**
 * Adds an $18.00 Uber trip today to Everyday, read as imported from SimpleFIN with this item waiting
 * on it, so its row carries a Needs review marker. Returns the transaction's id
 */
async function addUberTripAwaiting(page: Page, request: APIRequestContext, accounts: Accounts, reviewItemId: string): Promise<string> {
  const uberId = await createTransaction(request, accounts.user, { accountId: accounts.everyday.id, categoryName: 'Groceries', amount: -1800 })
  await answerAsBankImported(page, {
    [uberId]: {
      ...BANK_SOURCE,
      bank_values: { ...BANK_SOURCE.bank_values, date: todayInTestTimezone(), amount: -1800, description: 'UBER TRIP' },
      review_item_id: reviewItemId,
    },
  })
  return uberId
}

/** Follows a ledger row's Needs review marker to its waiting item */
async function showWaitingItem(page: Page, transactionId: string): Promise<void> {
  await page.getByTestId(`transaction-row-${transactionId}`).getByRole('button', { name: 'Needs review. Show the waiting item' }).click()
}

function reviewBlock(page: Page): Locator {
  return page.getByRole('region', { name: 'Waiting for review' })
}

/**
 * The contrast of an element's text against what is behind it, every translucent background
 * between it and the first opaque one blended in
 */
async function contrastOf(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    type Rgba = [number, number, number, number]
    const parse = (value: string): Rgba => {
      const channels = /rgba?\(([^)]+)\)/.exec(value)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (!channels) throw new Error(`Unreadable colour ${value}`)
      return [channels[0], channels[1], channels[2], channels[3] ?? 1]
    }
    const over = (top: Rgba, bottom: Rgba): Rgba =>
      [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3])).concat(1) as Rgba
    const layers: Rgba[] = []
    for (let current: Element | null = node; current; current = current.parentElement) {
      const background = parse(getComputedStyle(current).backgroundColor)
      if (background[3] > 0) layers.unshift(background)
      if (background[3] === 1) break
    }
    const background = layers.reduce<Rgba>((below, layer) => over(layer, below), [255, 255, 255, 1])
    const text = over(parse(getComputedStyle(node).color), background)
    const luminance = (colour: Rgba) => {
      const [red, green, blue] = colour.slice(0, 3).map((channel) => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const [lighter, darker] = [luminance(text), luminance(background)].sort((a, b) => b - a)
    return (lighter + 0.05) / (darker + 0.05)
  })
}

test('shows each kind of item for the accounts the list shows, and only its own on an account page', async ({ page, request }) => {
  const { everyday, visa } = await start(page, request)
  const items = [
    reviewItem('visa-1', 'correction', visa.id, { description: 'COUNTDOWN 123', amount: -2310 }),
    reviewItem('everyday-1', 'new', everyday.id, { description: 'HARBOUR COFFEE' }),
    reviewItem('everyday-2', 'removal', everyday.id, { description: 'UBER TRIP' }),
  ]
  const asked: string[][] = []
  await answerReviewItems(page, (accountIds) => {
    asked.push(accountIds)
    return pageOf(items.filter((item) => accountIds.length === 0 || accountIds.includes(item.account_id)))
  })

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const rows = block.getByRole('listitem')
  await expect(block.getByText('3', { exact: true })).toBeVisible()
  await expect(block).toContainText('From your bank, and left out of every balance until you act on them.')
  await expect(rows.nth(0)).toContainText('COUNTDOWN 123Correction')
  await expect(rows.nth(0)).toContainText('Sep 21 · Visa · The bank changed the amount')
  await expect(rows.nth(0)).toContainText(`${MINUS}$23.10`)
  await expect(rows.nth(1)).toContainText('HARBOUR COFFEENew')
  await expect(rows.nth(1)).toContainText('Sep 21 · Everyday · Needs merchant and category')
  await expect(rows.nth(2)).toContainText('UBER TRIPRemoval')
  await expect(rows.nth(2)).toContainText('Sep 21 · Everyday · The bank no longer reports this transaction')
  await expect(rows.nth(2).getByText(`${MINUS}$18.00`)).toHaveCSS('text-decoration-line', 'line-through')

  await filterTransactions(page, 'Accounts', 'Visa')
  await expect(rows).toHaveCount(1)
  await expect(block.getByText('1', { exact: true })).toBeVisible()
  expect(asked.at(-1)).toEqual([visa.id])

  // Savings has nothing waiting, so with Visa unticked and Savings ticked the block goes
  await filterTransactions(page, 'Accounts', 'Visa', 1)
  await filterTransactions(page, 'Accounts', 'Savings')
  await expect(block).toBeHidden()

  await openPage(page, `/accounts/${visa.id}`)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Sep 21 · The bank changed the amount')
  await expect(block).not.toContainText('Visa')
})

test('says the waiting items could not load rather than leaving the space empty', async ({ page, request }) => {
  await start(page, request)
  await answerReviewItems(page, () => 500)

  await openPage(page, '/transactions')

  await expect(page.getByRole('alert').filter({ hasText: 'Bank items to review could not load' })).toBeVisible()
  await expect(reviewBlock(page)).toBeHidden()
})

test('says the pause status could not load while still showing the items', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  await answerReviewItems(page, () => pageOf([reviewItem('everyday-1', 'new', everyday.id)]))
  await page.route(isRead('/bank-review/backlogs'), (route) => route.fulfill({ status: 500, json: { detail: 'Something went wrong' } }))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  await expect(block.getByRole('alert').filter({ hasText: 'Sync pause status could not load' })).toBeVisible()
  await expect(block.getByRole('listitem')).toHaveCount(1)
})

test('shows the first 4 of a 1,500 item backlog, and loads the rest a page at a time once opened', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  await answerReviewItems(page, (_, cursor) => {
    const index = cursor ? Number(cursor.replace('page-', '')) : 0
    return {
      items: Array.from({ length: 50 }, (_, offset) => reviewItem(`item-${index * 50 + offset}`, 'new', everyday.id)),
      counts: { new: 1500, correction: 0, removal: 0 },
      next_cursor: index < 29 ? `page-${index + 1}` : null,
    }
  })

  // Each page is noted as it is asked for, and the second is held until the block has said it is loading
  const cursors: (string | null)[] = []
  let releaseSecondPage = () => {}
  const secondPageReleased = new Promise<void>((resolve) => { releaseSecondPage = resolve })
  await page.route(isRead('/bank-review/items'), async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get('cursor')
    cursors.push(cursor)
    if (cursor === 'page-1') await secondPageReleased
    await route.fallback()
  })

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const rows = block.getByRole('listitem')
  const count = block.getByText('1,500', { exact: true })
  await expect(count).toBeVisible()
  await expect(rows).toHaveCount(4)

  await block.getByRole('button', { name: 'Show all 1,500' }).click()
  await expect(rows).toHaveCount(50)
  expect(cursors).toEqual([null])

  await rows.last().scrollIntoViewIfNeeded()
  const loading = block.getByRole('status')
  await expect(loading).toHaveText('Loading more items…')
  await expect.poll(() => cursors).toEqual([null, 'page-1'])
  releaseSecondPage()
  await expect(rows).toHaveCount(100)
  await expect(count).toBeVisible()

  await block.getByRole('button', { name: 'Show fewer' }).click()
  await expect(rows).toHaveCount(4)
  await expect(loading).toBeHidden()
})

test('closes once four or fewer items wait, so it shows only the first four when more come back', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const items = Array.from({ length: 6 }, (_, index) => reviewItem(`item-${index}`, 'new', everyday.id))

  // Each sync that finishes reads the items again, which are then what `waiting` holds. The link is
  // read every couple of seconds while it syncs, so the list is read again in place, never emptied
  let waiting = items
  let syncs = 0
  await answerLinksWith(page, () => [everyday.id], () => ({ last_success_at: `${SEP_21}T0${syncs}:00:00Z`, sync_in_progress: true }))
  await answerReviewItems(page, () => pageOf(waiting))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const rows = block.getByRole('listitem')
  await block.getByRole('button', { name: 'Show all 6' }).click()
  await expect(rows).toHaveCount(6)

  // Two decided on another device leave 4, the most a closed block shows
  waiting = items.slice(0, 4)
  syncs += 1
  await expect(block.getByRole('button', { name: /^Show / })).toBeHidden()
  await expect(rows).toHaveCount(4)

  // Two more arriving bring back the first four of the 6
  waiting = items
  syncs += 1
  await expect(block.getByRole('button', { name: 'Show all 6' })).toHaveAttribute('aria-expanded', 'false')
  await expect(rows).toHaveCount(4)
})

test("goes from a ledger row's Needs review marker to its item, loading the page it's on", async ({ page, request }) => {
  const accounts = await start(page, request)
  const { everyday } = accounts
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-59')

  // The Uber removal is the 60th item, on the second page of two
  const cursors: (string | null)[] = []
  await answerReviewItems(page, (_, cursor) => {
    cursors.push(cursor)
    const first = cursor ? 50 : 0
    return {
      items: Array.from({ length: 50 }, (_, offset) => first + offset === 59
        ? reviewItem('item-59', 'removal', everyday.id, { description: 'UBER TRIP' })
        : reviewItem(`item-${first + offset}`, 'new', everyday.id)),
      counts: { new: 99, correction: 0, removal: 1 },
      next_cursor: cursor ? null : 'page-1',
    }
  })

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  await expect(block.getByRole('listitem')).toHaveCount(4)
  await showWaitingItem(page, uberId)

  // Ringed for a moment once it is reached, then left as the other rows are
  const item = block.getByRole('listitem').filter({ hasText: 'UBER TRIP' })
  await expect(item).toHaveCSS('box-shadow', /inset/)
  await expect(item).toBeFocused()
  await expect(item).toBeInViewport()
  expect(cursors).toEqual([null, 'page-1'])
  await expect(item.getByText(`${MINUS}$18.00`)).toHaveCSS('text-decoration-line', 'line-through')
  await expect(item).toHaveCSS('box-shadow', 'none')
})

test('opens the block for a marker whose item is the fifth, the first one it hides', async ({ page, request }) => {
  const accounts = await start(page, request)
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-4')
  await answerReviewItems(page, () => pageOf(Array.from({ length: 6 }, (_, index) => index === 4
    ? reviewItem('item-4', 'removal', accounts.everyday.id, { description: 'UBER TRIP' })
    : reviewItem(`item-${index}`, 'new', accounts.everyday.id))))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  await expect(block.getByRole('listitem')).toHaveCount(4)
  await showWaitingItem(page, uberId)

  await expect(block.getByRole('listitem').filter({ hasText: 'UBER TRIP' })).toBeFocused()
  await expect(block.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
})

test('goes to the item from Needs review, right up to its edge by the bank icon, and never from the icon', async ({ page, request }) => {
  const accounts = await start(page, request)
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-4')
  await answerReviewItems(page, () => pageOf(Array.from({ length: 6 }, (_, index) => index === 4
    ? reviewItem('item-4', 'removal', accounts.everyday.id, { description: 'UBER TRIP' })
    : reviewItem(`item-${index}`, 'new', accounts.everyday.id))))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const row = page.getByTestId(`transaction-row-${uberId}`)
  const needsReview = row.getByRole('button', { name: 'Needs review. Show the waiting item' })
  await expect(block.getByRole('listitem')).toHaveCount(4)

  // The icon opens its tooltip and leaves the block as it was
  await row.getByRole('button', { name: 'From SimpleFIN', exact: true }).click()
  const tooltip = row.getByText('From SimpleFIN', { exact: true }).filter({ visible: true })
  await expect.poll(() => tooltip.evaluate((node) => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }))).toBe(true)
  await expect(block.getByRole('button', { name: 'Show all 6' })).toHaveAttribute('aria-expanded', 'false')

  // The icon takes presses a few pixels around it, which stop short of Needs review beside it
  const { height } = (await needsReview.boundingBox())!
  await needsReview.click({ position: { x: 1, y: height / 2 } })
  await expect(block.getByRole('listitem').filter({ hasText: 'UBER TRIP' })).toBeFocused()
})

test("lets the block close after a marker whose item no page holds, once every page has loaded", async ({ page, request }) => {
  const accounts = await start(page, request)

  // Decided on another device since the ledger was read, so the complete list lacks it
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-decided')
  await answerReviewItems(page, () => pageOf(Array.from({ length: 6 }, (_, index) => reviewItem(`item-${index}`, 'new', accounts.everyday.id))))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const toggle = block.getByRole('button', { name: /^Show (fewer|all 6)$/ })
  await expect(block.getByRole('listitem')).toHaveCount(4)
  await showWaitingItem(page, uberId)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(block.getByRole('listitem')).toHaveCount(4)
})

test("stops going to a marker's item once the page it would be on fails to load", async ({ page, request }) => {
  const accounts = await start(page, request)
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-6')

  // The Uber removal would be the 7th item, on a second page that never loads
  let secondPageFailures = 0
  await answerReviewItems(page, (_, cursor) => {
    if (!cursor) {
      const items = Array.from({ length: 6 }, (_, index) => reviewItem(`item-${index}`, 'new', accounts.everyday.id))
      return { items, counts: { new: 6, correction: 0, removal: 1 }, next_cursor: 'page-1' }
    }
    secondPageFailures += 1
    return 500
  })

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const toggle = block.getByRole('button', { name: /^Show (fewer|all 7)$/ })
  await expect(block.getByRole('listitem')).toHaveCount(4)
  await showWaitingItem(page, uberId)
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')

  // The app tries a failed read twice. A search still under way opens the block again as soon as it
  // closes, so it is closed until the search has ended, which it must
  await expect.poll(() => secondPageFailures).toBeGreaterThanOrEqual(2)
  await expect(async () => {
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false', { timeout: 1000 })
  }).toPass({ timeout: 15_000 })
  await expect(block.getByRole('listitem')).toHaveCount(4)
})

test('says an account is paused for its backlog, or close to pausing', async ({ page, request }) => {
  const { everyday, savings, visa } = await start(page, request)
  const items = [reviewItem('everyday-1', 'new', everyday.id), reviewItem('savings-1', 'new', savings.id)]
  await answerReviewItems(page, (accountIds) =>
    pageOf(items.filter((item) => accountIds.length === 0 || accountIds.includes(item.account_id))))
  const backlogs = [
    { account_id: everyday.id, waiting_new_count: 105, paused: true, review_warning: false },
    { account_id: savings.id, waiting_new_count: 85, paused: false, review_warning: true },
    { account_id: visa.id, waiting_new_count: 0, paused: false, review_warning: false },
  ]
  await answerBacklogs(page, (accountIds) =>
    backlogs.filter((backlog) => accountIds.length === 0 || accountIds.includes(backlog.account_id)))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  await expect(block).toContainText('Paused · 105 new to review in Everyday. Sync resumes at 50 or fewer.')
  await expect(block).not.toContainText('Savings. Sync pauses')

  await filterTransactions(page, 'Accounts', 'Savings')
  await expect(block).toContainText('85 new to review in Savings. Sync pauses at 100.')
  await expect(block).not.toContainText('Paused')
})

test('refreshes when a linked account finishes a sync', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  let synced = false

  // Read every couple of seconds while it syncs, the sync ending with a later success
  await answerLinksWith(page, () => [everyday.id], () => ({
    last_success_at: synced ? `${SEP_21}T12:00:00Z` : `${SEP_21}T08:00:00Z`,
    sync_in_progress: !synced,
    waiting_new_count: synced ? 2 : 1,
  }))
  const items = [reviewItem('everyday-1', 'new', everyday.id), reviewItem('everyday-2', 'new', everyday.id)]
  await answerReviewItems(page, () => pageOf(synced ? items : items.slice(0, 1)))

  await openPage(page, '/transactions')

  const rows = reviewBlock(page).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  synced = true
  await expect(rows).toHaveCount(2)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`sits above the list and keeps its text readable in the ${colorScheme} theme`, async ({ page, request }) => {
    const { everyday, visa } = await start(page, request)
    const items = [
      reviewItem('visa-1', 'correction', visa.id, { description: 'COUNTDOWN 123 WITH A LONGER BANK DESCRIPTION THAN MOST', amount: -2310 }),
      reviewItem('everyday-1', 'new', everyday.id, { description: 'REFUND', amount: 4250 }),
      reviewItem('everyday-2', 'removal', everyday.id, { description: 'UBER TRIP' }),
      ...Array.from({ length: 3 }, (_, index) => reviewItem(`everyday-${index + 3}`, 'new', everyday.id)),
    ]
    await answerReviewItems(page, () => pageOf(items))
    await answerBacklogs(page, () => [{ account_id: everyday.id, waiting_new_count: 105, paused: true, review_warning: false }])
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })

    await openPage(page, '/transactions')

    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    const block = reviewBlock(page)
    const rows = block.getByRole('listitem')
    const toggle = block.getByRole('button', { name: 'Show all 6' })
    await expect(rows).toHaveCount(4)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Within the page and above the first transaction, with no sideways scroll at any width
    const firstTransaction = page.getByTestId(/^transaction-row-/).first()
    const [blockBox, transactionBox] = [await block.boundingBox(), await firstTransaction.boundingBox()]
    const viewportWidth = page.viewportSize()!.width
    expect(blockBox!.x).toBeGreaterThanOrEqual(0)
    expect(blockBox!.x + blockBox!.width).toBeLessThanOrEqual(viewportWidth)
    expect(blockBox!.y + blockBox!.height).toBeLessThanOrEqual(transactionBox!.y)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    // Each amount sits beside its text rather than over it, a long description wrapping instead
    for (const row of await rows.all()) {
      const [text, amount] = [await row.getByTestId('review-item-text').boundingBox(), await row.getByTestId('review-item-amount').boundingBox()]
      expect(amount!.x).toBeGreaterThanOrEqual(text!.x + text!.width)
      expect(amount!.x + amount!.width).toBeLessThanOrEqual(blockBox!.x + blockBox!.width)
    }
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(24)

    const texts = [
      block.getByRole('heading', { name: 'Waiting for review' }),
      block.getByText('6', { exact: true }),
      block.getByText('From your bank, and left out of every balance until you act on them.'),
      block.getByText('Paused · 105 new to review in Everyday. Sync resumes at 50 or fewer.'),
      rows.nth(0).getByText('COUNTDOWN 123 WITH A LONGER BANK DESCRIPTION THAN MOST'),
      rows.nth(0).getByText('Correction', { exact: true }),
      rows.nth(0).getByText('Sep 21 · Visa · The bank changed the amount'),
      rows.nth(0).getByText(`${MINUS}$23.10`),
      rows.nth(1).getByText('+$42.50'),
      rows.nth(2).getByText(`${MINUS}$18.00`),
      toggle,
    ]
    for (const text of texts) {
      expect(await contrastOf(text), await text.textContent() ?? '').toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
}
