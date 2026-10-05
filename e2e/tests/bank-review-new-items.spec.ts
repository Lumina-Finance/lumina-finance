import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  createAccount,
  createGroup,
  signUpUser,
  TEST_CURRENCY,
  type SeededAccount,
  type TestUser,
} from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import {
  answerLinksWith,
  answerReviewItems,
  pageOf,
  reviewBlock,
  reviewItem,
  SEP_21,
  type BankValues,
  type ReviewItem,
} from '../support/bankSync'
import { contrastOf, expectTransactionRow, MIN_TEXT_CONTRAST, MINUS } from '../support/selectors'
import { API_BASE_URL } from '../support/target'

// A new bank item opens from its row in the review block in the transaction modal, which files it
// into the ledger or dismisses it.
//
// Nothing links an account on the server for a sync to bring items in, so each test answers the review
// list with the items it needs and settles each decision itself. Add to ledger goes on to the server as
// the manual create the item's account and currency make it, so the ledger shows a real transaction.
// The link list isn't served yet, so it is answered with a link for Everyday, which also puts the days
// its bank supplies off limits to a manual entry

type Accounts = { user: TestUser; everyday: SeededAccount; savings: SeededAccount }

/** A decision sent on an item, with what it carried */
type Decision = { itemId: string; action: string; body: Record<string, unknown> | null }

/** How the next decision fails: a status the server answers with, or no answer at all */
type Refusal = { status: number; detail: string } | 'network' | null

/**
 * The items still waiting, every decision sent on them, and the transactions added, with what holds
 * every page after the first until it settles
 */
type Review = { waiting: ReviewItem[]; decisions: Decision[]; created: string[]; refusal: Refusal; laterPages: Promise<unknown> }

const DIALOG_NAME = 'Review bank item'

// Where the modal has room for the card beside it, and below which it takes the whole screen
const ASIDE_MIN_WIDTH = 1320
const FULL_SCREEN_BELOW = 1050

// Signed up and linked fresh for every test, which keeps every account here
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/** Signs up with Everyday, linked to Chequing at Example Bank, and Savings */
async function start(page: Page, request: APIRequestContext): Promise<Accounts> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  await answerLinksWith(page, () => [everyday.id])
  await logInViaApi(page, user)
  return { user, everyday, savings }
}

/** The bank's $42.10 grocery spend on Sep 21, sent with no merchant or category */
function countdown(accountId: string, bank: Partial<BankValues> = {}): ReviewItem {
  return reviewItem('countdown', 'new', accountId, { description: 'COUNTDOWN 123 AUCKLAND', amount: -4210, ...bank })
}

/**
 * Answers the review list with what is still waiting, `perPage` items to a page, and settles each
 * decision on an item the way the server would, refusing it instead while `refusal` says how. Dismiss
 * takes the item off the list, and Add to ledger creates its transaction through the manual create
 * before taking it off
 *
 * A page's cursor is the last item it held, so the next page starts after that item even once it has
 * been decided
 */
async function answerReview(page: Page, items: ReviewItem[], perPage = items.length): Promise<Review> {
  const review: Review = { waiting: [...items], decisions: [], created: [], refusal: null, laterPages: Promise.resolve() }
  await answerReviewItems(page, async (_, cursor) => {
    if (cursor !== null) await review.laterPages
    const rest = items.slice(items.findIndex((item) => item.id === cursor) + 1).filter((item) => review.waiting.includes(item))
    const shown = rest.slice(0, perPage)
    return { ...pageOf(review.waiting), items: shown, next_cursor: rest.length > perPage ? shown[perPage - 1].id : null }
  })
  await page.route((url) => url.href.startsWith(`${API_BASE_URL}/bank-review/items/`), async (route) => {
    const request = route.request()
    const [, itemId, action] = /\/bank-review\/items\/([^/]+)\/([a-z-]+)$/.exec(new URL(request.url()).pathname) ?? []
    const item = review.waiting.find((waiting) => waiting.id === itemId)
    if (request.method() !== 'POST' || !item) return route.fulfill({ status: 404, json: { detail: 'Review item not found' } })

    const body = request.postDataJSON() as Record<string, unknown> | null
    review.decisions.push({ itemId, action, body })
    if (review.refusal === 'network') return route.abort()
    if (review.refusal) return route.fulfill({ status: review.refusal.status, json: { detail: review.refusal.detail } })

    const settle = () => { review.waiting = review.waiting.filter((waiting) => waiting !== item) }
    if (action === 'dismiss') {
      settle()
      return route.fulfill({ status: 204 })
    }

    // Retried, since the instance now and then drops a reused connection, which the browser would retry
    const response = await route.fetch({
      url: `${API_BASE_URL}/transactions`,
      postData: { ...body, account_id: item.account_id, currency: TEST_CURRENCY },
      maxRetries: 2,
    })
    if (response.ok()) {
      review.created.push(((await response.json()) as { id: string }).id)
      settle()
    }
    return route.fulfill({ response })
  })
  return review
}

