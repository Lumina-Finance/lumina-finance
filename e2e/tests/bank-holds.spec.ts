import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { asUser, createAccount, daysFromTodayInTestTimezone, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { linkToEmptyBankAccount, reviewBlock, waitForReviewItems, WORKER_RESULT_TIMEOUT_MS } from '../support/bankSync'
import { NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the strip lists, how it opens and when a hold is dismissed are the same at every width

// A booked bank record of exactly zero can't be approved or put in the ledger, so it shows in a
// read-only Holds strip under the review block instead of the review block, with a two-press Dismiss
// that stops the same record coming back.
//
// Everyday links to an empty bank account at Harbour Bank on the fake SimpleFIN Bridge. The fake sends a
// $12.50 coffee and a $0.00 card check, and the worker imports them.

const CHECK = 'CARD CHECK HARBOUR'
const COFFEE = 'HARBOUR COFFEE'

type Hold = { id: string; description: string }

/** Signs up with Everyday linked to a bank account that sends a coffee and a $0.00 card check, once both have been read */
async function start(page: Page, request: APIRequestContext): Promise<TestUser> {
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
  return user
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

test('dismisses a hold on the second press and it stays gone after a reload', NEEDS_BANK_SYNC, async ({ page, request }) => {
  const user = await start(page, request)
  await openPage(page, '/transactions')
  await holdsStrip(page).getByRole('button', { name: /1 hold/ }).click()
  const dismiss = holdsStrip(page).getByTestId('bank-hold-dismiss')

  // The first press only asks, and a press elsewhere takes it back
  await dismiss.click()
  await expect(dismiss).toHaveAccessibleName('Yes, dismiss')
  await page.getByRole('heading', { name: 'Transactions' }).first().click()
  await expect(dismiss).toHaveAccessibleName('Dismiss')

  // The second of two presses dismisses it, and the strip leaves with its last hold
  await dismiss.click()
  await dismiss.click()
  await expect(holdsStrip(page)).toHaveCount(0)
  expect(await readHolds(request, user)).toEqual([])

  await openPage(page, '/transactions')
  await expect(holdsStrip(page)).toHaveCount(0)
})
