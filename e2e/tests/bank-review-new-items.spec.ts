import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  countLedgerTransactions,
  createAccount,
  createGroup,
  daysFromTodayInTestTimezone,
  findReferenceId,
  signUpUser,
  type SeededAccount,
  type TestUser,
} from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage, waitForRequestsSoFar } from '../support/app'
import {
  fetchOnOwnConnection,
  isRead,
  linkToEmptyBankAccount,
  readReviewItems,
  readTransaction,
  reviewBlock,
  waitForReviewItems,
  type BridgeTransaction,
} from '../support/bankSync'
import { faintestText } from '../support/contrast'
import { expectTransactionRow, getTransactionRowButton, MINUS } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the light theme's filing card test and the footer and short phone
// screen tests. Those run at every size: the card and the footer take their own layouts at each width,
// and a phone gives the dialogue its whole screen

// A new bank item opens from its row in the review block in the transaction modal. The item is filed
// into the ledger or dismissed.
//
// Everyday links to an empty bank account at Harbour Bank on the fake SimpleFIN Bridge. The bridge sends
// the transactions each test needs, and the worker imports them for review, so every decision goes to
// the server and what it saved is read back. Only what the server doesn't give is answered in its
// place: a failed or unanswered decision, and pages of two items for a list too short to need a second
// page

type Accounts = { user: TestUser; everyday: SeededAccount; savings: SeededAccount }

const DIALOG_NAME = 'Review bank item'

// What a refused dismissal says, shown by the dialogue as the server gave it
const DISMISS_REFUSED = 'This item has already been decided'

// Each a day apart from the others, so the review list, newest first, holds them in this order
const COUNTDOWN = { posted: daysFromTodayInTestTimezone(-2), amount: '-42.10', description: 'COUNTDOWN 123 AUCKLAND' } as const
const HARBOUR = { posted: daysFromTodayInTestTimezone(-4), amount: '-12.50', description: 'HARBOUR COFFEE' } as const
const CAFE = { posted: daysFromTodayInTestTimezone(-6), amount: '-8.75', description: 'CAFE ROMA' } as const

// The day a user moves Countdown's spend to, the day before the bank booked it
const EDITED_DATE = daysFromTodayInTestTimezone(-3)

// Where the modal has room for the card beside it, and below which it takes the whole screen
const ASIDE_MIN_WIDTH = 1320
const FULL_SCREEN_BELOW = 1050

// Signed up and linked fresh for every test. That keeps every account here
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/**
 * Signs up with Savings and with Everyday, linked to Everyday Chequing at Harbour Bank from ten days
 * ago, and waits for the worker to bring in the transactions the bank sends for review
 */
async function start(page: Page, request: APIRequestContext, transactions: BridgeTransaction[]): Promise<Accounts> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  await linkToEmptyBankAccount(request, user, { accountId: everyday.id, startDate: daysFromTodayInTestTimezone(-10), transactions })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === transactions.length)
  await logInViaApi(page, user)
  return { user, everyday, savings }
}

/** Opens a new item from its row in the review block, and answers with the review dialogue */
async function openReview(page: Page, description: string): Promise<Locator> {
  await reviewBlock(page).getByRole('button', { name: description }).click()
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME })
  await expect(dialog).toBeVisible()
  return dialog
}

/** The filing card shown for the item under review, beside the dialogue or inside it */
function filingCard(page: Page): Locator {
  return page.getByRole('region', { name: 'SimpleFIN filing card' })
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
    confirmDismiss: dialog.getByRole('button', { name: 'Yes, dismiss', exact: true }),
  }
}

/** Dismisses the open item, in the two presses of Dismiss and Yes, dismiss */
async function dismissItem(dialog: Locator): Promise<void> {
  const { dismiss, confirmDismiss } = formOf(dialog)
  await dismiss.click()
  await confirmDismiss.click()
}

