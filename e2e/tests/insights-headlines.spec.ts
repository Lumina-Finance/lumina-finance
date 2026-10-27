/**
 * The Net cash flow headline once wrapped a very large total at phone width, leaving its minus sign
 * alone on the line above the amount. The Period Glance headline, which shares its fitting, once ran
 * past its panel's right edge at phone width with a very large total, and its Income and Expenses
 * figures were cut off at the panel's edge with a very large amount. The Net cash flow and Period
 * Glance headlines also showed a very large total at full size for a frame on first load before
 * shrinking it to fit, and the Period Glance headline did the same after a range change. A window
 * narrowed under a fitted headline could also show it running past its panel for a frame. The Income
 * and Expenses figures also ran past their half of the panel at 360px wide and narrower
 */
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { expectSignedIn, logIn } from '../support/app'
import { card, matchesApi, navigate } from '../support/insights'

// Runs on desktop only: each case sets the width it checks itself

const PHONE = { width: 390, height: 844 }

// A common Android width, narrower than the two halves of the Income and Expenses row can fit the
// longest amount in, so the figures stack and keep their full size
const SMALL_PHONE = { width: 360, height: 800 }
const DESKTOP = { width: 1280, height: 800 }

// The size the Net cash flow headline takes whenever its total fits, `text-3xl`
const FULL_FONT_SIZE_PX = 30

// The Period Glance headline's full size, `text-5xl`, and the smallest it once shrank to, `text-3xl`,
// which a desktop has always had room for
const PERIOD_GLANCE_FULL_FONT_SIZE_PX = 48
const PERIOD_GLANCE_DESKTOP_MIN_FONT_SIZE_PX = 30

const CASES = [
  { name: 'a very large negative total on a phone', currency: 'IQD', categoryName: 'Groceries', minorUnits: -1_246_913_569_001, text: /^−IQD\s1,246,913,569\.001$/, viewport: PHONE, fullSize: false },
  { name: 'an ordinary negative total on a phone', currency: 'CAD', categoryName: 'Groceries', minorUnits: -520_000, text: /^−\S*\$5,200\.00$/, viewport: PHONE, fullSize: true },
  { name: 'a very large positive total on a phone', currency: 'IQD', categoryName: 'Salary', minorUnits: 1_246_913_569_001, text: /^\+IQD\s1,246,913,569\.001$/, viewport: PHONE, fullSize: false },
  { name: 'a very large negative total on a desktop', currency: 'IQD', categoryName: 'Groceries', minorUnits: -1_246_913_569_001, text: /^−IQD\s1,246,913,569\.001$/, viewport: DESKTOP, fullSize: true },
]

/**
 * Reads how many lines a headline takes and whether it runs past its own width, once the font the
 * headline is fitted in has loaded
 */
async function measureHeadline(page: Page, headline: Locator) {
  await expect(headline).toBeVisible()
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return headline.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const lineTops = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
    // The text's fractional width against the element's, since scrollWidth and clientWidth are whole
    // pixels and can't see a text running under a pixel past its right edge
    const overflowPx = range.getBoundingClientRect().width - element.getBoundingClientRect().width
    return { lines: lineTops.size, overflows: overflowPx > 0.01 }
  })
}

/**
 * Reads a headline's font size once the font it is fitted in has loaded. The fitting refits the
 * headline as soon as the font arrives, so a size read sooner can belong to the fallback font
 */
async function readSettledFontSize(page: Page, headline: Locator) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
  return headline.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))
}

for (const example of CASES) {
  test(`net cash flow headline stays on one line for ${example.name}`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: example.currency })
    const account = await createAccount(request, user, { name: 'Cash flow headline account', currency: example.currency })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: example.categoryName, amount: example.minorUnits, currency: example.currency,
    })
    await page.setViewportSize(example.viewport)
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    // The card loads once it is scrolled into view
    const cashFlow = card(page, 1)
    await cashFlow.scrollIntoViewIfNeeded()

    // A paragraph, so an axis label with the same text can't match
    const headline = cashFlow.getByRole('paragraph').filter({ hasText: example.text })
    await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })

    if (example.fullSize) {
      expect(await readSettledFontSize(page, headline)).toBe(FULL_FONT_SIZE_PX)
    }
  })
}

// A balance the account opens with, which is not cash flow, so the Net worth card's "Ending Net
// Worth" figure differs from the Period Glance headline. The signed net worth changes can't match
// either, since the starting balance is part of what the net worth changed by
const PERIOD_GLANCE_STARTING_BALANCE = 100_000