/** Opens a new item from its row in the review block, and answers with the review dialog */
async function openReview(page: Page, description: string): Promise<Locator> {
  await reviewBlock(page).getByRole('button', { name: description }).click()
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The filing card shown for the item under review, beside the dialog or inside it */
function filingCard(page: Page): Locator {
  return page.getByRole('region', { name: 'SimpleFIN filing card' })
}

/** Each labelled line of a filing card as [label, value], in order */
async function fieldsOf(card: Locator): Promise<[string, string][]> {
  const [labels, values] = await Promise.all([card.locator('dt').allTextContents(), card.locator('dd').allTextContents()])
  return labels.map((label, index) => [label, values[index]])
}

/**
 * The count beside the review block's heading behind an open dialog, which takes the page out of the
 * accessibility tree, so the heading is found by its text rather than its role
 */
function countBehindDialog(page: Page): Locator {
  return page.getByText('Waiting for review', { exact: true }).locator('xpath=following-sibling::span')
}

/** The form's fields a review fills in or leaves to the user */
function formOf(dialog: Locator) {
  const date = dialog.getByRole('group', { name: 'Date' })
  return {
    account: dialog.getByTestId('transaction-account'),
    amount: dialog.getByRole('textbox', { name: 'Amount', exact: true }),
    year: date.getByRole('textbox', { name: 'Year' }),
    month: date.getByRole('textbox', { name: 'Month' }),
    day: date.getByRole('textbox', { name: 'Day' }),
    merchant: dialog.getByRole('combobox', { name: 'Merchant' }),
    category: dialog.getByRole('combobox', { name: 'Category' }),
    keepOpen: dialog.getByRole('checkbox', { name: /Keep window open/ }),
    add: dialog.getByRole('button', { name: 'Add to ledger', exact: true }),
    notes: dialog.getByRole('textbox', { name: 'Notes', exact: true }),
    dismiss: dialog.getByRole('button', { name: 'Dismiss', exact: true }),
  }
}

/** Asserts the merchant and category are still to be chosen, and not yet marked as missing */
async function expectMerchantAndCategoryEmpty(dialog: Locator): Promise<void> {
  const { merchant, category } = formOf(dialog)
  await expect(merchant).toContainText('Select or type to create...')
  await expect(category).toContainText('Select category...')
  await expect(merchant).not.toHaveAttribute('aria-invalid', 'true')
  await expect(category).not.toHaveAttribute('aria-invalid', 'true')
}

test('opens a new item as the bank sent it beside its filing card, and adds nothing until a merchant and category are chosen', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const review = await answerReview(page, [countdown(everyday.id)])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
  const form = formOf(dialog)
  await expect(dialog.getByText('New from SimpleFIN', { exact: true })).toBeVisible()

  // An expense, since the money went out, for the bank's amount on its date in the account it came to,
  // which stays put
  await expect(dialog.getByRole('tab', { name: 'Expense', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(form.amount).toHaveValue('42.10')
  await expect(form.year).toHaveValue(SEP_21.slice(0, 4))
  await expect(form.month).toHaveValue('09')
  await expect(form.day).toHaveValue('21')
  await expect(form.account).toContainText('Everyday')
  await expect(form.account).toHaveAttribute('aria-disabled', 'true')
  await expect(form.account).toHaveAccessibleDescription(/A bank item stays in the account whose bank sent it/)
  await expectMerchantAndCategoryEmpty(dialog)

  // Closing leaves the item waiting, so the header's Close is the only way out besides a decision
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  await expect(form.keepOpen).not.toBeChecked()

  const card = filingCard(page)
  await expect(card).toContainText('Example Bank')
  await expect(card).toContainText('New')
  await expect(card).toContainText('Chequing')
  await expect(card).toContainText('Description from SimpleFIN')
  await expect(card).toContainText('COUNTDOWN 123 AUCKLAND')
  const fields = await fieldsOf(card)
  expect(fields).toEqual([
    ['Amount', `${MINUS}$42.10`],
    ['Date', `Sep 21, ${SEP_21.slice(0, 4)}`],
    ['Merchant', '—'],
    ['Category', '—'],
    ['Received', expect.stringMatching(/^Sep 21, 8:00\sa\.m\.$/u)],
    ['Ref', 'TRN-countdown'],
  ])

  // The bank's description starts the notes, which the user may change
  await expect(form.notes).toHaveValue(COUNTDOWN.description)

  await form.add.click()
  await expect(form.merchant).toHaveAttribute('aria-invalid', 'true')
  await expect(form.category).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByText('Select or create a merchant', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Select a category', { exact: true })).toBeVisible()
  expect(review.decisions).toEqual([])
  await expect(dialog).toBeVisible()
})

test('adds an item with its amount changed, and with the window kept open goes on through the new items until none are left', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const review = await answerReview(page, [
    countdown(everyday.id),
    reviewItem('uber', 'correction', everyday.id, { description: 'UBER TRIP' }),
    reviewItem('harbour', 'new', everyday.id, { description: 'HARBOUR COFFEE' }),
  ])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
  const form = formOf(dialog)
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await form.amount.fill('40.00')
  await form.keepOpen.check()

  // Sep 21 is a day Everyday's bank supplies, which a manual entry may not take, and a review may
  await form.add.click()

  // The next new item, past the correction between them, in a fresh form with the window still open
  await expect(filingCard(page)).toContainText('HARBOUR COFFEE')
  await expect(form.amount).toHaveValue('12.50')
  await expectMerchantAndCategoryEmpty(dialog)
  await expect(form.keepOpen).toBeChecked()
  expect(review.decisions).toEqual([{ itemId: 'countdown', action: 'add', body: expect.objectContaining({ amount: -4000 }) }])
  expect(review.created).toHaveLength(1)
  await expect(countBehindDialog(page)).toHaveText('2')
  await expect(page.getByTestId(`transaction-row-${review.created[0]}`)).toBeVisible()

  // Nothing new is left after it, the correction being reviewed elsewhere, so the window closes
  await form.dismiss.click()
  await expect(dialog).toBeHidden()
  const rows = reviewBlock(page).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('UBER TRIP')
  await expectTransactionRow(page, review.created[0], `${MINUS}$40.00`)
})

test('records money in from Savings as one transfer that names Savings, kept as money in, and closes with the window not kept open', async ({ page, request }) => {
  const { user, everyday, savings } = await start(page, request)
  await createAccount(request, user, { name: 'Household', groupId: await createGroup(request, user, 'Family') })
  const review = await answerReview(page, [
    reviewItem('savings', 'new', everyday.id, { description: 'TFR FROM SAVINGS', amount: 50000 }),
    reviewItem('harbour', 'new', everyday.id, { description: 'HARBOUR COFFEE' }),
  ])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, 'TFR FROM SAVINGS')
  const form = formOf(dialog)
  await expect(dialog.getByRole('tab', { name: 'Income', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(form.amount).toHaveValue('500.00')

  await dialog.getByRole('tab', { name: 'Transfer', exact: true }).click()
  await chooseFromDropdown(dialog, 'Category', 'Transfer')
  await expect(dialog.getByRole('tab', { name: 'Credit', exact: true })).toHaveAttribute('aria-selected', 'true')
  const counterparty = dialog.getByTestId('transaction-counterparty-account')
  await expect(counterparty).toHaveAccessibleName('Money came from')

  // The bank recorded one side only, so recording the other is left to Savings' own bank
  await expect(dialog.getByRole('checkbox', { name: /Record in both accounts/ })).toHaveCount(0)

  // A bank item's transfer names one of the user's own accounts, which a group account isn't
  await counterparty.click()
  await expect(dialog.getByRole('option', { name: 'Savings' })).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'Household' })).toHaveCount(0)
  await dialog.getByRole('option', { name: 'Savings' }).click()
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await form.add.click()

  await expect(dialog).toBeHidden()
  expect(review.decisions).toEqual([{
    itemId: 'savings',
    action: 'add',
    body: expect.objectContaining({ amount: 50000, counterparty_account_id: savings.id, counterparty_account_scope: 'tracked' }),
  }])
  await expect(page.getByTestId(`transaction-row-${review.created[0]}`)).toContainText('Savings')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(1)
  const rows = reviewBlock(page).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('HARBOUR COFFEE')
})

test('dismisses an item without reading the ledger again, and closes when the window is not kept open', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const review = await answerReview(page, [
    countdown(everyday.id),
    reviewItem('harbour', 'new', everyday.id, { description: 'HARBOUR COFFEE' }),
  ])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
  const ledgerReads: string[] = []
  page.on('request', (sent) => {
    if (sent.method() === 'GET' && sent.url().startsWith(`${API_BASE_URL}/transactions?`)) ledgerReads.push(sent.url())
  })
  await formOf(dialog).dismiss.click()

  await expect(dialog).toBeHidden()
  const rows = reviewBlock(page).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('HARBOUR COFFEE')
  expect(review.decisions).toEqual([{ itemId: 'countdown', action: 'dismiss', body: null }])
  expect(ledgerReads).toEqual([])
})

test('goes on from the last new item loaded to the first on the next page', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const review = await answerReview(page, [
    reviewItem('harbour', 'new', everyday.id, { description: 'HARBOUR COFFEE' }),
    countdown(everyday.id),
    reviewItem('cafe', 'new', everyday.id, { description: 'CAFE ROMA' }),
  ], 2)

  // The next page is held until a decision is sent, so the next item can only be found from the list
  // as it stands once the decision is made
  review.laterPages = page.waitForRequest((sent) =>
    sent.method() === 'POST' && sent.url().startsWith(`${API_BASE_URL}/bank-review/items/`))
  await openPage(page, '/transactions')
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(2)

  const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
  const form = formOf(dialog)
  await form.keepOpen.check()
  await form.dismiss.click()

  await expect(filingCard(page)).toContainText('CAFE ROMA')
  await expect(dialog).toBeVisible()
  expect(review.decisions).toEqual([{ itemId: 'countdown', action: 'dismiss', body: null }])
})

