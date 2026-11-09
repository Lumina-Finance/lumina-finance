import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  asUser,
  createAccount,
  createTransaction,
  daysFromTodayInTestTimezone,
  findReferenceId,
  signUpUser,
  type SeededAccount,
  type TestUser,
} from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import {
  linkToEmptyBankAccount,
  readReviewItems,
  readTransaction,
  waitForReviewItems,
  type BridgeTransaction,
} from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what a bulk decision saved is read back through the API, the same at every size,
// and the phone bar's tests set each phone width they check themselves

// New bank items are ticked in the review block beside ledger rows, then added to the ledger in one
// bulk edit, alone or with ledger transactions, or dismissed together.
//
// Everyday links to an empty bank account on the fake SimpleFIN Bridge. The bridge sends the items
// each test needs. Savings holds the ledger transaction a mixed selection ticks, since a linked account
// takes no hand-entered transactions on the days its bank supplies

type Accounts = { user: TestUser; everyday: SeededAccount; savings: SeededAccount; ledgerId: string }

// Each a day apart from the others, so the review list, newest first, holds them in this order
const COUNTDOWN = { posted: daysFromTodayInTestTimezone(-2), amount: '-42.10', description: 'COUNTDOWN 123 AUCKLAND' } as const
const HARBOUR = { posted: daysFromTodayInTestTimezone(-4), amount: '-12.50', description: 'HARBOUR COFFEE' } as const
const CAFE = { posted: daysFromTodayInTestTimezone(-6), amount: '-8.75', description: 'CAFE ROMA' } as const

// The day of the one ledger transaction. Its checkbox is named by it
const LEDGER_DATE = daysFromTodayInTestTimezone(-20)

// The phone widths the selection bar has to hold every action at, the narrowest phones included
const PHONE_WIDTHS = [390, 375, 360, 320]

// The words the phone bar shows, in the order they drop as the bar narrows: the last one first
const BAR_WORDS = ['Edit', 'Done', 'Filters']

/**
 * Signs up with Everyday, linked to a bank that sends the items given, and Savings, holding one
 * Groceries transaction, and waits for the worker to bring the items in for review
 */
async function start(page: Page, request: APIRequestContext, transactions: BridgeTransaction[]): Promise<Accounts> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  const ledgerId = await createTransaction(request, user, {
    accountId: savings.id,
    categoryName: 'Groceries',
    amount: -1000,
    date: LEDGER_DATE,
  })
  await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions,
  })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === transactions.length)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  return { user, everyday, savings, ledgerId }
}

/** Ticks a new item in the review block */
async function tickItem(page: Page, description: string): Promise<void> {
  await page.getByRole('checkbox', { name: `Select ${description}, waiting for review`, exact: true }).check()
}