// The headline is income minus expenses. Each pair differs from its headline, so neither the Income
// nor the Expenses figure can match the headline's text. The smallest size each headline may settle
// at is its full size where the amount fits, and the old smallest size on a desktop
const PERIOD_GLANCE_CASES = [
  { name: 'a very large total on a phone', currency: 'IQD', income: 1_246_913_569_002, expense: 1, text: /^\+IQD\s1,246,913,569\.001$/, viewport: PHONE, minFontSizePx: undefined },
  { name: 'a very large overspend on a phone', currency: 'IQD', income: 1, expense: 1_246_913_569_002, text: /^−IQD\s1,246,913,569\.001$/, viewport: PHONE, minFontSizePx: undefined },
  { name: 'an ordinary total on a phone', currency: 'CAD', income: 525_000, expense: 5_000, text: /^\+(CA)?\$5,200\.00$/, viewport: PHONE, minFontSizePx: PERIOD_GLANCE_FULL_FONT_SIZE_PX },
  { name: 'a very large total on a desktop', currency: 'IQD', income: 1_246_913_569_002, expense: 1, text: /^\+IQD\s1,246,913,569\.001$/, viewport: DESKTOP, minFontSizePx: PERIOD_GLANCE_DESKTOP_MIN_FONT_SIZE_PX },
]

// The Income and Expenses figures' full size, `text-lg`, which an ordinary amount keeps
const PERIOD_GLANCE_FIGURE_FULL_FONT_SIZE_PX = 18

// Where the Period Glance panel moves its figures beside the headline instead of under it
const PERIOD_GLANCE_SPLIT = { width: 750, height: 1024 }

// The headline is income minus expenses, and differs from both figures in each case, so it can't
// match either figure's text. `fullSize` says whether both figures keep their full size or shrink
// below it. A 1280px desktop lays the panel out as the split does, so the split stands for it
const PERIOD_GLANCE_FIGURE_CASES = [
  { name: 'very large amounts on a phone', currency: 'IQD', income: 1_246_913_569_002, expense: 1_246_913_569_001, incomeText: /^IQD\s1,246,913,569\.002$/, expensesText: /^IQD\s1,246,913,569\.001$/, viewport: PHONE, fullSize: false },
  { name: 'very large expenses beside ordinary income on a phone', currency: 'IQD', income: 5_000, expense: 1_246_913_569_001, incomeText: /^IQD\s5\.000$/, expensesText: /^IQD\s1,246,913,569\.001$/, viewport: PHONE, fullSize: false },
  { name: 'very large amounts on a small phone', currency: 'IQD', income: 1_246_913_569_002, expense: 1_246_913_569_001, incomeText: /^IQD\s1,246,913,569\.002$/, expensesText: /^IQD\s1,246,913,569\.001$/, viewport: SMALL_PHONE, fullSize: true },
  { name: 'ordinary amounts on a phone', currency: 'CAD', income: 125_000, expense: 5_000, incomeText: /^(CA)?\$1,250\.00$/, expensesText: /^(CA)?\$50\.00$/, viewport: PHONE, fullSize: true },
  { name: 'very large amounts where the panel splits', currency: 'IQD', income: 1_246_913_569_002, expense: 1_246_913_569_001, incomeText: /^IQD\s1,246,913,569\.002$/, expensesText: /^IQD\s1,246,913,569\.001$/, viewport: PERIOD_GLANCE_SPLIT, fullSize: true },
]

for (const example of PERIOD_GLANCE_FIGURE_CASES) {
  test(`period glance income and expenses fit their panel at one shared size for ${example.name}`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: example.currency })
    const account = await createAccount(request, user, { name: 'Period glance figures account', currency: example.currency })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Salary', amount: example.income, currency: example.currency,
    })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Groceries', amount: -example.expense, currency: example.currency,
    })
    await page.setViewportSize(example.viewport)
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    // The card has no heading role, so it is found by its section holding the title
    const glance = page.locator('section').filter({ hasText: 'This period at a glance' })
    const income = glance.getByRole('paragraph').filter({ hasText: example.incomeText })
    const expenses = glance.getByRole('paragraph').filter({ hasText: example.expensesText })
    await expect.poll(() => measureHeadline(page, income)).toEqual({ lines: 1, overflows: false })
    await expect.poll(() => measureHeadline(page, expenses)).toEqual({ lines: 1, overflows: false })

    const incomeSize = await readSettledFontSize(page, income)
    expect(await readSettledFontSize(page, expenses)).toBe(incomeSize)
    if (example.fullSize) expect(incomeSize).toBe(PERIOD_GLANCE_FIGURE_FULL_FONT_SIZE_PX)
    else expect(incomeSize).toBeLessThan(PERIOD_GLANCE_FIGURE_FULL_FONT_SIZE_PX)
  })
}

