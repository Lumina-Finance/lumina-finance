import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, signUpUser, todayInTestTimezone, type TestUser } from '../support/api'
import { logInViaApi } from '../support/app'
import {
  addBridgeTransactions,
  addImportedItem,
  changeBridgeTransaction,
  linkToEmptyBankAccount,
  openBankLink,
  readTransaction,
  waitForReviewItems,
  WORKER_RESULT_TIMEOUT_MS,
} from '../support/bankSync'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from the one-line and failed save tests (these run at every size): the
// choices have to fit on one line, and the save message moves above the actions, on a phone

// Review settings in a linked account's Bank link section choose whether each kind of bank
// data waits for review or is applied as it arrives. The account links to an empty bank account on
// the fake SimpleFIN Bridge, and the worker syncs it there. Which presets the saved choices open on
// and the dialogue's wording are covered by its unit tests, and the routes' refusals, a save leaving
// the items already waiting alone, choices kept through an unlink and two saves at once by the
// backend route tests
const ROWS = [
  ['New transactions', 'Still need a merchant and category before they are added'],
  ['Corrections', 'The bank changes the date, amount or description'],
  ['Removals', 'The bank reports a transaction as removed'],
] as const
const SAVE_FAILED = 'Oops, something went wrong. Please try again.'

// Whatever the status reads, the import running or over
const ANY_STATUS = /.+\./

// The sm breakpoint, from which the footer sets a failed save's message in the row of its actions
const SM_MIN_WIDTH = 640

type Choices = { new_transactions: string; corrections: string; removals: string }

type Setup = { user: TestUser; accountId: string; section: Locator }

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

/** Signs up with Everyday linked to an empty bank account from today, and opens its Bank link section */
async function start(page: Page, request: APIRequestContext): Promise<Setup> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToEmptyBankAccount(request, user, { accountId: account.id, startDate: todayInTestTimezone() })
  await logInViaApi(page, user)
  return { user, accountId: account.id, section: await openBankLink(page, account.id, ANY_STATUS) }
}

/** Reads the account's choices as the server holds them */
async function readChoices(request: APIRequestContext, user: TestUser, accountId: string): Promise<Choices> {
  const response = await request.get(`${API_BASE_URL}/accounts/${accountId}/review-preferences`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return (await response.json()) as Choices
}

/** Opens Review settings from the Bank link section, once it has read the saved choices */
async function openReviewSettings(page: Page, section: Locator): Promise<Locator> {
  await section.getByRole('button', { name: 'Review settings' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review settings' })
  await expect(dialog.getByRole('tablist', { name: 'Review preset' }).getByRole('tab', { selected: true })).toHaveCount(1)
  return dialog
}

function preset(dialog: Locator, name: 'Review all' | 'Auto-approve all' | 'Custom'): Locator {
  return dialog.getByRole('tablist', { name: 'Review preset' }).getByRole('tab', { name, exact: true })
}

function decision(dialog: Locator, kind: string, name: 'Review' | 'Auto-approve'): Locator {
  return dialog.getByRole('tablist', { name: kind, exact: true }).getByRole('tab', { name, exact: true })
}

function saved(page: Page, accountId: string) {
  return page.waitForResponse((response) =>
    response.url() === `${API_BASE_URL}/accounts/${accountId}/review-preferences` && response.request().method() === 'PUT')
}

/** Checks the text reads on one line */
async function expectOneLine(text: Locator): Promise<void> {
  const [box, lineHeight] = await Promise.all([text.boundingBox(), text.evaluate((element) => parseFloat(getComputedStyle(element).lineHeight))])
  expect(box!.height).toBeLessThan(lineHeight * 1.5)
}

/**
 * Checks a failed save's message sits level with Save from the sm breakpoint, wrapping in the room the
 * actions leave it, and on a phone reads on one line in the row of its own it takes above them
 */
async function expectBesideSave(page: Page, dialog: Locator, message: Locator): Promise<void> {
  if (page.viewportSize()!.width < SM_MIN_WIDTH) {
    await expectOneLine(message)
    return
  }
  const [messageBox, saveBox] = await Promise.all([message.boundingBox(), dialog.getByRole('button', { name: 'Save' }).boundingBox()])
  expect(messageBox!.y).toBeLessThan(saveBox!.y + saveBox!.height)
  expect(messageBox!.y + messageBox!.height).toBeGreaterThan(saveBox!.y)
}

test('opens a newly linked account on Review all, each preset on one line', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { section } = await start(page, request)
  const dialog = await openReviewSettings(page, section)

  await expect(dialog.getByText('Bank sync', { exact: true })).toBeVisible()
  await expect(preset(dialog, 'Review all')).toHaveAttribute('aria-selected', 'true')
  for (const [, description] of ROWS) await expect(dialog.getByText(description)).toBeHidden()

  // On a phone too
  for (const name of ['Review all', 'Auto-approve all', 'Custom'] as const) await expectOneLine(preset(dialog, name).getByText(name, { exact: true }))
})

test('saves Custom with only corrections auto-approved, each choice on one line, and reopens on Custom with its three rows', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, accountId, section } = await start(page, request)
  let dialog = await openReviewSettings(page, section)

  await preset(dialog, 'Custom').click()
  for (const [kind, description] of ROWS) {
    await expect(dialog.getByText(description)).toBeVisible()
    await expect(decision(dialog, kind, 'Review')).toHaveAttribute('aria-selected', 'true')

    // Beside the description from the sm breakpoint, and under it on a phone
    await expectOneLine(decision(dialog, kind, 'Auto-approve').getByText('Auto-approve', { exact: true }))
  }
  await decision(dialog, 'Corrections', 'Auto-approve').click()
  const response = saved(page, accountId)
  await dialog.getByRole('button', { name: 'Save' }).click()

  expect((await response).status()).toBe(200)
  await expect(dialog).toBeHidden()
  await expect(section.getByRole('button', { name: 'Review settings' })).toBeFocused()
  expect(await readChoices(request, user, accountId)).toEqual({ new_transactions: 'review', corrections: 'trust', removals: 'review' })

  dialog = await openReviewSettings(page, section)
  await expect(preset(dialog, 'Custom')).toHaveAttribute('aria-selected', 'true')
  await expect(decision(dialog, 'New transactions', 'Review')).toHaveAttribute('aria-selected', 'true')
  await expect(decision(dialog, 'Corrections', 'Auto-approve')).toHaveAttribute('aria-selected', 'true')
  await expect(decision(dialog, 'Removals', 'Review')).toHaveAttribute('aria-selected', 'true')
})

