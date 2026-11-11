import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  createAccount,
  createTransaction,
  daysFromTodayInTestTimezone,
  signUpUser,
  todayInTestTimezone,
  type SeededAccount,
  type TestUser,
} from '../support/api'
import { filterTransactions, logInViaApi, openPage, setTabHidden } from '../support/app'
import {
  addBridgeTransactions,
  answerAsBankImported,
  answerLinksWith,
  answerReviewItems,
  BANK_SOURCE,
  isRead,
  linkToEmptyBankAccount,
  pageOf,
  readLastSuccess,
  reviewBlock,
  reviewItem,
  runClockUntil,
  stopClock,
  syncBankLinkNow,
  waitForReviewItems,
  WORKER_RESULT_TIMEOUT_MS,
} from '../support/bankSync'
import { faintestText } from '../support/contrast'
import { MINUS, readBoxes } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the Needs review marker test and the light theme's readable text test.
// Those run at every size: the block's rows wrap and the list's bars pin differently at each width

// Bank items waiting for review show in a block above the transaction list, outside the ledger.
//
// A test answers the review list with the items it needs, such as removals, a backlog of 1,500 or a
// page that fails. A sync from the fake SimpleFIN Bridge can't bring those in. The one test that needs
// only new items links Everyday to the fake, and the worker imports and syncs its items. The backlogs are
// the server's own and read nothing waiting, unless a test answers them too. Answers are canned for
// the accounts a test expects the page to ask about, so which items, counts and backlogs the server
// picks for those accounts is left to the backend tests

type Backlog = { account_id: string; waiting_new_count: number; paused: boolean; review_warning: boolean }

type Accounts = { user: TestUser; everyday: SeededAccount; visa: SeededAccount; savings: SeededAccount }

/**
 * Whose reports are held back: any for something that started watching since `holdIntersections`, and
 * any for something already watching then
 */
type HeldReports = { fromNewWatcher: boolean; fromEarlierWatcher: boolean }

type IntersectionHold = { holdIntersections: () => void; readHeld: () => HeldReports; releaseIntersections: () => void }

// Past the second the block waits, with the end of the list near, before it loads the next page
const LOAD_WAIT_PASSED_MS = 1_500

/** Answers the backlogs with what `answer` returns for the accounts asked for, all accounts being none */
async function answerBacklogs(page: Page, answer: (accountIds: string[]) => Backlog[]): Promise<void> {
  await page.route(isRead('/bank-review/backlogs'), (route) =>
    route.fulfill({ json: answer(new URL(route.request().url()).searchParams.getAll('account_id')) }))
}

/**
 * Holds reads that wait on it while closed, so a test can look at a read in flight, and lets them
 * through once opened. Open until first closed
 */
function readGate(): { close: () => void; open: () => void; passed: () => Promise<void> } {
  let gate = Promise.resolve()
  let open = () => {}
  return {
    close: () => {
      gate = new Promise<void>((resolve) => { open = resolve })
    },
    open: () => open(),
    passed: () => gate,
  }
}

/** Answers the review list with 1,500 new items on the account, 50 to a page */
async function answerLongBacklog(page: Page, accountId: string): Promise<void> {
  await answerReviewItems(page, (_, cursor) => {
    const index = cursor ? Number(cursor.replace('page-', '')) : 0
    return {
      items: Array.from({ length: 50 }, (_, offset) => reviewItem(`item-${index * 50 + offset}`, 'new', accountId)),
      counts: { new: 1500, correction: 0, removal: 0 },
      next_cursor: index < 29 ? `page-${index + 1}` : null,
    }
  })
}

/**
 * Lets the reports the page gets of what has come near the screen be held back from `holdIntersections`
 * on, as a page too busy to be laid out again gets none, until `releaseIntersections` sends them. Chrome
 * sends the reports of one layout to the watchers of an element in no set order, so they are sent the
 * newest watcher's first, each watcher's in the order they were made. Only what watches from now on is
 * held, and a report for something that has stopped watching meanwhile is dropped, as Chrome drops it
 */
