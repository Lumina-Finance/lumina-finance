import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { linkToEmptyBankAccount, reviewBlock, waitForReviewItems, WORKER_RESULT_TIMEOUT_MS } from '../support/bankSync'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC } from '../support/bankSyncServer'
import { API_BASE_URL } from '../support/target'

// The review block and the holds and pending strips under it line up with the list's Upcoming box at
// every width: their icon, title, text, amounts and caret sit where Upcoming keeps its own, and their
// text moves past the checkbox rail with Upcoming's in selection mode.
//
// Everyday links to an empty bank account at Harbour Bank on the fake SimpleFIN Bridge. The bridge sends
// five coffees, a $0.00 card check and a pending ride. Savings, not linked, holds a grocery shop dated tomorrow.

const COFFEES = [1, 2, 3, 4, 5].map((day) => ({ posted: daysFromTodayInTestTimezone(-day), amount: `-1${day}.50`, description: `HARBOUR COFFEE ${day}` }))

// Where Upcoming keeps its parts, from its box's left edge, and from its right edge for the amounts and caret
const ICON_INSET = 12
const TITLE_INSET = 40
const TEXT_INSET = 12
const TEXT_INSET_IN_SELECTION = 52
const RIGHT_INSET = 12
const HEADER_HEIGHT = 40
const ICON_SIZE = 16
const CORNER_RADIUS = 8

type Box = { left: number; right: number; top: number; bottom: number }
type Measured = {
  box: Box
  corner: number
  header: Box
  icon: Box
  title: Box
  caret: Box
  text: Box | null
  amount: Box | null
  lastRow: Box | null
}

async function start(page: Page, request: APIRequestContext): Promise<void> {
  const user = await signUpUser(request)
  const everyday = await createAccount(request, user, { name: 'Everyday' })
  const savings = await createAccount(request, user, { name: 'Savings' })
  await linkToEmptyBankAccount(request, user, {
    accountId: everyday.id,
    startDate: daysFromTodayInTestTimezone(-10),
    transactions: [
      ...COFFEES,
      { posted: daysFromTodayInTestTimezone(-2), amount: '0.00', description: 'CARD CHECK HARBOUR' },
      { pending: true, amount: '-18.00', description: 'UBER TRIP' },
    ],
  })
  await waitForReviewItems(request, user, everyday.id, (items) => items.length === COFFEES.length)
  for (const path of ['/bank-sync/holds', `/bank-sync/pending?account_id=${everyday.id}`]) {
    await expect
      .poll(async () => ((await (await request.get(`${API_BASE_URL}${path}`, { headers: asUser(user) })).json()) as unknown[]).length, {
        timeout: WORKER_RESULT_TIMEOUT_MS,
      })
      .toBe(1)
  }
  await createTransaction(request, user, { accountId: savings.id, categoryName: 'Groceries', amount: -4210, date: daysFromTodayInTestTimezone(1) })
  await logInViaApi(page, user)
}

/**
 * The parts of one box, each as the page draws it. A title or text is measured from its first letter,
 * and an amount to its last, so padding around them doesn't count. The last row is the element its
 * divider and fill span
 */
async function measure(header: Locator, parts: { box: string; text?: string; amount?: string; row?: string }): Promise<Measured> {
  return header.evaluate((button, selectors) => {
    const edges = (rect: DOMRect) => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })
    const letters = (element: Element | null) => {
      if (!element) return null
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if ((node.textContent ?? '').trim() === '') continue
        const range = document.createRange()
        range.selectNodeContents(node)
        return edges(range.getClientRects()[0])
      }
      return null
    }
    const box = button.closest(selectors.box)!
    // Upcoming's box is its shading's layer, since the section itself stops short of the checkbox rail
    const shape = box.matches('.isolate') && box.querySelector(':scope > span') ? box.querySelector(':scope > span')! : box
    const icons = [...button.querySelectorAll('svg')]
    const range = document.createRange()
    const amount = selectors.amount ? box.querySelector(selectors.amount) : null
    if (amount) range.selectNodeContents(amount)
    const rows = selectors.row ? [...box.querySelectorAll(selectors.row)] : []
    return {
      box: edges(shape.getBoundingClientRect()),
      corner: parseFloat(getComputedStyle(shape).borderTopLeftRadius),
      header: edges(button.getBoundingClientRect()),
      icon: edges(icons[0].getBoundingClientRect()),
      title: letters(button.querySelector('h2, .font-medium'))!,
      caret: edges(icons[icons.length - 1].getBoundingClientRect()),
      text: selectors.text ? letters(box.querySelector(selectors.text)) : null,
      amount: amount ? edges(range.getBoundingClientRect()) : null,
      lastRow: rows.length > 0 ? edges(rows[rows.length - 1].getBoundingClientRect()) : null,
    }
  }, parts)
}