test('reopens on Auto-approve all once Custom sets all three to Auto-approve, keeping the rows open until then', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, accountId, section } = await start(page, request)
  let dialog = await openReviewSettings(page, section)

  await preset(dialog, 'Custom').click()
  for (const [kind] of ROWS) await decision(dialog, kind, 'Auto-approve').click()

  // The rows stay open under the pointer as the last one comes to match the others
  await expect(preset(dialog, 'Custom')).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByText(ROWS[2][1])).toBeVisible()
  const response = saved(page, accountId)
  await dialog.getByRole('button', { name: 'Save' }).click()
  expect((await response).status()).toBe(200)
  await expect(dialog).toBeHidden()
  expect(await readChoices(request, user, accountId)).toEqual({ new_transactions: 'trust', corrections: 'trust', removals: 'trust' })

  dialog = await openReviewSettings(page, section)
  await expect(preset(dialog, 'Auto-approve all')).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByText(ROWS[2][1])).toBeHidden()
})

test('keeps Custom and its rows open when a row change leaves a saved mix all alike', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, accountId, section } = await start(page, request)
  const stored = await request.put(`${API_BASE_URL}/accounts/${accountId}/review-preferences`, {
    headers: asUser(user),
    data: { new_transactions: 'review', corrections: 'trust', removals: 'review' },
  })
  expect(stored.status()).toBe(200)
  const dialog = await openReviewSettings(page, section)
  await expect(preset(dialog, 'Custom')).toHaveAttribute('aria-selected', 'true')

  await decision(dialog, 'Corrections', 'Review').click()

  await expect(decision(dialog, 'Corrections', 'Review')).toHaveAttribute('aria-selected', 'true')
  await expect(preset(dialog, 'Custom')).toHaveAttribute('aria-selected', 'true')
  for (const [, description] of ROWS) await expect(dialog.getByText(description)).toBeVisible()
})

