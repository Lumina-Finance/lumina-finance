import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  countLedgerTransactions,
  createAccount,
  createCategory,
  daysFromTodayInTestTimezone,
  listLedgerTransactions,
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
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC, NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { ICON_ALIGNMENT_TOLERANCE_PX, ICON_GAP_PX, measureIconBesideText } from '../support/iconBesideText'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, apart from where the buttons sit and the offer's icon beside its sentence: what
// each press saved is read back through the API, the same at every size

// The rule saves its merchant and category on each waiting item as the item arrives. Approve all adds
// what is saved. After the rule changes the block offers Reapply updated rules, and a press saves the new values.
// Everyday links to an empty bank account on the fake SimpleFIN Bridge. The bridge sends four items:
// three the rule "Cafes" matches and one it doesn't

const MATCHED = 3
const UNMATCHED = 'PARKING METER'

/** The items the bank sends. The one the rule leaves is the newest, so it sits in the block's first row */
function bankItems(): BridgeTransaction[] {
  const cafes = Array.from({ length: MATCHED }, (_, index) => ({
    posted: daysFromTodayInTestTimezone(-3 - index),
    amount: `-${(5 + index).toFixed(2)}`,
    description: `CAFE ${String(index + 1).padStart(2, '0')}`,
  }))
  return [...cafes, { posted: daysFromTodayInTestTimezone(-1), amount: '-20.00', description: UNMATCHED }]
}

async function create(request: APIRequestContext, user: TestUser, path: string, data: Record<string, unknown>) {
  const response = await request.post(`${API_BASE_URL}/${path}`, { headers: asUser(user), data })
  expect(response.status()).toBe(201)
  return ((await response.json()) as { id: string }).id
}

/**
 * Signs up with Everyday linked to the bank above and the rule "Cafes", giving the merchant Corner Cafe
 * and the category Coffee shops to every description containing CAFE, then opens the transactions page
 * once the four items wait
 */