/** Waits a frame and then for every transition and animation with an end, so a turning caret is read at rest */
async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve))
    const ending = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)))
  })
}

function expectLinedUp(name: string, measured: Measured, textInset: number, titleInset: number): void {
  const { box } = measured
  expect(measured.icon.left - box.left, `${name} icon`).toBeCloseTo(ICON_INSET, 0)
  expect(measured.title.left - box.left, `${name} title`).toBeCloseTo(titleInset, 0)
  expect(box.right - measured.caret.right, `${name} caret`).toBeCloseTo(RIGHT_INSET, 0)
  expect((measured.icon.top + measured.icon.bottom) / 2 - box.top, `${name} icon height`).toBeCloseTo(HEADER_HEIGHT / 2, 0)
  expect(measured.icon.right - measured.icon.left, `${name} icon width`).toBeCloseTo(ICON_SIZE, 0)
  expect(measured.icon.bottom - measured.icon.top, `${name} icon size`).toBeCloseTo(ICON_SIZE, 0)
  expect(measured.corner, `${name} corners`).toBe(CORNER_RADIUS)
  if (measured.lastRow) {
    expect(measured.lastRow.left, `${name} last row's left edge`).toBeCloseTo(box.left, 0)
    expect(measured.lastRow.right, `${name} last row's right edge`).toBeCloseTo(box.right, 0)
    expect(measured.lastRow.bottom, `${name} last row's bottom edge`).toBeCloseTo(box.bottom, 0)
  }
  if (measured.text) expect(measured.text.left - box.left, `${name} text`).toBeCloseTo(textInset, 0)
  if (measured.amount) expect(box.right - measured.amount.right, `${name} amount`).toBeCloseTo(RIGHT_INSET, 0)
}

test('lines the review block and the holds and pending strips up with the Upcoming box', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  test.setTimeout(120_000)
  await start(page, request)
  await openPage(page, '/transactions')

  const review = reviewBlock(page)
  const reviewCaret = review.getByRole('button', { name: 'Show all 5' })
  const holds = page.getByRole('region', { name: 'Bank holds' }).getByRole('button', { name: /1 hold/ })
  const pending = page.getByRole('region', { name: 'Pending bank transactions' }).getByRole('button', { name: /1 pending/ })
  const upcoming = page.getByRole('button', { name: /^Upcoming/ })
  await expect(reviewCaret).toBeVisible()
  for (const toggle of [holds, pending, upcoming]) {
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  }

  const measureAll = async () => {
    await settle(page)
    return measureBoxes()
  }
  const measureBoxes = async () => ({
    // The review block's header is a row rather than one button, so that row stands for it
    review: await measure(review.locator(':scope > div').first(), {
      box: 'section',
      // A waiting row starts with its category's icon, as a ledger row does, so the icon stands for its text
      text: '[data-testid="review-item-icon"]',
      amount: '[data-testid="review-item-amount"]',
    }),
    // A hold's row is its button, whose fill layer covers it whole. A pending row has no fill
    holds: await measure(holds, { box: 'section', text: 'li p', row: 'li button' }),
    pending: await measure(pending, { box: 'section', text: 'li p', amount: 'li .font-financial', row: 'li > div' }),
    upcoming: await measure(upcoming, { box: '.isolate', text: 'p' }),
  })

  // Every box keeps its parts, icon size and corners where Upcoming keeps its own, its header as tall,
  // and its last row reaching its edges
  const atRest = await measureAll()
  for (const [name, measured] of Object.entries(atRest)) {
    expectLinedUp(name, measured, TEXT_INSET, TITLE_INSET)
    expect(measured.header.bottom - measured.header.top, `${name} header`).toBeCloseTo(HEADER_HEIGHT, 0)
  }

  // In selection mode the titles and text move past the rail together, the icons and amounts stay, and a
  // review row's checkbox sits in the rail as the list's checkboxes do
  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  const reviewTick = review.getByRole('checkbox').first()
  await expect(reviewTick).toBeVisible()
  // The rail eases open, so the measures are read again until it has
  await expect
    .poll(async () => {
      const { upcoming: measured } = await measureAll()
      return measured.title.left - measured.box.left
    })
    .toBeCloseTo(TEXT_INSET_IN_SELECTION, 0)
  const selecting = await measureAll()
  for (const [name, measured] of Object.entries(selecting)) expectLinedUp(name, measured, TEXT_INSET_IN_SELECTION, TEXT_INSET_IN_SELECTION)
  const listTick = page.locator('.app-transaction-row').getByRole('checkbox').first()
  const [reviewTickBox, listTickBox] = [(await reviewTick.boundingBox())!, (await listTick.boundingBox())!]
  expect(reviewTickBox.x + reviewTickBox.width / 2).toBeCloseTo(listTickBox.x + listTickBox.width / 2, 0)
})