for (const example of PERIOD_GLANCE_CASES) {
  test(`period glance headline fits its panel on one line for ${example.name}`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: example.currency })
    const account = await createAccount(request, user, {
      name: 'Period glance headline account', currency: example.currency, startingBalance: PERIOD_GLANCE_STARTING_BALANCE,
    })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Salary', amount: example.income, currency: example.currency,
    })
    await createTransaction(request, user, {
      accountId: account.id, categoryName: 'Groceries', amount: -example.expense, currency: example.currency,
    })
    await page.setViewportSize(example.viewport)
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    const headline = periodGlance(page).getByRole('paragraph').filter({ hasText: example.text })
    await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })

    if (example.minFontSizePx !== undefined) {
      expect(await readSettledFontSize(page, headline)).toBeGreaterThanOrEqual(example.minFontSizePx)
    }
  })
}

test('net cash flow headline is fitted when its card recovers from a failed first load', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, { name: 'Cash flow recovery account', currency: 'IQD' })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -12_469_135_690_010, currency: 'IQD',
  })
  // The card's first load fails, so its headline mounts for the first time on recovery. Its text then
  // differs from what the card held while failed, and nothing has been measured yet
  let failLoad = true
  await page.route((url) => matchesApi(url.href, '/insights/cash-flow'), async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    if (failLoad) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Synthetic failure' }) })
    }
    return route.continue()
  })
  await page.setViewportSize(PHONE)
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  const cashFlow = card(page, 1)
  await cashFlow.scrollIntoViewIfNeeded()
  const text = /^−IQD\s12,469,135,690\.010$/
  const headline = cashFlow.getByRole('paragraph').filter({ hasText: text })
  await expect(cashFlow.getByRole('heading', { name: 'Cash flow could not load', exact: true })).toBeVisible()
  await expect(headline).toHaveCount(0)

  // The card recovers without a reload when the connection comes back. The headline's element is new
  // and the fitting has measured none before it, so only the element appearing tells it to measure,
  // and no frame may show the total at full size before it does
  const readFrames = await recordFrames(page, text, 'cashFlow')
  failLoad = false
  await page.context().setOffline(true)
  await page.context().setOffline(false)
  await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })
  expect(await readSettledFontSize(page, headline)).toBeLessThan(FULL_FONT_SIZE_PX)
  const frames = await readFrames()
  expect(frames.length).toBeGreaterThan(0)
  expect(frames.filter((frame) => frame.size >= FULL_FONT_SIZE_PX)).toEqual([])
})

type FrameSample = { size: number; overflows: boolean; windowWidth: number }

// Both headlines read an amount that moved over the same period, so a total reads the same in each.
// A paragraph is told apart by the card holding it
type HeadlineOwner = 'periodGlance' | 'cashFlow'
const OWNER_TITLES = {
  periodGlance: { has: 'This period at a glance', lacks: 'Net cash flow' },
  cashFlow: { has: 'Net cash flow', lacks: 'This period at a glance' },
} as const

/**
 * Finds the Period Glance card by its title, so its headline is not confused with the Net cash flow
 * headline that reads the same total
 */
function periodGlance(page: Page): Locator {
  return page.locator('section').filter({ hasText: 'This period at a glance' })
}

/**
 * Records the font size of each paragraph reading `text`, whether it runs past its own width, and the
 * window's width, in every frame from now on in which it shows on screen. Each frame is read in its
 * animation frame callback, which runs after every task and layout effect that changed the page since
 * the last frame and before the frame is drawn, so it reads exactly what that frame paints. A read
 * after the paint would also see what an effect running after the paint had changed, and miss a
 * frame drawn before that effect
 * @returns A reader for the frames recorded so far
 */
