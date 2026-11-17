import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { linkToEmptyBankAccount, reviewBlock, waitForReviewItems, WORKER_RESULT_TIMEOUT_MS } from '../support/bankSync'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// What the strip lists and how it opens are the same at every width, so that runs on desktop only. A
// hold's card runs at every size, since its dialogue fills the screen on narrower ones

// A booked bank record of exactly zero can't be approved or put in the ledger, so it shows in a
// read-only Holds strip under the review block instead of the review block, for awareness only.
//
// Everyday links to an empty bank account at Harbour Bank on the fake SimpleFIN Bridge. The fake sends a
// $12.50 coffee and a $0.00 card check, and the worker imports them.

const CHECK = 'CARD CHECK HARBOUR'
const COFFEE = 'HARBOUR COFFEE'

type Hold = { id: string; description: string }

/** Signs up with Everyday linked to a bank account that sends a coffee and a $0.00 card check, once both have been read */
async function start(page: Page, request: APIRequestContext): Promise<void> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [
      { posted: daysFromTodayInTestTimezone(-3), amount: '-12.50', description: COFFEE },
      { posted: daysFromTodayInTestTimezone(-2), amount: '0.00', description: CHECK },
    ],
  })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === 1)
  await expect.poll(async () => (await readHolds(request, user)).length, { timeout: WORKER_RESULT_TIMEOUT_MS }).toBe(1)
  await logInViaApi(page, user)
}

/** The holds the server lists for the user's accounts */
async function readHolds(request: APIRequestContext, user: TestUser): Promise<Hold[]> {
  const response = await request.get(`${API_BASE_URL}/bank-sync/holds`, { headers: asUser(user) })
  expect(response.status()).toBe(200)
  return (await response.json()) as Hold[]
}

function holdsStrip(page: Page) {
  return page.getByRole('region', { name: 'Bank holds' })
}

test('lists a $0 record as a hold, closed to start, and keeps it out of review', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await start(page, request)
  await openPage(page, '/transactions')

  // The coffee waits for review and the card check does not
  await expect(reviewBlock(page).getByRole('button', { name: COFFEE })).toBeVisible()
  await expect(reviewBlock(page).getByText(CHECK)).toHaveCount(0)

  // The strip is closed, counting its one hold, and opens to the merchant and date with no amount
  const toggle = holdsStrip(page).getByRole('button', { name: /1 hold/ })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(holdsStrip(page).getByText(CHECK)).toHaveCount(0)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(holdsStrip(page).getByText(CHECK)).toBeVisible()
})

test("opens a hold's filing card from its row, with the bank's fields, and closes it back to the row", AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  await start(page, request)
  await openPage(page, '/transactions')
  await holdsStrip(page).getByRole('button', { name: /1 hold/ }).click()

  const row = holdsStrip(page).getByRole('button', { name: new RegExp(CHECK) })
  await row.click()

  // The card names the institution and bank account the hold came from and that it is a hold, then
  // lists what the provider sent, its text under Note alone, as a transaction's card shows it. The fake
  // bank names no merchant, and SimpleFIN's note is its text
  const dialog = page.getByRole('dialog', { name: 'Bank hold' })
  const card = dialog.getByRole('region', { name: 'SimpleFIN filing card' })
  await expect(card).toBeVisible()
  await expect(card).toContainText('Harbour Bank')
  await expect(card).toContainText('Everyday Chequing')
  await expect(card).toContainText('Hold')
  const fields = await card.locator('dt').evaluateAll((labels) => labels.map((label) => [label.textContent, label.nextElementSibling?.textContent]))
  expect(fields.map(([label]) => label)).toEqual(['Merchant', 'Amount', 'Date', 'Received', 'Note'])
  expect(Object.fromEntries(fields)).toMatchObject({ Merchant: '—', Amount: '$0.00', Note: CHECK })

  // The card floats alone, at every size: the dialogue draws no panel and shows no title around it
  expect(
    await dialog.evaluate((node) => {
      const style = getComputedStyle(node)
      return [style.backgroundColor, style.borderTopWidth, style.boxShadow]
    }),
  ).toEqual(['rgba(0, 0, 0, 0)', '0px', 'none'])
  await expect(dialog.getByRole('heading', { name: 'Bank hold' })).toHaveClass(/\bsr-only\b/)

  // A tap beside the card closes it, as Escape does, and either hands focus back to the row it opened from
  await page.mouse.click(4, 4)
  await expect(dialog).toBeHidden()
  await expect(row).toBeFocused()
  await row.click()
  await expect(card).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(row).toBeFocused()
})
