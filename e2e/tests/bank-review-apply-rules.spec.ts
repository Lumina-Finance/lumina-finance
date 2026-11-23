import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import {
  asUser,
  countLedgerTransactions,
  createAccount,
  createCategory,
  daysFromTodayInTestTimezone,
  signUpUser,
  type TestUser,
} from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import {
  linkToEmptyBankAccount,
  readReviewItems,
  reviewBlock,
  waitForReviewItems,
  type BridgeTransaction,
} from '../support/bankSync'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what a press of Apply rules saved is read back through the API, the same at every size

// Apply rules adds every waiting new item an import rule gives a merchant and a category to the ledger
// at once. Everyday links to an empty bank account on the fake SimpleFIN Bridge. The bridge sends
// fourteen items: twelve the rule "Cafes" matches and two it doesn't

const MATCHED = 12
const UNMATCHED = ['PARKING METER', 'BOOKSHOP']

/** The items the bank sends. The two the rule leaves are the newest, so they sit in the block's first rows */
function bankItems(): BridgeTransaction[] {
  const cafes = Array.from({ length: MATCHED }, (_, index) => ({
    posted: daysFromTodayInTestTimezone(-3 - (index % 6)),
    amount: `-${(5 + index).toFixed(2)}`,
    description: `CAFE ${String(index + 1).padStart(2, '0')}`,
  }))
  const others = UNMATCHED.map((description, index) => ({
    posted: daysFromTodayInTestTimezone(-1 - index),
    amount: '-20.00',
    description,
  }))
  return [...cafes, ...others]
}

async function create(request: APIRequestContext, user: TestUser, path: string, data: Record<string, unknown>) {
  const response = await request.post(`${API_BASE_URL}/${path}`, { headers: asUser(user), data })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

/**
 * Signs up with Everyday linked to the bank above and the rule "Cafes", giving a merchant and a
 * category to every description containing CAFE, then opens the transactions page
 */
async function start(page: Page, request: APIRequestContext): Promise<{ user: TestUser; accountId: string }> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const merchantId = await create(request, user, 'merchants', { name: 'Corner Cafe' })
  const categoryId = await createCategory(request, user, { name: 'Coffee shops' })
  await create(request, user, 'import-rules', {
    name: 'Cafes',
    match: 'all',
    tag_ids: [],
    conditions: [{ kind: 'condition', attribute: 'description', operator: 'contains', value: 'CAFE' }],
    merchant_id: merchantId,
    category_id: categoryId,
  })
  const items = bankItems()
  await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: items,
  })
  await waitForReviewItems(request, user, everyday.id, (waiting) => waiting.length === items.length)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  return { user, accountId: everyday.id }
}

test('Apply rules adds the twelve items a rule fills in and leaves the two it does not', async ({ page, request }) => {
  const { user, accountId } = await start(page, request)
  expect(await countLedgerTransactions(request, user)).toBe(0)

  await page.getByRole('button', { name: 'Apply rules', exact: true }).click()

  await expect(page.getByText(`Added ${MATCHED} items to your ledger.`)).toBeVisible()
  await expect.poll(() => countLedgerTransactions(request, user)).toBe(MATCHED)
  const waiting = (await readReviewItems(request, user, accountId)).map((item) => item.bank.description)
  expect(waiting.sort()).toEqual([...UNMATCHED].sort())
  await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(UNMATCHED.length)

  // Nothing left for the rules to add, so the button says why it is greyed
  const button = page.getByRole('button', { name: 'Apply rules', exact: true })
  await expect(button).toHaveAttribute('aria-disabled', 'true')
  // The pointer has rested on the button since the press, so it leaves and comes back, as a hand would
  await page.mouse.move(2, 2)
  await button.hover()
  await expect(
    page.getByTestId('disabled-reason-tooltip').filter({ hasText: 'No waiting item matches your import rules' }),
  ).toBeVisible()
})

test("an item the rules did not match opens with a link to the rules in Settings", async ({ page, request }) => {
  await start(page, request)

  await reviewBlock(page).getByRole('button', { name: 'PARKING METER' }).click()
  const dialog = page.getByRole('dialog', { name: 'Review bank item' })

  const link = dialog.getByRole('link', { name: /Open import rules/ })
  await expect(link).toHaveAttribute('href', '/settings#import-rules')
  await expect(link).toHaveAttribute('target', '_blank')
})