async function recordFrames(page: Page, text: RegExp, owner: HeadlineOwner) {
  const key = `frames:${owner}:${text.source}`
  const { has, lacks } = OWNER_TITLES[owner]
  await page.evaluate(({ key, source, flags, has, lacks }) => {
    const pattern = new RegExp(source, flags)
    const frames: FrameSample[] = []
    Object.assign(window, { [key]: frames })

    // The two headlines read the same total, so the paragraph is told apart by the card it is in:
    // some ancestor holds the owner's title and none of those holding it holds the other's
    function belongsToOwner(element: Element) {
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const content = ancestor.textContent ?? ''
        if (content.includes(has) && !content.includes(lacks)) return true
      }
      return false
    }
    function sample() {
      for (const element of document.querySelectorAll('p')) {
        const box = element.getBoundingClientRect()
        const onScreen = box.width > 0 && box.bottom > 0 && box.top < window.innerHeight
        if (onScreen && pattern.test(element.textContent ?? '') && belongsToOwner(element)) {
          const range = document.createRange()
          range.selectNodeContents(element)
          frames.push({
            size: parseFloat(getComputedStyle(element).fontSize),
            overflows: range.getBoundingClientRect().width - box.width > 0.01,
            windowWidth: window.innerWidth,
          })
        }
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, { key, source: text.source, flags: text.flags, has, lacks })
  return () => page.evaluate((key) => (window as unknown as Record<string, FrameSample[]>)[key], key)
}

/**
 * Collects every error the open page reports from now on, a resize observer's undelivered
 * notifications included, which reach only the window's error event
 * @returns A reader for the errors collected so far
 */
async function collectPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.evaluate(() => {
    const windowErrors: string[] = []
    Object.assign(window, { windowErrors })
    window.addEventListener('error', (event) => windowErrors.push(event.message))
  })
  return async () => [
    ...errors,
    ...await page.evaluate(() => (window as unknown as { windowErrors: string[] }).windowErrors),
  ]
}

/**
 * Loads the figures' font for `text` before a headline first shows it. A headline drawn in the
 * fallback font while the real one loads is fitted to the fallback's width, which the fitting
 * can't know ahead of the font, so those frames would read as a size other than the settled one
 */
async function loadFigureFont(page: Page, text: string) {
  await page.evaluate(async (text) => {
    const probe = document.createElement('span')
    probe.className = 'font-financial'
    document.body.append(probe)
    const { fontFamily } = getComputedStyle(probe)
    probe.remove()
    await document.fonts.load(`1rem ${fontFamily}`, text)
  }, text)
}

/**
 * Waits for a headline to fit, then checks that no frame showed it larger than the size it settled
 * at, and that it settled below `fullSizePx`, so the frames read were ones the fitting had to shrink
 */
async function expectNoFrameAboveSettledSize(
  page: Page,
  headline: Locator,
  readFrames: () => Promise<FrameSample[]>,
  fullSizePx: number,
) {
  await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })
  const settled = await readSettledFontSize(page, headline)
  expect(settled).toBeLessThan(fullSizePx)
  const sizes = (await readFrames()).map((frame) => frame.size)
  expect(sizes.length).toBeGreaterThan(0)
  expect(sizes.filter((size) => size > settled)).toEqual([])
}

// The Period Glance and Net cash flow headlines for one very large income, which read the same total
// in the same way. The Income figure and the account's ending balance each differ from them, so
// neither can match, and each test finds a headline inside its own card
const LARGE_PERIOD_GLANCE_TEXT = /^\+IQD\s1,246,913,569\.001$/
const LARGE_NET_CASH_FLOW_TEXT = /^\+IQD\s1,246,913,569\.001$/

/**
 * Signs up a user whose only income this month is very large, so both headlines read it
 */
async function signUpWithLargeTotal(request: APIRequestContext) {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, {
    name: 'Large total account', currency: 'IQD', startingBalance: PERIOD_GLANCE_STARTING_BALANCE,
  })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Salary', amount: 1_246_913_569_002, currency: 'IQD',
  })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -1, currency: 'IQD',
  })
  return user
}