async function holdableIntersections(page: Page): Promise<void> {
  await page.evaluate(() => {
    const Native = window.IntersectionObserver
    let held: { watcher: number; report: () => void }[] | null = null
    let watchers = 0
    let firstNewWatcher = 0
    window.IntersectionObserver = class extends Native {
      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        const watcher = watchers++
        let watching = true
        super((entries, observer) => {
          const report = () => {
            if (watching) callback(entries, observer)
          }
          if (held) held.push({ watcher, report })
          else report()
        }, options)
        const disconnect = this.disconnect.bind(this)
        this.disconnect = () => {
          watching = false
          disconnect()
        }
      }
    }
    const hold: IntersectionHold = {
      holdIntersections: () => {
        held = []
        firstNewWatcher = watchers
      },
      readHeld: () => ({
        fromNewWatcher: (held ?? []).some(({ watcher }) => watcher >= firstNewWatcher),
        fromEarlierWatcher: (held ?? []).some(({ watcher }) => watcher < firstNewWatcher),
      }),
      releaseIntersections: () => {
        const reports = held ?? []
        held = null
        for (const { report } of reports.sort((first, second) => second.watcher - first.watcher)) report()
      },
    }
    Object.assign(window, hold)
  })
}

/** Holds back the reports `holdableIntersections` can hold */
async function holdIntersections(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as IntersectionHold).holdIntersections())
}

/** Whose reports have been held back since `holdIntersections` */
async function readHeld(page: Page): Promise<HeldReports> {
  return page.evaluate(() => (window as unknown as IntersectionHold).readHeld())
}

/** Sends the reports held back since `holdIntersections`, and lets later ones through */
async function releaseIntersections(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as IntersectionHold).releaseIntersections())
}

/**
 * Waits for the block to finish growing in. It does that on the page's clock once its items have
 * loaded, on a busy machine well after the page is ready. A clock stopped part way holds the block cut
 * short, with Show all and the end of the list in the part cut off. Read from what holds the block.
 * That holder cuts part of the block off from the moment it shows until the growth ends, since the height runs from
 * script and leaves the browser no animation to wait on
 */
async function waitForBlockToGrowIn(block: Locator): Promise<void> {
  await expect.poll(() => block.evaluate((section) => {
    for (let holder = section.parentElement; holder; holder = holder.parentElement) {
      if (getComputedStyle(holder).overflowY === 'hidden' && holder.scrollHeight > holder.clientHeight) return false
    }
    return true
  })).toBe(true)
}

/** Signs up with Everyday, a Visa card and Savings, Everyday holding a $42.50 grocery spend today */
async function start(page: Page, request: APIRequestContext): Promise<Accounts> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const visa = await createAccount(request, user, { name: 'Visa', accountKind: 'revolving', accountType: 'credit_card' })
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  await createTransaction(request, user, { accountId: everyday.id, categoryName: 'Groceries', amount: -4250 })
  // Only a linked account has bank items, so all three are linked
  await answerLinksWith(page, () => [everyday.id, visa.id, savings.id])
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

/**
 * Syncs the account now with the page's tab in the background, and brings the tab back once the worker
 * has ended the sync, so the page reads the link list as it comes back and finds the sync over
 */
async function syncWithTabHidden(page: Page, request: APIRequestContext, user: TestUser, accountId: string): Promise<void> {
  const before = await readLastSuccess(request, user, accountId)
  await setTabHidden(page, true)
  await syncBankLinkNow(request, user, accountId)
  await expect.poll(() => readLastSuccess(request, user, accountId), { timeout: WORKER_RESULT_TIMEOUT_MS }).not.toBe(before)
  await setTabHidden(page, false)
}

/** Follows a ledger row's Needs review marker to its waiting item */
async function showWaitingItem(page: Page, transactionId: string): Promise<void> {
  await page.getByTestId(`transaction-row-${transactionId}`).getByRole('button', { name: 'Needs review. Show the waiting item' }).click()
}

