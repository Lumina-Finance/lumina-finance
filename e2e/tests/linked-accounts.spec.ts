import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, todayInTestTimezone } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// A linked account's bank supplies its transactions from the import start through today, so the
// transaction modal refuses those days, a bank transaction can't leave the account, and the account
// can't be archived until it is unlinked.
//
// The list of links the app reads is not served yet, so each test answers it with the link it needs.
// Nothing links the account on the server, which accepts every save, so a refusal seen here is the
// browser's own and a save that goes through is one the browser let through
const IMPORT_START = '2026-01-01'
const SUPPLIED_DAYS_MESSAGE = "SimpleFIN supplies this account's transactions from Jan 1, 2026 to today"
const MOVE_REFUSAL = "Transactions from SimpleFIN can't move out of Everyday while it's linked"
const ARCHIVE_LINKED_REASON = "This account can't be archived while it's linked to SimpleFIN. Unlink it first"

// Where a bank transaction came from, as the app reads it alongside the transaction
const BANK_SOURCE = {
  provider: 'simplefin',
  provider_name: 'SimpleFIN',
  bank_values: {
    date: '2026-01-15',
    amount: -4250,
    raw_amount: null,
    description: 'GROCER 123',
    merchant_name: null,
    category_hint: null,
  },
  edited_fields: [],
  review_item_id: null,
}

// The layout puts Date, Currency and Amount side by side from this width
const FIELD_ROW_MIN_WIDTH = 640

/**
 * Answers the app's read of the user's links with these links, read again on every request so a test
 * can unlink by emptying the list
 */
async function answerLinksWith(page: Page, accountIds: () => string[]): Promise<void> {
  await page.route(`${API_BASE_URL}/bank-sync/links`, (route) => route.fulfill({
    json: accountIds().map((accountId) => ({
      account_id: accountId,
      connection_id: 'connection',
      provider: 'simplefin',
      provider_name: 'SimpleFIN',
      external_account_id: 'bank-account',
      external_account_name: 'Chequing',
      institution_name: 'Example Bank',
      import_start: IMPORT_START,
      linked_at: `${IMPORT_START}T12:00:00Z`,
      import: null,
      history_reminder: null,
      last_success_at: null,
      last_attempt: null,
      next_attempt_at: null,
      waiting_on_budget: false,
      sync_in_progress: false,
      action_needed: null,
      waiting_new_count: 0,
      review_warning: false,
      paused: false,
      balance: null,
    })),
  }))
}

/**
 * Answers the app's reads of one transaction as imported from the bank, since nothing links an
 * account on the server for a sync to import one
 */
async function answerAsBankImported(page: Page, transactionId: string): Promise<void> {
  const isTransactionRead = (url: URL) =>
    url.href.startsWith(`${API_BASE_URL}/transactions?`) || url.href === `${API_BASE_URL}/transactions/${transactionId}`
  await page.route(isTransactionRead, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback()

    const response = await route.fetch()
    const body = await response.json() as { id: string } | { id: string }[]
    const markImported = (transaction: { id: string }) =>
      transaction.id === transactionId ? { ...transaction, bank_source: BANK_SOURCE } : transaction
    await route.fulfill({ response, json: Array.isArray(body) ? body.map(markImported) : markImported(body) })
  })
}

async function getBox(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('the element has no box on screen')
  return box
}

/**
 * Types a date into the modal's date field and leaves the field, as a user does. The field moves on
 * by itself as each part fills, and clicking Notes leaves it, since Tab from the day stops on the
 * field's own calendar button first
 */
async function typeDate(page: Page, dialog: Locator, date: string): Promise<void> {
  await dialog.getByRole('group', { name: 'Date' }).getByRole('textbox', { name: 'Year' }).click()
  await page.keyboard.type(date.replaceAll('-', ''))
  await dialog.getByLabel('Notes').click()
}