test('headlines show a very large total at its fitted size from the first frame on a phone', async ({ page, request }) => {
  const user = await signUpWithLargeTotal(request)
  await page.setViewportSize(PHONE)
  await logIn(page, user)
  await expectSignedIn(page)
  await loadFigureFont(page, '+IQD 1,246,913,569.001')

  const readPeriodGlanceFrames = await recordFrames(page, LARGE_PERIOD_GLANCE_TEXT, 'periodGlance')
  const readNetCashFlowFrames = await recordFrames(page, LARGE_NET_CASH_FLOW_TEXT, 'cashFlow')
  await navigate(page, 'Insights')

  await expectNoFrameAboveSettledSize(
    page,
    periodGlance(page).getByRole('paragraph').filter({ hasText: LARGE_PERIOD_GLANCE_TEXT }),
    readPeriodGlanceFrames,
    PERIOD_GLANCE_FULL_FONT_SIZE_PX,
  )

  // The card loads once it is scrolled into view
  const cashFlow = card(page, 1)
  await cashFlow.scrollIntoViewIfNeeded()
  await expectNoFrameAboveSettledSize(
    page,
    cashFlow.getByRole('paragraph').filter({ hasText: LARGE_NET_CASH_FLOW_TEXT }),
    readNetCashFlowFrames,
    FULL_FONT_SIZE_PX,
  )
})

test('period glance headline stays inside its panel in every frame and raises no errors as the window narrows to a phone', async ({ page, request }) => {
  const user = await signUpWithLargeTotal(request)
  await page.setViewportSize(DESKTOP)
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  const headline = periodGlance(page).getByRole('paragraph').filter({ hasText: LARGE_PERIOD_GLANCE_TEXT })
  await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })
  const desktopSize = await readSettledFontSize(page, headline)

  const readFrames = await recordFrames(page, LARGE_PERIOD_GLANCE_TEXT, 'periodGlance')
  // A refit that resizes what a resize observer watches, inside its own callback, reports an error
  const readErrors = await collectPageErrors(page)
  await page.setViewportSize(PHONE)
  await expect.poll(() => measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })

  // The phone's panel is narrower, so the headline had to shrink in the frames read
  expect(await readSettledFontSize(page, headline)).toBeLessThan(desktopSize)
  expect(await readErrors()).toEqual([])
  const frames = await readFrames()
  expect(frames.filter((frame) => frame.windowWidth === PHONE.width).length).toBeGreaterThan(0)
  expect(frames.filter((frame) => frame.overflows)).toEqual([])
})

test('period glance headline shrinks a very large total without a full-size frame after a range change on a phone', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, {
    name: 'Range change account', currency: 'IQD', startingBalance: PERIOD_GLANCE_STARTING_BALANCE,
  })

  // This month's total is IQD 5.001, and the last 90 days add an income from before this month,
  // since no month is 45 days long
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Salary', amount: 6_001, currency: 'IQD',
  })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -1_000, currency: 'IQD',
  })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Salary', amount: 1_246_913_564_000, currency: 'IQD', date: daysFromTodayInTestTimezone(-45),
  })
  await page.setViewportSize(PHONE)
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  const shortHeadline = periodGlance(page).getByRole('paragraph').filter({ hasText: /^\+IQD\s5\.001$/ })
  await expect.poll(() => measureHeadline(page, shortHeadline)).toEqual({ lines: 1, overflows: false })
  expect(await readSettledFontSize(page, shortHeadline)).toBe(PERIOD_GLANCE_FULL_FONT_SIZE_PX)

  const readFrames = await recordFrames(page, LARGE_PERIOD_GLANCE_TEXT, 'periodGlance')
  await page.getByRole('button', { name: /^Insights date range: / }).filter({ visible: true }).click()
  await page.getByRole('tab', { name: '90D', exact: true }).filter({ visible: true }).click()

  await expectNoFrameAboveSettledSize(
    page,
    periodGlance(page).getByRole('paragraph').filter({ hasText: LARGE_PERIOD_GLANCE_TEXT }),
    readFrames,
    PERIOD_GLANCE_FULL_FONT_SIZE_PX,
  )
})

/**
 * Scrolls each Insights card down to the given one into view in turn, which is when it asks for its data,
 * and returns once every one of those cards has its response and none is still loading. A card is reported
 * in view a frame after the scroll, so two frames pass before the next scroll
 * @param page - Insights page
 * @param last - The last card to load, which has the others above it
 * @param responses - The cards' responses, watched from before the app opened since a card asks for its
 * data as soon as it is reported in view
 */