test('shows each kind of item for the accounts the list shows, and only its own on an account page', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday, visa, savings } = await start(page, request)
  const correction = reviewItem('visa-1', 'correction', visa.id, { description: 'COUNTDOWN 123', amount: -2310 })
  const answers = new Map([
    ['', pageOf([
      correction,
      reviewItem('everyday-1', 'new', everyday.id, { description: 'HARBOUR COFFEE' }),
      reviewItem('everyday-2', 'removal', everyday.id, { description: 'UBER TRIP' }),
    ], { new: 1, correction: 1, removal: 1 })],
    [visa.id, pageOf([correction], { correction: 1 })],
    [savings.id, pageOf([])],
  ])
  const asked: string[][] = []
  await answerReviewItems(page, (accountIds) => {
    asked.push(accountIds)
    return answers.get(accountIds.join()) ?? pageOf([])
  })

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const rows = block.getByRole('listitem')
  await expect(block.getByText('3', { exact: true })).toBeVisible()
  await expect(block).toContainText('Bank items stay out of every balance until you add them to your ledger.')
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

test('says in the block that the waiting items could not load, sends Needs review there, and reads only them again', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const accounts = await start(page, request)
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-0')
  const reads = { items: 0, backlogs: 0 }
  let itemsFail = true
  const gate = readGate()
  await page.route(isRead('/bank-review/items'), async (route) => {
    reads.items += 1
    await gate.passed()
    return itemsFail
      ? route.fulfill({ status: 500, json: { detail: 'Something went wrong' } })
      : route.fulfill({ json: pageOf([reviewItem('item-0', 'removal', accounts.everyday.id, { description: 'UBER TRIP' })], { removal: 1 }) })
  })
  await answerBacklogs(page, () => {
    reads.backlogs += 1
    return []
  })

  await openPage(page, '/transactions')

  // Said inside the block's frame. The frame counts nothing while the items are unknown
  const block = reviewBlock(page)
  const failure = block.getByRole('alert').filter({ hasText: 'Bank items to review could not load.' })
  const retry = failure.getByRole('button', { name: 'Try again' })
  await expect(failure).toBeVisible()
  await expect(block.getByRole('listitem')).toHaveCount(0)
  expect((await faintestText(failure.getByText('Bank items to review could not load.'))).contrast).toBeGreaterThanOrEqual(4.5)
  expect((await faintestText(retry)).contrast).toBeGreaterThanOrEqual(4.5)

  // A Needs review marker goes to the failure rather than nowhere, ready to try again
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await showWaitingItem(page, uberId)
  await expect(retry).toBeFocused()
  await expect(failure).toBeInViewport()

  // While the read is made again the strip holds its place, its button saying so and keeping focus,
  // and a read that fails again leaves it ready to try once more
  await page.evaluate(() => Object.assign(window, { notReloaded: true }))
  const backlogReads = reads.backlogs
  const button = failure.getByRole('button')
  gate.close()
  await page.keyboard.press('Enter')
  await expect(button).toHaveText('Retrying…')
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await expect(button).toBeFocused()
  gate.open()
  await expect(button).toHaveText('Try again')
  await expect(button).toBeFocused()

  // Trying again from there reads the items alone, without reloading the page, and focus goes on to
  // the first row rather than falling to the top of the page with the retry
  itemsFail = false
  await page.keyboard.press('Enter')
  await expect(block.getByRole('listitem').filter({ hasText: 'UBER TRIP' })).toBeFocused()
  await expect(failure).toBeHidden()
  await expect(block.getByText('1', { exact: true })).toBeVisible()
  expect(reads.backlogs).toBe(backlogReads)
  expect(await page.evaluate(() => 'notReloaded' in window)).toBe(true)
})