/** Asserts the merchant and category are still to be chosen, and not yet marked as missing */
async function expectMerchantAndCategoryEmpty(dialog: Locator): Promise<void> {
  const { merchant, category } = formOf(dialog)
  await expect(merchant).toContainText('Select or type to create...')
  await expect(category).toContainText('Select category...')
  await expect(merchant).not.toHaveAttribute('aria-invalid', 'true')
  await expect(category).not.toHaveAttribute('aria-invalid', 'true')
}

/** Collects the action of each decision the page sends on an item from now on, such as add or dismiss */
function watchDecisions(page: Page): string[] {
  const actions: string[] = []
  page.on('request', (sent) => {
    const [, action] = /\/bank-review\/items\/[^/]+\/([a-z-]+)$/.exec(sent.url()) ?? []
    if (sent.method() === 'POST' && action) actions.push(action)
  })
  return actions
}

/** Presses Add to ledger, and answers with the id of the ledger transaction the server added */
async function addToLedger(page: Page, dialog: Locator): Promise<string> {
  const added = page.waitForResponse((response) => response.request().method() === 'POST' && /\/bank-review\/items\/[^/]+\/add$/.test(response.url()))
  await formOf(dialog).add.click()
  const response = await added
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

/** The bank's descriptions of the items still waiting in the account, newest first */
async function readWaiting(request: APIRequestContext, user: TestUser, accountId: string): Promise<string[]> {
  return (await readReviewItems(request, user, accountId)).map((item) => item.bank.description)
}

test('opens a new item as the bank sent it beside its filing card, and adds nothing until a merchant and category are chosen', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  const decisions = watchDecisions(page)
  await expect(dialog.getByText('New from SimpleFIN', { exact: true })).toBeVisible()

  // An expense, since the money went out, for the bank's amount on its date in the account it came to.
  // That account stays put
  const [year, month, day] = COUNTDOWN.posted.split('-')
  await expect(dialog.getByRole('tab', { name: 'Expense', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(form.amount).toHaveValue('42.10')
  await expect(form.year).toHaveValue(year)
  await expect(form.month).toHaveValue(month)
  await expect(form.day).toHaveValue(day)
  await expect(form.account).toContainText('Everyday')
  await expect(form.account).toHaveAttribute('aria-disabled', 'true')
  await expect(form.account).toHaveAccessibleDescription(/A bank item stays in the account whose bank sent it/)
  await expectMerchantAndCategoryEmpty(dialog)

  // Closing leaves the item waiting, so the header's Close is the only way out besides a decision
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
  await expect(form.keepOpen).not.toBeChecked()
  await expect(form.keepOpen).toHaveAccessibleName('Keep window open Review one item after another')

  // Add to ledger is the form's submit, so it announces the submit shortcut as every dialogue's does
  await expect(form.add).toHaveAttribute('aria-keyshortcuts', 'Alt+Enter')
  await expect(form.dismiss).not.toHaveAttribute('aria-keyshortcuts')

  // The card's fields are covered with the card, leaving what the link and the item's account bring it
  const card = filingCard(page)
  await expect(card).toContainText('Harbour Bank')
  await expect(card).toContainText('Everyday Chequing')
  await expect(card).toContainText(COUNTDOWN.description)

  // The bank's description starts the notes, and the user may change them
  await expect(form.notes).toHaveValue(COUNTDOWN.description)

  // As every other dialogue's submit, Add to ledger stays whole until a press finds what is missing, then fades
  await expect(form.add).not.toHaveAttribute('aria-disabled', 'true')
  await form.add.click()
  await expect(form.merchant).toHaveAttribute('aria-invalid', 'true')
  await expect(form.category).toHaveAttribute('aria-invalid', 'true')
  await expect(form.merchant).toHaveAccessibleDescription('Select or create a merchant')
  await expect(form.category).toHaveAccessibleDescription('Select a category')
  await expect(form.add).toHaveAttribute('aria-disabled', 'true')
  await expect(form.add).toHaveAccessibleDescription('Select or create a merchant')
  expect(decisions).toEqual([])
  await expect(dialog).toBeVisible()
  expect(await readWaiting(request, user, everyday.id)).toEqual([COUNTDOWN.description])
})

test('opens a bank description over 500 characters whole in Notes, and takes typing after it in review and once in the ledger', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const long = { ...HARBOUR, description: `HARBOUR COFFEE ${'REF '.repeat(130)}`.trim() }
  await start(page, request, [long])
  await openPage(page, '/transactions')

  const review = await openReview(page, 'HARBOUR COFFEE')
  const { notes } = formOf(review)
  await expect(notes).toHaveValue(long.description)
  await notes.press('End')
  await notes.pressSequentially(' paid')
  await expect(notes).toHaveValue(`${long.description} paid`)

  // Added to the ledger, the transaction keeps its bank source, and its Notes still take typing when edited
  await chooseFromDropdown(review, 'Merchant', 'Unknown')
  await chooseFromDropdown(review, 'Category', 'Groceries')
  const id = await addToLedger(page, review)
  await expect(review).toBeHidden()
  await getTransactionRowButton(page.getByTestId(`transaction-row-${id}`)).click()
  const edit = page.getByRole('dialog', { name: 'Edit transaction', exact: true })
  const editNotes = edit.getByRole('textbox', { name: 'Notes', exact: true })
  await expect(editNotes).toHaveValue(`${long.description} paid`)
  await editNotes.press('End')
  await editNotes.pressSequentially(' twice')
  await expect(editNotes).toHaveValue(`${long.description} paid twice`)

  // A transaction the user adds keeps Notes at 500 characters, as every manual entry does
  await openPage(page, '/transactions')
  const add = await openModal(page, ['Add transaction'], 'Add transaction')
  const addNotes = add.getByRole('textbox', { name: 'Notes', exact: true })
  await addNotes.fill('x'.repeat(500))
  await addNotes.press('End')
  await addNotes.pressSequentially('y')
  await expect(addNotes).toHaveValue('x'.repeat(500))
})

test('adds an item with its date and amount changed, and with the window kept open goes on through the new items until none are left', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN, HARBOUR])
  await openPage(page, '/transactions')

  // The date typed over the bank's, a part at a time as a user types it
  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  await form.year.click()
  await page.keyboard.type(EDITED_DATE.replaceAll('-', ''))
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await form.amount.fill('40.00')
  await form.keepOpen.check()

  // Three days ago is a day Everyday's bank supplies. A manual entry may not take it, and a review may
  const id = await addToLedger(page, dialog)

  // The next new item, in a fresh form with the window still open
  await expect(filingCard(page)).toContainText(HARBOUR.description)
  await expect(form.amount).toHaveValue('12.50')
  await expectMerchantAndCategoryEmpty(dialog)
  await expect(form.keepOpen).toBeChecked()
  // Behind the open dialogue. It takes the page out of the accessibility tree
  await expect(page.getByTestId('review-count')).toHaveText('1')
  await expect(page.getByTestId(`transaction-row-${id}`)).toBeVisible()

  // Nothing new is left after it, so the window closes
  await dismissItem(dialog)
  await expect(dialog).toBeHidden()
  await expect(reviewBlock(page)).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$40.00`)

  // Saved in Everyday under the merchant and category chosen, on the day and with the amount the user
  // changed. Those count as their edits
  expect(await readTransaction(request, user, id)).toMatchObject({
    account_id: everyday.id,
    dt: EDITED_DATE,
    amount: -4000,
    category_id: await findReferenceId(request, user, 'categories', 'Groceries'),
    merchant_id: await findReferenceId(request, user, 'merchants', 'Unknown'),
    bank_source: { edited_fields: ['date', 'amount'] },
  })
  expect(await readWaiting(request, user, everyday.id)).toEqual([])
})

test('records money in from Savings as one transfer that names Savings, kept as money in, and closes with the window not kept open', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday, savings } = await start(page, request, [
    { posted: daysFromTodayInTestTimezone(-2), amount: '500.00', description: 'TFR FROM SAVINGS' },
    HARBOUR,
  ])
  await createAccount(request, user, { name: 'Household', groupId: await createGroup(request, user, 'Family') })
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

  // A bank item's transfer names one of the user's own accounts, and a group account isn't one
  await counterparty.click()
  await expect(dialog.getByRole('option', { name: 'Savings' })).toBeVisible()
  await expect(dialog.getByRole('option', { name: 'Household' })).toHaveCount(0)
  await dialog.getByRole('option', { name: 'Savings' }).click()
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  const id = await addToLedger(page, dialog)

  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(`transaction-row-${id}`)).toContainText('Savings')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(1)
  const rows = reviewBlock(page).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(HARBOUR.description)

  // Saved as money in from Savings under the merchant and category chosen, on Everyday's side alone
  expect(await readTransaction(request, user, id)).toMatchObject({
    account_id: everyday.id,
    amount: 50000,
    category_id: await findReferenceId(request, user, 'categories', 'Transfer'),
    merchant_id: await findReferenceId(request, user, 'merchants', 'Unknown'),
    counterparty_account_id: savings.id,
    counterparty_account_scope: 'tracked',
  })
  expect(await countLedgerTransactions(request, user)).toBe(1)
  expect(await readWaiting(request, user, everyday.id)).toEqual([HARBOUR.description])
})

test('dismisses only on a second press, by mouse or keyboard, and takes the first back when the user moves on', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN, HARBOUR])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  const decisions = watchDecisions(page)
  const announcement = dialog.getByRole('status').filter({ hasText: 'Please press again to dismiss this item for good.' })

  // One press only asks, saying so to a screen reader, and a press elsewhere takes it back
  await expect(form.dismiss).toHaveClass(/app-danger-button/)
  await form.dismiss.click()
  await expect(form.confirmDismiss).toBeVisible()
  await expect(announcement).toHaveCount(1)
  await dialog.getByRole('heading', { name: 'Review bank item' }).click()
  await expect(form.dismiss).toBeVisible()
  await expect(announcement).toHaveCount(0)
  expect(decisions).toEqual([])

  // Moving focus on with the keyboard takes it back too
  await form.dismiss.focus()
  await page.keyboard.press('Enter')
  await expect(form.confirmDismiss).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(form.dismiss).toBeVisible()
  expect(decisions).toEqual([])
  expect(await readWaiting(request, user, everyday.id)).toEqual([COUNTDOWN.description, HARBOUR.description])

  // The second press from the keyboard decides, and the window closes with the next item still waiting
  await form.dismiss.focus()
  await page.keyboard.press('Enter')
  await page.keyboard.press('Space')
  await expect(dialog).toBeHidden()
  expect(decisions).toEqual(['dismiss'])
  expect(await readWaiting(request, user, everyday.id)).toEqual([HARBOUR.description])
})

test('dismisses items without reading the ledger again, going on to the next while the window is kept open', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN, HARBOUR, CAFE])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  const ledgerReads: string[] = []
  page.on('request', (sent) => {
    if (sent.method() === 'GET' && sent.url().startsWith(`${API_BASE_URL}/transactions?`)) ledgerReads.push(sent.url())
  })
  await form.keepOpen.check()
  await dismissItem(dialog)
  await expect(filingCard(page)).toContainText(HARBOUR.description)

  // With the window no longer kept open, the next decision closes it though an item still waits
  await form.keepOpen.uncheck()
  await dismissItem(dialog)
  await expect(dialog).toBeHidden()
  const rows = reviewBlock(page).getByRole('listitem')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText(CAFE.description)
  await waitForRequestsSoFar(page)
  expect(ledgerReads).toEqual([])

  // Both left review without reaching the ledger
  expect(await readWaiting(request, user, everyday.id)).toEqual([CAFE.description])
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

test('goes on from the last new item loaded to the first on the next page', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN, HARBOUR, CAFE])

  // Two items to a page, and every page after the first held until a decision is sent, so the next
  // item can only be found from the list as it stands once the decision is made
  const decided = page.waitForRequest((sent) => sent.method() === 'POST' && sent.url().startsWith(`${API_BASE_URL}/bank-review/items/`))
  await page.route(isRead('/bank-review/items'), async (route) => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('cursor')) await decided
    url.searchParams.set('limit', '2')
    await route.fulfill({ response: await fetchOnOwnConnection(route, { url: url.href }) })
  })
  await openPage(page, '/transactions')
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(2)

  const dialog = await openReview(page, HARBOUR.description)
  const form = formOf(dialog)
  await form.keepOpen.check()
  await dismissItem(dialog)

  await expect(filingCard(page)).toContainText(CAFE.description)
  await expect(dialog).toBeVisible()
  expect(await readWaiting(request, user, everyday.id)).toEqual([COUNTDOWN.description, CAFE.description])
})

test('keeps the item open and says what went wrong when a decision fails', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN])

  // Decisions fail as the server never would, with an error or with no answer at all, until a test
  // lets them through
  let failure: 'error' | 'no answer' | null = 'error'
  await page.route((url) => url.href.startsWith(`${API_BASE_URL}/bank-review/items/`), (route) => {
    if (failure === 'error') return route.fulfill({ status: 409, json: { detail: DISMISS_REFUSED } })
    if (failure === 'no answer') return route.abort()
    return route.fallback()
  })
  await openPage(page, '/transactions')

  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  const dismissFailed = dialog.getByText(DISMISS_REFUSED, { exact: true })
  await dismissItem(dialog)
  await expect(dismissFailed).toBeVisible()

  // The app's own words when no answer comes
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  failure = 'no answer'
  await form.add.click()
  await expect(dialog.getByText('Something went wrong. Please try again.', { exact: true })).toBeVisible()
  await expect(dismissFailed).toBeHidden()

  // Closed, the item still waits
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(1)

  // And the server's own words when it refuses the item, dismissed meanwhile on another device
  const [item] = await readReviewItems(request, user, everyday.id)
  expect((await request.post(`${API_BASE_URL}/bank-review/items/${item.id}/dismiss`, { headers: asUser(user) })).status()).toBe(204)
  failure = null
  await openReview(page, COUNTDOWN.description)
  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await form.add.click()
  await expect(dialog.getByText("This item was dismissed, so the item can't be added to your ledger", { exact: true })).toBeVisible()
  await expect(dialog).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(0)
})

test('opens an amount its currency cannot hold empty, and adds the item once one is entered', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [{ ...COUNTDOWN, amount: '-42.105' }])
  await openPage(page, '/transactions')

  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  const decisions = watchDecisions(page)
  await expect(dialog.getByRole('tab', { name: 'Expense', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(form.amount).toHaveValue('')
  // Says why it starts empty, before anything is pressed
  const why = "The bank's amount has more decimal places than CAD allows, so please enter the amount by hand"
  await expect(form.amount).toHaveAccessibleDescription(why)

  await chooseFromDropdown(dialog, 'Merchant', 'Unknown')
  await chooseFromDropdown(dialog, 'Category', 'Groceries')
  await form.add.click()
  await expect(form.amount).toHaveAccessibleDescription(`Enter an amount ${why}`)
  expect(decisions).toEqual([])

  await form.amount.fill('42.11')
  const id = await addToLedger(page, dialog)
  await expect(dialog).toBeHidden()
  await expectTransactionRow(page, id, `${MINUS}$42.11`)

  // The amount the user entered stands in for the bank's, so it counts as their edit, and the item is
  // saved in Everyday on the bank's day under the merchant and category chosen
  expect(await readTransaction(request, user, id)).toMatchObject({
    account_id: everyday.id,
    dt: COUNTDOWN.posted,
    amount: -4211,
    category_id: await findReferenceId(request, user, 'categories', 'Groceries'),
    merchant_id: await findReferenceId(request, user, 'merchants', 'Unknown'),
    bank_source: { edited_fields: ['amount'] },
  })
})

for (const colorScheme of ['light', 'dark'] as const) {
  // Only the light run places the card, so only it runs at every size
  test(`${colorScheme === 'light' ? 'hangs the filing card beside the form or heads it, readable' : 'keeps the filing card readable'} in the ${colorScheme} theme`, colorScheme === 'light' ? AT_EVERY_SIZE_NEEDS_BANK_SYNC : NEEDS_BANK_SYNC, async ({ page, request }) => {
    await start(page, request, [COUNTDOWN])
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    await openPage(page, '/transactions')

    if (colorScheme === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/)
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/)
    const dialog = await openReview(page, COUNTDOWN.description)
    const card = filingCard(page)
    const amount = formOf(dialog).amount
    const viewport = page.viewportSize()!

    // The layout is the same in either theme, so it is measured in the light one only
    if (colorScheme === 'light') {
      // Beside the dialogue, level with its top, wherever there is room, and otherwise at the head of the
      // form inside it. A phone gives the dialogue its whole screen. Read once the dialogue has settled
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
    }

    // The card's labels are set in capitals, but the provider's name inside one keeps its own case
    const descriptionLabel = card.getByText('Description from SimpleFIN', { exact: true })
    expect(await descriptionLabel.evaluate((label) => (label as HTMLElement).innerText)).toMatch(/SimpleFIN$/)

    const texts = [
      page.getByText('SimpleFIN', { exact: true }).filter({ visible: true }).first(),
      card.getByText('Harbour Bank', { exact: true }),
      card.getByText('New', { exact: true }),
      card.getByText('Everyday Chequing', { exact: true }),
      card.getByText('Description from SimpleFIN', { exact: true }),
      card.getByText(COUNTDOWN.description, { exact: true }),
      ...await card.locator('dt, dd').all(),
    ]
    for (const text of texts) {
      expect((await faintestText(text)).contrast, `${await text.textContent()} in the ${colorScheme} theme`).toBeGreaterThanOrEqual(4.5)
    }
  })
}

// Below 1050 the form sits further from the right edge than the left, and the footer once padded both
// sides alike, so Keep window open started further in than the title and the form's numbered sections,
// and Add to ledger stopped short of where the fields end. The footer stacks its items below 640 and sets
// them in a row from there, so each layout is checked once: stacked on the phone, and in a row at the
// widest screen the dialogue fills
for (const { project, width } of [{ project: 'phone', width: null }, { project: 'desktop', width: 1049 }] as const) {
  test(`lines the footer up with the form above it on the ${project}`, AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
    test.skip(test.info().project.name !== project, 'Each layout of the footer is checked at one width')
    await start(page, request, [COUNTDOWN])
    if (width) await page.setViewportSize({ width, height: page.viewportSize()!.height })
    await openPage(page, '/transactions')

    const dialog = await openReview(page, COUNTDOWN.description)
    const form = formOf(dialog)
    // Measured together and polled, since the dialogue scales in as it opens and edges read mid-animation
    // drift apart by however far it has to go. Keep window open's checkbox starts the footer, as it does
    // in the Add Transaction footer, and Amount ends the fields
    const readEdgeOffsets = async () => {
      const [keepOpen, add, title, amount] = await Promise.all([
        dialog.getByRole('checkbox', { name: /Keep window open/ }).boundingBox(),
        form.add.boundingBox(),
        dialog.getByRole('heading', { name: DIALOG_NAME, exact: true }).boundingBox(),
        form.amount.boundingBox(),
      ])
      return {
        left: Math.round(keepOpen!.x - title!.x) || 0,
        right: Math.round(add!.x + add!.width - (amount!.x + amount!.width)) || 0,
      }
    }

    await expect.poll(readEdgeOffsets).toEqual({ left: 0, right: 0 })
  })
}

// A short phone screen. The card heading the form leaves most of the form below the fold
test.describe('on a short phone screen', AT_EVERY_SIZE_NEEDS_BANK_SYNC, () => {
  test.beforeEach(async ({ page }) => {
    test.skip(test.info().project.name !== 'phone', 'Only a phone screen is short enough')
    await page.setViewportSize({ width: 390, height: 667 })
  })

  test('starts on the first field to fill in, the amount where the bank’s can’t be used', NEEDS_BANK_SYNC, async ({ page, request }) => {
    await start(page, request, [COUNTDOWN, { ...HARBOUR, amount: '-12.505' }])
    await openPage(page, '/transactions')

    const dialog = await openReview(page, COUNTDOWN.description)
    await expect(formOf(dialog).merchant).toBeFocused()
    await dialog.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(dialog).toBeHidden()

    await openReview(page, HARBOUR.description)
    await expect(formOf(dialog).amount).toBeFocused()
  })

  test('shows the next item from the top of its form, wherever the last one was scrolled to', NEEDS_BANK_SYNC, async ({ page, request }) => {
    await start(page, request, [COUNTDOWN, HARBOUR])
    await openPage(page, '/transactions')

    const dialog = await openReview(page, COUNTDOWN.description)
    const form = formOf(dialog)
    await form.keepOpen.check()
    await form.amount.scrollIntoViewIfNeeded()
    await expect(filingCard(page)).not.toBeInViewport()
    await dismissItem(dialog)

    await expect(filingCard(page)).toContainText(HARBOUR.description)
    await expect(filingCard(page)).toBeInViewport()
  })

  test('brings the first field Add still needs into view, and focuses it', NEEDS_BANK_SYNC, async ({ page, request }) => {
    await start(page, request, [COUNTDOWN])
    await openPage(page, '/transactions')

    const dialog = await openReview(page, COUNTDOWN.description)
    const form = formOf(dialog)
    await form.add.click()

    await expect(form.merchant).toBeFocused()
    await expect(form.merchant).toBeInViewport({ ratio: 1 })
  })

  test('brings a failed decision’s message into view', NEEDS_BANK_SYNC, async ({ page, request }) => {
    await start(page, request, [COUNTDOWN])

    // The dismissal fails as the server never would
    await page.route((url) => url.href.startsWith(`${API_BASE_URL}/bank-review/items/`), (route) =>
      route.fulfill({ status: 409, json: { detail: DISMISS_REFUSED } }))
    await openPage(page, '/transactions')

    const dialog = await openReview(page, COUNTDOWN.description)
    await dismissItem(dialog)

    await expect(dialog.getByText(DISMISS_REFUSED, { exact: true })).toBeInViewport({ ratio: 1 })
  })
})

// Dismiss widens to Yes, dismiss and back over the app's ease rather than jumping. Its width is read on every
// frame the page draws until it has held still a while after changing, so a width that jumps shows its new
// width on the first frame it moves
test('eases Dismiss to Yes, dismiss and back rather than jumping between their widths', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await start(page, request, [COUNTDOWN])
  await openPage(page, '/transactions')
  const dialog = await openReview(page, COUNTDOWN.description)
  const form = formOf(dialog)
  await expect(form.dismiss).toBeVisible()
  const recordWidths = () =>
    form.dismiss.or(form.confirmDismiss).evaluate(
      (button) =>
        new Promise<number[]>((resolve) => {
          const widths: number[] = []
          let lastChange: number | null = null
          const started = performance.now()
          const frame = () => {
            const width = button.getBoundingClientRect().width
            if (widths.length > 0 && Math.abs(width - widths[widths.length - 1]) > 0.1) lastChange = performance.now()
            widths.push(width)
            const settled = lastChange !== null && performance.now() - lastChange > 500
            if (settled || performance.now() - started > 5000) resolve(widths)
            else requestAnimationFrame(frame)
          }
          requestAnimationFrame(frame)
        }),
    )
  // The first width the button takes once it starts moving. A jump makes that its final width
  const firstMove = (widths: number[]) => widths.find((width) => Math.abs(width - widths[0]) > 1)

  const narrow = (await form.dismiss.boundingBox())!.width
  const widening = recordWidths()
  await form.dismiss.click()
  const wideningWidths = await widening
  await expect(form.confirmDismiss).toBeVisible()
  const wide = (await form.confirmDismiss.boundingBox())!.width
  expect(wide).toBeGreaterThan(narrow + 10)
  expect(firstMove(wideningWidths), JSON.stringify(wideningWidths)).toBeLessThan(wide - 1)

  const narrowing = recordWidths()
  await dialog.getByRole('heading', { name: 'Review bank item' }).click()
  const narrowingWidths = await narrowing
  await expect(form.dismiss).toBeVisible()
  expect(firstMove(narrowingWidths), JSON.stringify(narrowingWidths)).toBeGreaterThan(narrow + 1)
})