test('refuses a new manual entry on the days a linked account’s bank supplies', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await answerLinksWith(page, () => [account.id])
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
  const date = dialog.getByRole('group', { name: 'Date' })
  const currency = dialog.getByRole('combobox', { name: 'Currency' })
  const amount = dialog.getByRole('textbox', { name: 'Amount', exact: true })
  const details = dialog.getByText('Details', { exact: true })

  // Measured from the section's heading, since the dialog recentres as it grows and can land the
  // fields on a different part of a pixel, so the rows count as unmoved within one pixel
  const fieldTops = async () => {
    const headingTop = (await getBox(details)).y
    return Promise.all([date, currency, amount].map(async (field) => (await getBox(field)).y - headingTop))
  }
  const isUnmoved = (tops: number[], before: number[]) => tops.every((top, index) => Math.abs(top - before[index]) < 1)
  const topsBefore = await fieldTops()

  // Today is the last day the bank supplies
  await typeDate(page, dialog, todayInTestTimezone())
  const message = dialog.getByRole('alert').filter({ hasText: SUPPLIED_DAYS_MESSAGE })
  await expect(message).toBeVisible()
  const year = date.getByRole('textbox', { name: 'Year' })
  await expect(year).toHaveAttribute('aria-invalid', 'true')
  await expect(year).toHaveAccessibleDescription(SUPPLIED_DAYS_MESSAGE)

  // Under the date on a phone, and under the whole row once the fields sit side by side, so Date,
  // Currency and Amount stay where they were. Read once the message has finished opening
  if (page.viewportSize()!.width >= FIELD_ROW_MIN_WIDTH) {
    await expect.poll(async () => {
      const [dateBox, amountBox, messageBox] = await Promise.all([date, amount, message].map(getBox))
      return {
        unmoved: isUnmoved(await fieldTops(), topsBefore),
        underTheRow: messageBox.y >= amountBox.y + amountBox.height,
        acrossTheRow: Math.round(messageBox.x) === Math.round(dateBox.x)
          && Math.round(messageBox.x + messageBox.width) === Math.round(amountBox.x + amountBox.width),
      }
    }).toEqual({ unmoved: true, underTheRow: true, acrossTheRow: true })
  } else {
    await expect.poll(async () => {
      const [dateBox, currencyBox, messageBox] = await Promise.all([date, currency, message].map(getBox))
      return messageBox.y >= dateBox.y + dateBox.height && currencyBox.y >= messageBox.y + messageBox.height
    }).toBe(true)
  }

  // The calendar refuses today, and a later day the bank can't have supplied yet is taken
  await dialog.getByRole('button', { name: 'Open calendar' }).click()
  const todayCell = page.getByRole('button').and(page.locator(`[data-iso="${todayInTestTimezone()}"]`))
  const tomorrowCell = page.getByRole('button').and(page.locator(`[data-iso="${daysFromTodayInTestTimezone(1)}"]`))
  await expect(todayCell).toHaveAttribute('aria-disabled', 'true')
  await expect(tomorrowCell).not.toHaveAttribute('aria-disabled', 'true')
  await tomorrowCell.click()
  await expect(message).toBeHidden()
  await expect(year).toHaveAttribute('aria-invalid', 'false')
})