async function loadCardsUpTo(page: Page, last: Locator, responses: Promise<unknown>[]) {
  const reportedInView = () => page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
  // Each card sits in a box of the page's column of cards, and the cards above are that box's earlier siblings
  const box = last.locator('xpath=ancestor::div[parent::*[contains(@class, "space-y-4")]]')
  // The page's cards render once the page's code has loaded, and a list of locators is read at once
  await expect(box).toHaveCount(1)
  const wrappers = [...await box.locator('xpath=preceding-sibling::div').all(), box]
  for (const wrapper of wrappers) {
    await wrapper.scrollIntoViewIfNeeded()
    await reportedInView()
  }
  await Promise.all(responses)
  await expect(page.getByRole('status', {
    name: /^Loading (period at a glance|fund flow|income and expense breakdown|net worth|cash flow)$/,
  })).toHaveCount(0)
}

test('net cash flow calculation tooltip is drawn over the chart below it', async ({ page, request }) => {
  const user = await signUpWithLargeTotal(request)
  await page.setViewportSize(DESKTOP)
  // Watched from before signing in, since the Dashboard asks for some of them first and the Insights card
  // then reuses what it loaded
  const responses = ['period-glance', 'fund-flow', 'income-expense-breakdown', 'net-worth', 'cash-flow'].map(
    (path) => page.waitForResponse((response) => matchesApi(response.url(), `/insights/${path}`) && response.ok()),
  )
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  // Every card above the trigger grows when its data arrives, which moves the trigger down the page, so
  // the trigger is centred only once they have all loaded
  const cashFlow = card(page, 1)
  await loadCardsUpTo(page, cashFlow, responses)

  const trigger = cashFlow.getByRole('button', { name: 'Net cash flow calculation', exact: true })
  // Centred, so the viewport's lower edge leaves the panel room to open below. A trigger left at that
  // edge makes the panel open above it instead, which is right but not what this test covers
  await trigger.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  await trigger.hover()
  const tooltip = trigger.locator('xpath=..').getByRole('tooltip')
  await expect(tooltip).toBeVisible()

  // The panel opens below its trigger, since the card's top leaves it no room above, so the chart
  // that follows the headline is under it. Points across the panel must hit the panel, not the chart
  const [panelBox, amountBox] = await Promise.all([
    tooltip.boundingBox(),
    cashFlow.getByRole('paragraph').filter({ hasText: LARGE_NET_CASH_FLOW_TEXT }).boundingBox(),
  ])
  expect(panelBox!.y + panelBox!.height).toBeGreaterThan(amountBox!.y + amountBox!.height)
  const covered = await tooltip.evaluate((panel) => {
    const box = panel.getBoundingClientRect()
    const points = [0.15, 0.5, 0.85].flatMap((x) => [0.15, 0.5, 0.85].map((y) => [
      box.left + box.width * x,
      box.top + box.height * y,
    ]))
    return points.map(([x, y]) => panel.contains(document.elementFromPoint(x, y)))
  })
  expect(covered).toEqual(Array(9).fill(true))
})

test('headlines refit to the figures font when it arrives after they are drawn', async ({ page, request }) => {
  const user = await signUpWithLargeTotal(request)
  await page.setViewportSize(PHONE)

  // Holds the figures' font file until released, so the headline is first drawn and fitted in the
  // fallback font
  let releaseFont = () => {}
  const fontHeld = new Promise<void>((resolve) => { releaseFont = resolve })
  await page.route(/space-grotesk.*\.woff2/, async (route) => {
    await fontHeld
    await route.continue()
  })
  const headline = periodGlance(page).getByRole('paragraph').filter({ hasText: LARGE_PERIOD_GLANCE_TEXT })
  try {
    await logIn(page, user)
    await expectSignedIn(page)
    await navigate(page, 'Insights')

    await expect(headline).toBeVisible()
    expect(await page.evaluate(() => document.fonts.status)).toBe('loading')
  } finally {
    // However the test got here, the held request must not stay pending
    releaseFont()
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined))

  // Fitted to the container, the text's own width is the container's whole width
  await expect.poll(() => headline.evaluate((element) => {
    const container = element.parentElement as HTMLElement
    const previousWidth = element.style.width
    element.style.width = 'max-content'
    const textWidth = element.getBoundingClientRect().width
    element.style.width = previousWidth
    return textWidth / container.getBoundingClientRect().width
  })).toBeGreaterThan(0.97)
  expect(await measureHeadline(page, headline)).toEqual({ lines: 1, overflows: false })
})