async function start(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const merchantId = await create(request, user, 'merchants', { name: 'Corner Cafe' })
  const categoryId = await createCategory(request, user, { name: 'Coffee shops' })
  const ruleId = await create(request, user, 'import-rules', {
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
  return { user, accountId: everyday.id, ruleId, categoryId }
}

/**
 * Holds the answer to a request, so its press is still running while the page is measured
 *
 * @returns A function that lets the request go on
 */
async function holdRequest(page: Page, pathEnd: string): Promise<() => void> {
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  // Held once, so the route is gone after this press with no unroute racing the held request
  await page.route(
    `**${pathEnd}`,
    async (route) => {
      await released
      await route.continue()
    },
    { times: 1 },
  )
  return release
}

/** How wide the button is before its press and while the press runs, at the pixel */
async function widthsAroundPress(page: Page, button: Locator, pathEnd: string) {
  const release = await holdRequest(page, pathEnd)
  const before = (await button.boundingBox())!.width
  await button.click()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  const during = (await button.boundingBox())!.width
  release()
  return { before, during }
}

const row = (page: Page, description: string) => reviewBlock(page).getByRole('listitem').filter({ hasText: description })

const OFFER = 'Your import rules changed after these items arrived.'

/** Gives the rule "Cafes" a new merchant, Espresso Bar, then opens the transactions page again */
async function changeRule(page: Page, request: APIRequestContext, user: TestUser, ruleId: string) {
  const merchantId = await create(request, user, 'merchants', { name: 'Espresso Bar' })
  const response = await request.patch(`${API_BASE_URL}/import-rules/${ruleId}`, {
    headers: asUser(user),
    data: { merchant_id: merchantId },
  })
  expect(response.status()).toBe(200)
  await openPage(page, '/transactions')
}

test('the rules fill items as they arrive, and Reapply updated rules and Approve all each do their own work', NEEDS_BANK_SYNC, async ({
  page,
  request,
}) => {
  const { user, accountId, ruleId, categoryId } = await start(page, request)

  await test.step('items arrive filled in by the rule, with no offer', async () => {
    await expect(row(page, 'CAFE 01')).toContainText('Corner Cafe · Coffee shops')
    await expect(row(page, UNMATCHED)).toContainText('Needs merchant and category')
    await expect(page.getByText(OFFER)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Approve all', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  await test.step('a changed rule leaves the old values on the rows and offers Reapply updated rules', async () => {
    await changeRule(page, request, user, ruleId)

    await expect(page.getByText(OFFER)).toBeVisible()
    await expect(row(page, 'CAFE 01')).toContainText('Corner Cafe · Coffee shops')
    await expect(page.getByRole('button', { name: 'Approve all', exact: true })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
  })

  await test.step('Reapply updated rules saves the new values and the offer goes', async () => {
    // The button keeps its width while its press runs
    const apply = page.getByRole('button', { name: 'Reapply updated rules', exact: true })
    const widths = await widthsAroundPress(page, apply, '/bank-review/items/apply-rules')
    expect(Math.abs(widths.during - widths.before)).toBeLessThanOrEqual(0.5)

    await expect(page.getByText(`Updated ${MATCHED} waiting items with your import rules.`)).toBeVisible()
    await expect(row(page, 'CAFE 01')).toContainText('Espresso Bar · Coffee shops')
    await expect(page.getByText(OFFER)).toHaveCount(0)
    expect(await countLedgerTransactions(request, user)).toBe(0)
  })

  await test.step('Approve all adds the three filled items and leaves the one the rule does not fill', async () => {
    // The button keeps its width while its press runs
    const approve = page.getByRole('button', { name: 'Approve all', exact: true })
    const widths = await widthsAroundPress(page, approve, '/bank-review/items/approve-all')
    expect(Math.abs(widths.during - widths.before)).toBeLessThanOrEqual(0.5)

    await expect(page.getByText(`Added ${MATCHED} items to your ledger.`)).toBeVisible()
    await expect.poll(() => countLedgerTransactions(request, user)).toBe(MATCHED)

    // What was added carries the merchant and category the press saved on each item
    const ledger = await listLedgerTransactions(request, user)
    expect(ledger.map((row) => [row.merchant_name, row.category_id])).toEqual(
      Array.from({ length: MATCHED }, () => ['Espresso Bar', categoryId]),
    )
    const waiting = (await readReviewItems(request, user, accountId)).map((item) => item.bank.description)
    expect(waiting).toEqual([UNMATCHED])
    await expect(reviewBlock(page).getByRole('listitem')).toHaveCount(1)

    // Nothing left that holds both, so the button says why it is greyed
    const button = page.getByRole('button', { name: 'Approve all', exact: true })
    await expect(button).toHaveAttribute('aria-disabled', 'true')
    // The pointer has rested on the button since the press, so it leaves and comes back, as a hand would
    await page.mouse.move(2, 2)
    await button.hover()
    await expect(
      page
        .getByTestId('disabled-reason-tooltip')
        .filter({ hasText: 'No waiting item is ready to add: each needs a merchant and a category' }),
    ).toBeVisible()
  })

  await test.step('a click and Enter on the greyed button send no request', async () => {
    const button = page.getByRole('button', { name: 'Approve all', exact: true })
    const sent: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/bank-review/items/approve-all')) sent.push(request.url())
    })
    // Playwright waits for a button marked aria-disabled to come on before it clicks, so the click is forced through
    await button.click({ force: true })
    await button.focus()
    await page.keyboard.press('Enter')

    // The list read again after both presses comes after any request they would have sent
    const listAgain = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/bank-review/items'))
    await openPage(page, '/transactions')
    await listAgain
    expect(sent).toEqual([])
  })
})

// The phone's narrow tint is where the offer's link moves under its sentence, so the places are read at every size
test('ends Approve all and the tinted offer where the rows end, with Reapply updated rules as the tint\'s link', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({
  page,
  request,
}) => {
  const { user, ruleId } = await start(page, request)
  await changeRule(page, request, user, ruleId)
  const sentence = page.getByText(OFFER, { exact: true })
  await expect(sentence).toBeVisible()

  // The tinted box holds the icon and a box with the sentence and the link
  const [header, approve, apply, words, tinted, amount] = await Promise.all(
    [
      reviewBlock(page).getByRole('heading', { name: 'Waiting for review' }),
      page.getByRole('button', { name: 'Approve all', exact: true }),
      page.getByRole('button', { name: 'Reapply updated rules', exact: true }),
      sentence,
      sentence.locator('../..'),
      row(page, 'CAFE 01').getByTestId('review-item-amount'),
    ].map(async (part) => (await part.boundingBox())!),
  )
  const right = (box: { x: number; width: number }) => box.x + box.width
  const bottom = (box: { y: number; height: number }) => box.y + box.height
  const INSET = 12

  // An inline link keeps 2px either side of its label for its focus ring
  const LINK_FOCUS_ROOM = 2

  // The icon sits 4px before the sentence's first letter and centres on its capitals, measured from the drawing
  const beside = await measureIconBesideText(sentence.locator('../..').locator('svg'), sentence, 'before')
  expect(Math.abs(beside.offCentre)).toBeLessThanOrEqual(ICON_ALIGNMENT_TOLERANCE_PX)
  expect(Math.abs(beside.gap - ICON_GAP_PX)).toBeLessThanOrEqual(ICON_ALIGNMENT_TOLERANCE_PX)

  expect(approve.y).toBeGreaterThanOrEqual(header.y + header.height)
  expect(Math.abs(right(approve) - right(amount))).toBeLessThanOrEqual(1)
  expect(Math.abs(right(tinted) - right(amount))).toBeLessThanOrEqual(1)

  expect(apply.y).toBeGreaterThanOrEqual(tinted.y)
  expect(bottom(apply)).toBeLessThanOrEqual(bottom(tinted))

  if (page.viewportSize()!.width < 640) {
    // Under the sentence, its label starting where the sentence starts
    expect(apply.y).toBeGreaterThanOrEqual(bottom(words))
    expect(Math.abs(apply.x + LINK_FOCUS_ROOM - words.x)).toBeLessThanOrEqual(0.5)
  } else {
    // After the sentence on its line, its label as far in from the tint's right edge as the icon is from its left
    expect(apply.x).toBeGreaterThanOrEqual(right(words))
    expect(Math.abs(right(tinted) - (right(apply) - LINK_FOCUS_ROOM) - INSET)).toBeLessThanOrEqual(0.5)
    expect(Math.abs(apply.y + apply.height / 2 - (words.y + words.height / 2))).toBeLessThanOrEqual(1)
  }
})

test('an item the rules did not match opens with a link to the rules in Settings', NEEDS_BANK_SYNC, async ({ page, request }) => {
  await start(page, request)

  await reviewBlock(page).getByRole('button', { name: UNMATCHED }).click()
  const dialog = page.getByRole('dialog', { name: 'Review bank item' })

  const link = dialog.getByRole('link', { name: /Open import rules/ })
  await expect(link).toHaveAttribute('href', '/settings#import-rules')
  await expect(link).toHaveAttribute('target', '_blank')
})