test('says the pause status could not load while still showing the items, and reads only it again', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const reads = { items: 0, backlogs: 0 }
  let backlogsFail = true
  const gate = readGate()
  await answerReviewItems(page, () => {
    reads.items += 1
    return pageOf([reviewItem('everyday-1', 'new', everyday.id)], { new: 1 })
  })
  await page.route(isRead('/bank-review/backlogs'), async (route) => {
    reads.backlogs += 1
    await gate.passed()
    return backlogsFail
      ? route.fulfill({ status: 500, json: { detail: 'Something went wrong' } })
      : route.fulfill({ json: [{ account_id: everyday.id, waiting_new_count: 105, paused: true, review_warning: false }] })
  })

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const failure = block.getByRole('alert').filter({ hasText: 'Sync pause status could not load.' })
  await expect(failure).toBeVisible()
  await expect(block.getByRole('listitem')).toHaveCount(1)

  // Held in place while the read is made again, then giving way to the notice. The notice takes focus
  const itemReads = reads.items
  const button = failure.getByRole('button')
  backlogsFail = false
  gate.close()
  await button.click()
  await expect(button).toHaveText('Retrying…')
  await expect(button).toBeFocused()
  gate.open()
  await expect(page.locator(':focus')).toHaveText('Paused · 105 new to review in Everyday. Sync resumes at 50 or fewer.')
  await expect(failure).toBeHidden()
  await expect(block.getByRole('listitem')).toHaveCount(1)
  expect(reads.items).toBe(itemReads)
})

test('moves focus on from a retry that succeeds only while the retry has it, to the title when the pause status has nothing to say', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday } = await start(page, request)
  let readsFail = true
  const gate = readGate()
  await page.route(isRead('/bank-review/items'), async (route) => {
    await gate.passed()
    return readsFail
      ? route.fulfill({ status: 500, json: { detail: 'Something went wrong' } })
      : route.fulfill({ json: pageOf([reviewItem('everyday-1', 'new', everyday.id)], { new: 1 }) })
  })
  await page.route(isRead('/bank-review/backlogs'), (route) => readsFail
    ? route.fulfill({ status: 500, json: { detail: 'Something went wrong' } })
    : route.fulfill({ json: [] }))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const backlogFailure = block.getByRole('alert').filter({ hasText: 'Sync pause status could not load.' })
  const itemsFailure = block.getByRole('alert').filter({ hasText: 'Bank items to review could not load.' })
  await expect(backlogFailure).toBeVisible()
  await expect(itemsFailure).toBeVisible()
  readsFail = false

  // A pause status with nothing to say leaves no notice, so focus goes to the block's title
  await backlogFailure.getByRole('button', { name: 'Try again' }).click()
  await expect(backlogFailure).toBeHidden()
  await expect(block.getByRole('heading', { name: 'Waiting for review' })).toBeFocused()

  // Focus that has moved on from the retry by the time the items load is left where it went
  const itemsRetry = itemsFailure.getByRole('button')
  gate.close()
  await itemsRetry.click()
  await expect(itemsRetry).toHaveText('Retrying…')
  await page.keyboard.press('Tab')
  await expect(itemsRetry).not.toBeFocused()
  await page.evaluate(() => document.activeElement?.setAttribute('data-focus-went-here', ''))
  gate.open()
  await expect(block.getByRole('listitem')).toHaveCount(1)

  // The failure leaves the page in a render after the one that brought the rows. React starts that render
  // only once it has run what came with them, any move of focus included
  await expect(itemsFailure).not.toBeAttached()
  await expect(block.getByRole('listitem')).not.toBeFocused()
  expect(await page.evaluate(() => document.activeElement?.hasAttribute('data-focus-went-here') ?? false)).toBe(true)
})

test('shows the first 4 of a 1,500 item backlog, and loads the rest a page at a time once opened', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday } = await start(page, request)
  await answerLongBacklog(page, everyday.id)

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

  // The toggle sits in the header above the first row, so closing a list 1,500 long never means
  // scrolling to its end. The keyboard closes it from there, and focus stays on it as its name changes
  const showFewer = block.getByRole('button', { name: 'Show fewer' })
  const [toggleBox, firstRowBox] = await readBoxes(page, [showFewer, rows.first()])
  expect(toggleBox.y + toggleBox.height).toBeLessThanOrEqual(firstRowBox.y)
  await showFewer.focus()
  await page.keyboard.press('Enter')
  await expect(rows).toHaveCount(4)
  await expect(loading).toBeHidden()
  await expect(block.getByRole('button', { name: 'Show all 1,500' })).toBeFocused()
})