test('lets an edit keep a date the linked account’s bank supplies, and refuses moving it to another such day', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
    date: '2026-01-15',
  })
  await answerLinksWith(page, () => [account.id])
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const row = page.getByTestId(`transaction-row-${id}`)
  const dialog = page.getByRole('dialog', { name: 'Edit Transaction', exact: true })
  const message = dialog.getByRole('alert').filter({ hasText: SUPPLIED_DAYS_MESSAGE })

  // Changing only the notes dates nothing anew, so it saves where the transaction already sits
  await row.click()
  await dialog.getByLabel('Notes').fill('Receipt checked')
  const notesSaved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH')
  await dialog.getByTestId('transaction-submit').click()
  expect((await notesSaved).status()).toBe(200)
  await expect(dialog).toBeHidden()

  // Every save sent from here on, so one the browser refused would show up ahead of the one it let through
  const sentDates: unknown[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions/${id}` && sent.method() === 'PATCH') sentDates.push(sent.postDataJSON().dt)
  })

  await row.click()
  await typeDate(page, dialog, '2026-01-16')
  await expect(message).toBeVisible()
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeVisible()

  // The day before the import start is the user's own to fill
  await typeDate(page, dialog, '2025-12-31')
  await expect(message).toBeHidden()
  const dateSaved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH')
  await dialog.getByTestId('transaction-submit').click()
  expect((await dateSaved).status()).toBe(200)
  await expect(dialog).toBeHidden()
  expect(sentDates).toEqual(['2025-12-31'])
})

test('keeps a bank transaction in its linked account, refusing the move on the account field', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createAccount(request, user, { name: 'Savings' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4250,
    date: '2026-01-15',
  })
  await answerLinksWith(page, () => [account.id])
  await answerAsBankImported(page, id)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const dialog = page.getByRole('dialog', { name: 'Edit Transaction', exact: true })
  const refusal = dialog.getByRole('alert').filter({ hasText: MOVE_REFUSAL })

  const sentDates: unknown[] = []
  page.on('request', (sent) => {
    if (sent.url() === `${API_BASE_URL}/transactions/${id}` && sent.method() === 'PATCH') sentDates.push(sent.postDataJSON().dt)
  })

  // The bank's own date is the bank's to correct, so another day it supplies is taken
  await page.getByTestId(`transaction-row-${id}`).click()
  await typeDate(page, dialog, '2026-01-16')

  // Leaving the account is refused on its field, and a save sends nothing
  await chooseFromDropdown(dialog, 'Account', 'Savings')
  await expect(refusal).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Account' })).toHaveAttribute('aria-invalid', 'true')
  await dialog.getByTestId('transaction-submit').click()
  await expect(dialog).toBeVisible()

  await chooseFromDropdown(dialog, 'Account', 'Everyday')
  await expect(refusal).toBeHidden()
  const saved = page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/transactions/${id}` && response.request().method() === 'PATCH')
  await dialog.getByTestId('transaction-submit').click()
  expect((await saved).status()).toBe(200)
  await expect(dialog).toBeHidden()
  expect(sentDates).toEqual(['2026-01-16'])
})

test('greys out Archive with its reason while the account is linked, and offers it again once unlinked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  let linkedAccountIds = [account.id]
  await answerLinksWith(page, () => linkedAccountIds)
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)

  const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
  const archive = dialog.getByRole('switch', { name: /^Archive account/ })
  const warning = dialog.getByText('Balance will be set to zero')
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  await expect(archive).toHaveAttribute('aria-disabled', 'true')
  await expect(archive).toHaveAccessibleDescription(ARCHIVE_LINKED_REASON)

  // Pointing at the row shows the reason beside it, and pressing it leaves the account as it is
  const row = dialog.getByText('Archive account', { exact: true })
  await row.hover()
  await expect(page.getByText(ARCHIVE_LINKED_REASON).filter({ visible: true })).toHaveCSS('opacity', '1')

  // Forced, because the switch is marked unavailable and pressing it anyway is what is checked
  await row.click({ force: true })
  await expect(archive).not.toBeChecked()
  await expect(warning).toBeHidden()

  // Deleting offers archiving instead, which is unavailable for the same reason
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click()
  const archiveInstead = dialog.getByRole('button', { name: 'Archive instead', exact: true })
  await expect(archiveInstead).toHaveAttribute('aria-disabled', 'true')
  await expect(archiveInstead).toHaveAccessibleDescription(ARCHIVE_LINKED_REASON)

  // The app keeps what it last read across a reload, so this load starts without that copy and reads
  // the list afresh, as it does once unlinking refreshes it
  linkedAccountIds = []
  await page.addInitScript(() => localStorage.removeItem('lumina:query-cache'))
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  await expect(archive).not.toHaveAttribute('aria-disabled')
  await dialog.getByText('Archive account', { exact: true }).click()
  await expect(archive).toBeChecked()
  await expect(warning).toBeVisible()
})