/** Ticks the one ledger transaction */
async function tickLedger(page: Page): Promise<void> {
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${LEDGER_DATE}$`) }).check()
}

/** The bank's descriptions of the items still waiting in the account, newest first */
async function readWaiting(request: APIRequestContext, user: TestUser, accountId: string): Promise<string[]> {
  return (await readReviewItems(request, user, accountId)).map((item) => item.bank.description)
}

/**
 * Checks the phone's selection bar at each phone width: every action sits inside the bar with its own
 * contents inside it, and the words it shows are the ones that drop last
 */
async function expectPhoneBarFits(page: Page): Promise<void> {
  const done = page.getByRole('button', { name: 'Stop selecting transactions', exact: true })
  const readBar = () =>
    done.evaluate((button, dropOrder) => {
      const bar = button.parentElement!
      const edges = bar.getBoundingClientRect()
      const controls = [...bar.children].filter((control) => control.getBoundingClientRect().width > 0)
      const words = controls
        .flatMap((control) => [...control.querySelectorAll('span')])
        .filter((word) => word.children.length === 0 && word.getClientRects().length > 0)
        .map((word) => word.textContent?.trim() ?? '')
        .filter(Boolean)
      const inDropOrder = [...words].sort((a, b) => dropOrder.indexOf(a) - dropOrder.indexOf(b))
      return {
        overflowing: controls
          .filter((control) => {
            const box = control.getBoundingClientRect()
            return box.left < edges.left - 0.5 || box.right > edges.right + 0.5 || control.scrollWidth > control.clientWidth
          })
          .map((control) => control.getAttribute('aria-label')),
        wordsDropLastFirst: inDropOrder.every((word, index) => word === dropOrder[index]),
      }
    }, BAR_WORDS)

  // Read until it holds, since the bar takes a moment to settle into a new width
  for (const width of PHONE_WIDTHS) {
    await page.setViewportSize({ width, height: 844 })
    await expect(done).toBeVisible()
    await expect.poll(readBar, { message: `the bar at ${width}px` }).toEqual({ overflowing: [], wordsDropLastFirst: true })
  }
}

/** The account's ledger transactions as the server holds them, newest first */
async function readLedger(request: APIRequestContext, user: TestUser, accountId: string) {
  const response = await request.get(`${API_BASE_URL}/transactions`, {
    headers: asUser(user),
    params: { account_id: accountId },
  })
  expect(response.status()).toBe(200)
  return (await response.json()) as { dt: string; amount: number; category_id: string; merchant_id: string }[]
}

test('adds the ticked items to the ledger at their bank amounts once a merchant and category are chosen', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN, HARBOUR, CAFE])
  await tickItem(page, COUNTDOWN.description)
  await tickItem(page, HARBOUR.description)

  // Items waiting for review aren't in the ledger, so they can't be deleted or exported
  const deleteAction = page.getByRole('button', { name: 'Delete the selected transactions', exact: true })
  await expect(deleteAction).toHaveAccessibleDescription('Items waiting for review are dismissed, not deleted')
  await expect(page.getByRole('button', { name: 'Export selected', exact: true })).toHaveAccessibleDescription(
    "Items waiting for review aren't in your ledger yet",
  )

  await page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Add 2 items to your ledger', exact: true })
  await expect(edit).toBeVisible()
  await expect(edit.getByText('Account & Direction', { exact: true })).toHaveCount(0)

  // Nothing is sent until both are chosen
  const writes: string[] = []
  page.on('request', (sent) => {
    if (sent.method() === 'POST' && sent.url().includes('/bank-review/items/bulk-')) writes.push(sent.url())
  })
  const add = edit.getByRole('button', { name: 'Add 2 to ledger', exact: true })
  await add.click()

  // Each field marks itself as missing, as any form's required field does, and the button keeps the reason
  const merchant = edit.getByRole('combobox', { name: 'Merchant' })
  const category = edit.getByRole('combobox', { name: 'Category' })
  await expect(edit.getByRole('alert').filter({ hasText: 'Select a merchant' })).toBeVisible()
  await expect(edit.getByRole('alert').filter({ hasText: 'Select a category' })).toBeVisible()
  await expect(merchant).toHaveAttribute('aria-invalid', 'true')
  await expect(category).toHaveAttribute('aria-invalid', 'true')
  await expect(merchant).toBeFocused()
  await expect(add).toHaveAccessibleDescription('Choose a merchant and a category to add items to your ledger')
  expect(writes).toEqual([])

  await chooseFromDropdown(edit, 'Merchant', 'Unknown')
  await expect(merchant).not.toHaveAttribute('aria-invalid', 'true')
  await expect(category).toHaveAttribute('aria-invalid', 'true')
  await chooseFromDropdown(edit, 'Category', 'Groceries')
  const saved = page.waitForResponse((response) => response.url() === `${API_BASE_URL}/bank-review/items/bulk-add`)
  await add.click()
  expect((await saved).status()).toBe(200)

  await expect(edit).toBeHidden()
  await expect(page.getByText('2 items added to your ledger.', { exact: true })).toBeVisible()
  expect(await readWaiting(request, user, everyday.id)).toEqual([CAFE.description])

  const groceries = await findReferenceId(request, user, 'categories', 'Groceries')
  const ledger = await readLedger(request, user, everyday.id)
  expect(ledger.map(({ dt, amount, category_id }) => ({ dt, amount, category_id }))).toEqual([
    { dt: COUNTDOWN.posted, amount: -4210, category_id: groceries },
    { dt: HARBOUR.posted, amount: -1250, category_id: groceries },
  ])
})

test('adds a ticked item and updates a ticked ledger transaction in one edit', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday, ledgerId } = await start(page, request, [CAFE])
  await tickItem(page, CAFE.description)
  await tickLedger(page)

  // A ledger transaction in the selection can't be dismissed
  const dismiss = page.getByRole('button', { name: 'Dismiss the selected items', exact: true })
  await expect(dismiss).toHaveAccessibleDescription('Only items waiting for review can be dismissed')

  await page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).click()
  const edit = page.getByRole('dialog', { name: 'Add 1 item and update 1 transaction', exact: true })
  await chooseFromDropdown(edit, 'Merchant', 'Unknown')
  await chooseFromDropdown(edit, 'Category', 'Dining')
  await edit.getByRole('button', { name: 'Add 1 and update 1', exact: true }).click()

  const confirmation = page.getByRole('dialog', { name: 'Add 1 item and change 1 transaction?', exact: true })
  const added = page.waitForResponse((response) => response.url() === `${API_BASE_URL}/bank-review/items/bulk-add`)
  const updated = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url() === `${API_BASE_URL}/transactions/bulk`,
  )
  await confirmation.getByRole('button', { name: 'Confirm', exact: true }).click()
  expect((await added).status()).toBe(200)
  expect((await updated).status()).toBe(200)

  await expect(page.getByText('1 item added to your ledger and 1 transaction updated.', { exact: true })).toBeVisible()
  const dining = await findReferenceId(request, user, 'categories', 'Dining')
  expect(await readWaiting(request, user, everyday.id)).toEqual([])
  expect((await readTransaction(request, user, ledgerId)).category_id).toBe(dining)
  expect((await readLedger(request, user, everyday.id)).map(({ amount, category_id }) => ({ amount, category_id }))).toEqual([
    { amount: -875, category_id: dining },
  ])
})

test('dismisses the ticked items together and leaves the ledger as it was', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, everyday } = await start(page, request, [COUNTDOWN, HARBOUR, CAFE])
  const dismiss = page.getByRole('button', { name: 'Dismiss the selected items', exact: true })
  await expect(dismiss).toHaveAccessibleDescription('Tick a transaction or review item first')

  await tickItem(page, COUNTDOWN.description)
  await tickItem(page, CAFE.description)
  await dismiss.click()

  const confirmation = page.getByRole('dialog', { name: 'Dismiss 2 items?', exact: true })
  await expect(confirmation.getByText("This can't be undone.", { exact: true })).toBeVisible()
  const saved = page.waitForResponse((response) => response.url() === `${API_BASE_URL}/bank-review/items/bulk-dismiss`)
  await confirmation.getByRole('button', { name: 'Dismiss', exact: true }).click()
  expect((await saved).status()).toBe(200)

  await expect(page.getByText('2 items dismissed.', { exact: true })).toBeVisible()
  expect(await readWaiting(request, user, everyday.id)).toEqual([HARBOUR.description])
  expect(await readLedger(request, user, everyday.id)).toEqual([])
})

test('keeps every action inside the phone selection bar while Dismiss is offered', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await start(page, request, [COUNTDOWN, HARBOUR, CAFE])
  await expect(page.getByRole('button', { name: 'Dismiss the selected items', exact: true })).toBeAttached()

  await expectPhoneBarFits(page)
})

test('keeps every action inside the phone selection bar with no item waiting for review', async ({ page, request }) => {
  const user = await signUpUser(request)
  const savings = await createAccount(request, user, { name: 'Savings', accountType: 'savings' })
  await createTransaction(request, user, { accountId: savings.id, categoryName: 'Groceries', amount: -1000, date: LEDGER_DATE })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Dismiss the selected items', exact: true })).toHaveCount(0)

  await expectPhoneBarFits(page)
})