// The rows Show all adds grow in from nothing, so the end of the list is near for a moment and the
// block starts its wait to load the next page. A busy page can reach the end of that wait before it is
// laid out again with the rows grown. The page's clock stops before Show all, once the block itself
// has grown in, so the rows stay folded until it moves on, and word of where the end of the list has
// gone is held back while the wait runs out, then reaches the block's last look before the watch that
// started the wait hears of it. Motion isn't reduced, as it is for other tests on the page's clock,
// since reduced motion shows the rows at full height at once and leaves the end of the list nowhere
// near, and nothing here has to fade out. A fade is what the page's clock would hold up
test('loads no more of a 1,500 item backlog when the end of the list has moved away by the end of the wait, however late word of it comes', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday } = await start(page, request)
  await answerLongBacklog(page, everyday.id)
  const cursors: (string | null)[] = []
  await page.route(isRead('/bank-review/items'), async (route) => {
    cursors.push(new URL(route.request().url()).searchParams.get('cursor'))
    await route.fallback()
  })
  await page.clock.install()
  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const rows = block.getByRole('listitem')
  await expect(rows).toHaveCount(4)
  await holdableIntersections(page)
  await waitForBlockToGrowIn(block)
  await stopClock(page)

  await block.getByRole('button', { name: 'Show all 1,500' }).click()
  const loading = block.getByRole('status')
  await expect(loading).toHaveText('Loading more items…')

  // The block's last look at the end of the list is taken as the wait runs out and is answered as
  // the page is next laid out, held back with the rest. Both are held, so the order they come in is
  // the one released: the last look's, then the watch's that started the wait. That watch heard of the
  // rows growing as the clock moved on
  await holdIntersections(page)
  await page.clock.runFor(LOAD_WAIT_PASSED_MS)
  await expect.poll(() => readHeld(page)).toEqual({ fromNewWatcher: true, fromEarlierWatcher: true })
  await releaseIntersections(page)
  await runClockUntil(page, async () => !(await loading.isVisible()))
  await expect(rows).toHaveCount(50)
  expect(cursors).toEqual([null])
})

test('closes once four or fewer items wait, so it shows only the first four when more come back', NEEDS_BANK_SYNC, async ({ page, request }) => {
  // Six new items from the bank, a day apart, imported by the worker
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const grocer = (day: number) => ({ posted: daysFromTodayInTestTimezone(-day), amount: '-12.50', description: `GROCER ${day}` })
  const { scenario, externalAccountId } = await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [1, 2, 3, 4, 5, 6].map(grocer),
  })
  const items = await waitForReviewItems(request, user, everyday.id, (waiting) => waiting.length === 6)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const rows = block.getByRole('listitem')
  await block.getByRole('button', { name: 'Show all 6' }).click()
  await expect(rows).toHaveCount(6)

  // Two decided on another device leave 4, the most a closed block shows, read once a sync has ended
  for (const item of items.slice(4)) {
    const dismissed = await request.post(`${API_BASE_URL}/bank-review/items/${item.id}/dismiss`, { headers: asUser(user) })
    expect(dismissed.status()).toBe(204)
  }
  await syncWithTabHidden(page, request, user, everyday.id)
  await expect(block.getByRole('button', { name: /^Show / })).toBeHidden()
  await expect(rows).toHaveCount(4)

  // Two more arriving bring back the first four of the 6
  await addBridgeTransactions(request, scenario.id, externalAccountId, [7, 8].map(grocer))
  await syncWithTabHidden(page, request, user, everyday.id)
  await expect(block.getByRole('button', { name: 'Show all 6' })).toHaveAttribute('aria-expanded', 'false')
  await expect(rows).toHaveCount(4)
})

test("goes from a ledger row's Needs review marker to its item, loading the page it's on", AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
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
  const ring = item.getByTestId('review-item-ring')
  await expect(ring).toHaveCSS('box-shadow', /inset/)
  await expect(item).toBeFocused()
  await expect(item).toBeInViewport()
  expect(cursors).toEqual([null, 'page-1'])
  await expect(item.getByText(`${MINUS}$18.00`)).toHaveCSS('text-decoration-line', 'line-through')

  // The ring stays clear of the card's edges and of the text it frames
  const [blockBox, ringBox, textBox, amountBox] = await Promise.all(
    [block, ring, item.getByTestId('review-item-name'), item.getByTestId('review-item-amount')].map(async (part) => (await part.boundingBox())!),
  )
  expect(ringBox.x).toBeGreaterThanOrEqual(blockBox.x + 8)
  expect(ringBox.x + ringBox.width).toBeLessThanOrEqual(blockBox.x + blockBox.width - 8)
  expect(textBox.x).toBeGreaterThanOrEqual(ringBox.x + 4)
  expect(amountBox.x + amountBox.width).toBeLessThanOrEqual(ringBox.x + ringBox.width - 4)
  await expect(ring).toHaveCSS('box-shadow', 'none')
})