test('discards the choice on Cancel, saving nothing, with focus back on Review settings', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, accountId, section } = await start(page, request)
  const sent: string[] = []
  page.on('request', (sentRequest) => {
    if (sentRequest.url().endsWith('/review-preferences') && sentRequest.method() === 'PUT') sent.push(sentRequest.url())
  })
  let dialog = await openReviewSettings(page, section)

  await preset(dialog, 'Auto-approve all').click()
  await expect(preset(dialog, 'Auto-approve all')).toHaveAttribute('aria-selected', 'true')
  await dialog.getByRole('button', { name: 'Cancel' }).click()

  await expect(dialog).toBeHidden()
  await expect(section.getByRole('button', { name: 'Review settings' })).toBeFocused()
  dialog = await openReviewSettings(page, section)
  await expect(preset(dialog, 'Review all')).toHaveAttribute('aria-selected', 'true')
  expect(sent).toEqual([])
  expect(await readChoices(request, user, accountId)).toEqual({ new_transactions: 'review', corrections: 'review', removals: 'review' })
})

test('keeps the dialog and the choice when the save fails, saying so beside the actions', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, accountId, section } = await start(page, request)
  const dialog = await openReviewSettings(page, section)
  await page.route(`${API_BASE_URL}/accounts/${accountId}/review-preferences`, (route) =>
    route.request().method() === 'PUT' ? route.abort('failed') : route.fallback())

  await preset(dialog, 'Auto-approve all').click()
  await dialog.getByRole('button', { name: 'Save' }).click()

  const failure = dialog.getByRole('alert').filter({ hasText: SAVE_FAILED })
  await expect(failure).toBeVisible()
  await expectBesideSave(page, dialog, failure)
  await expect(preset(dialog, 'Auto-approve all')).toHaveAttribute('aria-selected', 'true')
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeEnabled()
  expect(await readChoices(request, user, accountId)).toEqual({ new_transactions: 'review', corrections: 'review', removals: 'review' })
})

test('says why the server refused the save, beside the actions, keeping the dialog and the choice', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { accountId, section } = await start(page, request)
  const dialog = await openReviewSettings(page, section)
  await page.route(`${API_BASE_URL}/accounts/${accountId}/review-preferences`, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({ status: 404, json: { detail: 'Account not found' } })
      : route.fallback())

  await preset(dialog, 'Auto-approve all').click()
  await dialog.getByRole('button', { name: 'Save' }).click()

  const refusal = dialog.getByRole('alert').filter({ hasText: 'Account not found' })
  await expect(refusal).toHaveText('Account not found')
  await expectBesideSave(page, dialog, refusal)
  await expect(preset(dialog, 'Auto-approve all')).toHaveAttribute('aria-selected', 'true')
})

test('applies a bank correction under Auto-approve all without a review item, while a new bank transaction still waits', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const { scenario, externalAccountId } = await linkToEmptyBankAccount(request, user, {
    accountId: account.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [{ id: 'TRN-COFFEE', posted: daysFromTodayInTestTimezone(-3), amount: '-4.50', description: 'HARBOUR COFFEE' }],
  })
  const { id } = await addImportedItem(request, user, account.id, 'HARBOUR COFFEE')
  await logInViaApi(page, user)
  const section = await openBankLink(page, account.id, ANY_STATUS)

  const dialog = await openReviewSettings(page, section)
  await preset(dialog, 'Auto-approve all').click()
  const response = saved(page, account.id)
  await dialog.getByRole('button', { name: 'Save' }).click()
  expect((await response).status()).toBe(200)
  await expect(dialog).toBeHidden()

  // The bank corrects the coffee the user accepted and hasn't edited, and sends a new transaction
  await changeBridgeTransaction(request, scenario.id, externalAccountId, 'TRN-COFFEE', { amount: '-5.25' })
  await addBridgeTransactions(request, scenario.id, externalAccountId, [
    { posted: daysFromTodayInTestTimezone(-1), amount: '-12.00', description: 'CORNER BAKERY' },
  ])
  const syncNow = section.getByRole('button', { name: 'Sync now' })
  await expect(syncNow).not.toHaveAttribute('aria-disabled', 'true', { timeout: WORKER_RESULT_TIMEOUT_MS })
  await syncNow.click()

  // The new transaction waits for its merchant and category, and the correction is applied without one
  const waiting = await waitForReviewItems(request, user, account.id, (items) => items.some((item) => item.bank.description === 'CORNER BAKERY'))
  expect(waiting.map((item) => [item.kind, item.bank.description])).toEqual([['new', 'CORNER BAKERY']])
  await expect.poll(async () => (await readTransaction(request, user, id)).amount, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(-525)
})