test('keeps the item open and says what went wrong when a decision fails', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const review = await answerReview(page, [countdown(everyday.id)])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
  const form = formOf(dialog)
  const dismissFailed = dialog.getByText('Could not dismiss this item. Please try again.', { exact: true })
  const serverMessage = "This item was dismissed, so it can't be added to the ledger"

  review.refusal = { status: 500, detail: 'Something went wrong' }
  await form.dismiss.click()
  await expect(dismissFailed).toBeVisible()

  // The server's own words when it refuses the item
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  review.refusal = { status: 409, detail: serverMessage }
  await form.add.click()
  await expect(dialog.getByText(serverMessage, { exact: true })).toBeVisible()
  await expect(dismissFailed).toBeHidden()

  // And the app's when no answer comes
  review.refusal = 'network'
  await form.add.click()
  await expect(dialog.getByText('Something went wrong. Please try again.', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(1)
  expect(review.created).toEqual([])
})

test('opens an amount its currency cannot hold empty, and adds the item once one is entered', async ({ page, request }) => {
  const { everyday } = await start(page, request)
  const review = await answerReview(page, [countdown(everyday.id, { amount: null, raw_amount: '-42.105' })])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
  const form = formOf(dialog)
  await expect(dialog.getByRole('tab', { name: 'Expense', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(form.amount).toHaveValue('')
  expect(new Map(await fieldsOf(filingCard(page))).get('Amount')).toBe(`${MINUS}$42.105`)

  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await form.add.click()
  await expect(dialog.getByText('Enter an amount', { exact: true })).toBeVisible()
  expect(review.decisions).toEqual([])

  await form.amount.fill('42.11')
  await form.add.click()
  await expect(dialog).toBeHidden()
  expect(review.decisions).toEqual([{ itemId: 'countdown', action: 'add', body: expect.objectContaining({ amount: -4211 }) }])
  await expectTransactionRow(page, review.created[0], `${MINUS}$42.11`)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`hangs the filing card beside the form or heads it, readable in the ${colorScheme} theme`, async ({ page, request }) => {
    const { everyday } = await start(page, request)
    await answerReview(page, [countdown(everyday.id)])
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openPage(page, '/transactions')

    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    const dialog = await openReview(page, 'COUNTDOWN 123 AUCKLAND')
    const card = filingCard(page)
    const amount = formOf(dialog).amount
    const viewport = page.viewportSize()!

    // Beside the dialog, level with its top, wherever there is room, and otherwise at the head of the
    // form inside it. A phone gives the dialog its whole screen. Read once the dialog has settled
    await expect(async () => {
      const [dialogBox, cardBox, amountBox] = await Promise.all([dialog, card, amount].map((part) => part.boundingBox()))
      if (viewport.width >= ASIDE_MIN_WIDTH) {
        expect(cardBox!.x).toBeGreaterThan(dialogBox!.x + dialogBox!.width)
        expect(cardBox!.x + cardBox!.width).toBeLessThanOrEqual(viewport.width)
        expect(Math.abs(cardBox!.y - dialogBox!.y)).toBeLessThan(40)
      } else {
        expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(amountBox!.y)
      }
      if (viewport.width < FULL_SCREEN_BELOW) expect(dialogBox).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height })
    }).toPass()
    await expect(dialog.getByRole('region', { name: 'SimpleFIN filing card' })).toHaveCount(viewport.width >= ASIDE_MIN_WIDTH ? 0 : 1)
    expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true)

    const texts = [
      page.getByText('SimpleFIN', { exact: true }).filter({ visible: true }),
      card.getByText('Example Bank', { exact: true }),
      card.getByText('New', { exact: true }),
      card.getByText('Chequing', { exact: true }),
      card.getByText('Description from SimpleFIN', { exact: true }),
      card.getByText('COUNTDOWN 123 AUCKLAND', { exact: true }),
      ...await card.locator('dt, dd').all(),
    ]
    for (const text of texts) {
      expect(await contrastOf(text), `${await text.textContent()} in the ${colorScheme} theme`).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST)
    }
  })
}