test('opens the block for a marker whose item is the fifth, the first one it hides, from Needs review and not from the bank icon before it', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const accounts = await start(page, request)
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-4')
  await answerReviewItems(page, () => pageOf(Array.from({ length: 6 }, (_, index) => index === 4
    ? reviewItem('item-4', 'removal', accounts.everyday.id, { description: 'UBER TRIP' })
    : reviewItem(`item-${index}`, 'new', accounts.everyday.id)), { new: 5, removal: 1 }))

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  const row = page.getByTestId(`transaction-row-${uberId}`)
  await expect(block.getByRole('listitem')).toHaveCount(4)

  // The bank icon opens its tooltip and leaves the block as it was
  const icon = row.getByRole('button', { name: 'From SimpleFIN', exact: true })
  await icon.click()
  const tooltip = row.getByText('From SimpleFIN', { exact: true }).filter({ visible: true })
  await expect.poll(() => tooltip.evaluate((node) => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }))).toBe(true)
  await expect(icon).toBeFocused()
  await expect(block.getByRole('button', { name: 'Show all 6' })).toHaveAttribute('aria-expanded', 'false')
  await expect(block.getByRole('listitem')).toHaveCount(4)

  // The keyboard goes on from the icon to Needs review, and that goes to the item
  await page.keyboard.press('Tab')
  await expect(row.getByRole('button', { name: 'Needs review. Show the waiting item' })).toBeFocused()
  await page.keyboard.press('Enter')

  await expect(block.getByRole('listitem').filter({ hasText: 'UBER TRIP' })).toBeFocused()
  await expect(block.getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true')
})