// Two 16-digit amounts, IQD 8,888,888,888,888.000 of income and IQD 7,777,777,777,777.000 of
// expenses, which no type size fits inside their half of the panel at phone width, so each reads in
// millions to one decimal place: the income rounded down and the expenses up. Their difference fits
// the headline
const HUGE_INCOME = 8_888_888_888_888_000
const HUGE_EXPENSE = 7_777_777_777_777_000
const HUGE_INCOME_FULL = /^IQD\s8,888,888,888,888\.000$/
const HUGE_INCOME_COMPACT = /^≈IQD\s8,888,888\.8M$/
const HUGE_EXPENSE_FULL =/^IQD\s7,777,777,777,777\.000$/
const HUGE_EXPENSE_COMPACT = /^≈IQD\s7,777,777\.8M$/

test('period glance income and expenses of 16 digits read in millions inside their panel on a phone, with the full amount kept', async ({ page, request }) => {
  const user = await signUpUser(request, { baseCurrency: 'IQD' })
  const account = await createAccount(request, user, { name: 'Huge total account', currency: 'IQD' })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Salary', amount: HUGE_INCOME, currency: 'IQD',
  })
  await createTransaction(request, user, {
    accountId: account.id, categoryName: 'Groceries', amount: -HUGE_EXPENSE, currency: 'IQD',
  })
  await page.setViewportSize(PHONE)
  await logIn(page, user)
  await expectSignedIn(page)
  await navigate(page, 'Insights')

  // Screen readers read each amount's full form instead of the short form
  const compactFigure = (full: RegExp) => periodGlance(page).locator('p', { has: page.locator('.sr-only', { hasText: full }) })
  const amounts = [
    { figure: compactFigure(HUGE_INCOME_FULL), full: HUGE_INCOME_FULL, compact: HUGE_INCOME_COMPACT },
    { figure: compactFigure(HUGE_EXPENSE_FULL), full: HUGE_EXPENSE_FULL, compact: HUGE_EXPENSE_COMPACT },
  ]
  for (const { figure, full, compact } of amounts) {
    await expect(figure.locator('[aria-hidden="true"]')).toHaveText(compact)
    await expect(figure.locator('.sr-only')).toHaveText(full)
    // The screen-reader text is clipped off screen, so only the short form is measured
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    await expect.poll(() => figure.evaluate((element) => {
      const shown = element.querySelector('[aria-hidden="true"]')!.getBoundingClientRect()
      const box = element.getBoundingClientRect()
      return shown.right - box.right <= 0.01 && shown.left >= box.left - 0.01 && shown.height < box.height * 1.5
    })).toBe(true)
  }

  // The full amount opens from the info icon beside the label, by keyboard as well as by hover
  // (reached with the Tab key from the icon before it, since the tooltip opens on keyboard focus only)
  await periodGlance(page).getByRole('button', { name: 'Income calculation', exact: true }).focus()
  await page.keyboard.press('Tab')
  const incomeInFull = periodGlance(page).getByRole('button', { name: 'Income in full', exact: true })
  await expect(incomeInFull).toBeFocused()
  const incomeTooltip = incomeInFull.locator('xpath=..').getByRole('tooltip')
  await expect(incomeTooltip).toBeVisible()
  await expect(incomeTooltip).toHaveCSS('opacity', '1')
  await expect(incomeTooltip).toHaveText(HUGE_INCOME_FULL)

  // A window resize that changes the form fades the new one in, in each direction
  // (the attribute clears when its animation ends, so the changes are recorded as they happen)
  await page.evaluate(() => {
    const swaps: string[] = []
    Object.assign(window, { fitSwaps: swaps })
    new MutationObserver((records) => {
      for (const record of records) {
        const value = (record.target as Element).getAttribute('data-fit-swap')
        if (value) swaps.push(value)
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['data-fit-swap'], subtree: true })
  })
  const recordedSwaps = () => page.evaluate(() => (window as unknown as { fitSwaps: string[] }).fitSwaps)
  await page.setViewportSize(DESKTOP)
  await expect.poll(recordedSwaps).toContain('to-full')
  await page.setViewportSize(PHONE)
  await expect.poll(recordedSwaps).toContain('to-compact')
  // The fade plays out and leaves the figure fully opaque, and the attribute clears with it
  const compactIncome = compactFigure(HUGE_INCOME_FULL)
  await expect.poll(() => compactIncome.evaluate((element) => element.getAnimations().length)).toBe(0)
  await expect(compactIncome).not.toHaveAttribute('data-fit-swap', /./)
  await expect(compactIncome).toHaveCSS('opacity', '1')
})