test("lets the block close after a marker whose item no page holds, once every page has loaded", NEEDS_BANK_SYNC, async ({ page, request }) => {
  const accounts = await start(page, request)

  // Decided on another device since the ledger was read, so the complete list lacks it
  const uberId = await addUberTripAwaiting(page, request, accounts, 'item-decided')
  await answerReviewItems(page, () => pageOf(Array.from({ length: 6 }, (_, index) => reviewItem(`item-${index}`, 'new', accounts.everyday.id)), { new: 6 }))

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

test("stops going to a marker's item once the page it would be on fails to load", NEEDS_BANK_SYNC, async ({ page, request }) => {
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
  // closes, so it is closed once the search has ended, as it must be
  await expect(block).toHaveAttribute('data-going-to-item', 'false')
  await expect.poll(() => secondPageFailures).toBeGreaterThanOrEqual(2)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(block.getByRole('listitem')).toHaveCount(4)
})

test('says an account is paused for its backlog, or close to pausing', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { everyday, savings, visa } = await start(page, request)
  const savingsItem = reviewItem('savings-1', 'new', savings.id)
  const items = new Map([
    ['', pageOf([reviewItem('everyday-1', 'new', everyday.id), savingsItem], { new: 2 })],
    [savings.id, pageOf([savingsItem], { new: 1 })],
  ])
  await answerReviewItems(page, (accountIds) => items.get(accountIds.join()) ?? pageOf([]))
  const savingsBacklog = { account_id: savings.id, waiting_new_count: 85, paused: false, review_warning: true }
  const backlogs = new Map([
    ['', [
      { account_id: everyday.id, waiting_new_count: 105, paused: true, review_warning: false },
      savingsBacklog,
      { account_id: visa.id, waiting_new_count: 0, paused: false, review_warning: false },
    ]],
    [savings.id, [savingsBacklog]],
  ])
  await answerBacklogs(page, (accountIds) => backlogs.get(accountIds.join()) ?? [])

  await openPage(page, '/transactions')

  const block = reviewBlock(page)
  await expect(block).toContainText('Paused · 105 new to review in Everyday. Sync resumes at 50 or fewer.')
  await expect(block).not.toContainText('Savings. Sync pauses')

  await filterTransactions(page, 'Accounts', 'Savings')
  await expect(block).toContainText('85 new to review in Savings. Sync pauses at 100.')
  await expect(block).not.toContainText('Paused')
})

for (const colorScheme of ['light', 'dark'] as const) {
  // Only the light run places the block, so only it runs at every size
  test(`${colorScheme === 'light' ? 'sits above the list and keeps' : 'keeps'} its text readable in the ${colorScheme} theme`, colorScheme === 'light' ? AT_EVERY_SIZE_NEEDS_BANK_SYNC : NEEDS_BANK_SYNC, async ({ page, request }) => {
    const { everyday, visa } = await start(page, request)
    const items = [
      reviewItem('visa-1', 'correction', visa.id, { description: 'COUNTDOWN 123 WITH A LONGER BANK DESCRIPTION THAN MOST', amount: -2310 }),
      reviewItem('everyday-1', 'new', everyday.id, { description: 'REFUND', amount: 4250 }),
      reviewItem('everyday-2', 'removal', everyday.id, { description: 'UBER TRIP' }),
      ...Array.from({ length: 3 }, (_, index) => reviewItem(`everyday-${index + 3}`, 'new', everyday.id)),
    ]
    await answerReviewItems(page, () => pageOf(items, { new: 4, correction: 1, removal: 1 }))
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

    // The layout is the same in either theme, so it is measured in the light one only
    if (colorScheme === 'light') {
      // Within the page and above the first transaction, with no sideways scroll at any width. The two
      // are measured together, since the page can still be settling above them
      const firstTransaction = page.getByTestId(/^transaction-row-/).first()
      const [blockBox, transactionBox] = await readBoxes(page, [block, firstTransaction])
      const viewportWidth = page.viewportSize()!.width
      expect(blockBox.x).toBeGreaterThanOrEqual(0)
      expect(blockBox.x + blockBox.width).toBeLessThanOrEqual(viewportWidth)
      expect(blockBox.y + blockBox.height).toBeLessThanOrEqual(transactionBox.y)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

      // Each name runs the row's width, its label beside it, and each amount sits below the name and
      // beside the details rather than over either, a long description wrapping instead
      for (const row of await rows.all()) {
        const [name, details, amount] = await Promise.all(
          ['review-item-name', 'review-item-details', 'review-item-amount'].map(async (id) => (await row.getByTestId(id).boundingBox())!),
        )
        expect(amount.y).toBeGreaterThanOrEqual(name.y + name.height)
        expect(amount.x).toBeGreaterThanOrEqual(details.x + details.width)
        expect(amount.x + amount.width).toBeLessThanOrEqual(blockBox.x + blockBox.width)
      }
      // The caret ends the header's first row, a button at least 24px each way with no words to read
      const toggleBox = (await toggle.boundingBox())!
      expect(Math.min(toggleBox.width, toggleBox.height)).toBeGreaterThanOrEqual(24)
    }


    const texts = [
      block.getByRole('heading', { name: 'Waiting for review' }),
      block.getByText('6', { exact: true }),
      block.getByText('Bank items stay out of every balance until you add them to your ledger.'),
      block.getByText('Paused · 105 new to review in Everyday. Sync resumes at 50 or fewer.'),
      rows.nth(0).getByText('COUNTDOWN 123 WITH A LONGER BANK DESCRIPTION THAN MOST'),
      rows.nth(0).getByText('Correction', { exact: true }),
      rows.nth(0).getByText('Sep 21 · Visa · The bank changed the amount'),
      rows.nth(0).getByText(`${MINUS}$23.10`),
      rows.nth(1).getByText('+$42.50'),
      rows.nth(2).getByText(`${MINUS}$18.00`),
    ]
    for (const text of texts) {
      expect((await faintestText(text)).contrast, await text.textContent() ?? '').toBeGreaterThanOrEqual(4.5)
    }
  })
}
