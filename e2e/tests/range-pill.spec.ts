import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: it sets the widths it checks itself, opening each page wide and then narrowing it

/**
 * Guards the range pill that the dashboard widgets and the account cards show on a narrow page. Its
 * glass floats over the page so its list can open across the content below, and the slot holding its
 * place used to be measured once, while a page opened wider was hiding the pill. Narrowing the window
 * then left the slot at almost no height, and the pill covered the figure below it. The Insights pill
 * on a wide page had the same one-time measurement of its width
 */

const PAGES = [
  // Opened wider than every card's breakpoint: the balance card's 750px and the spending cards' 1200px
  { name: 'an account page', wide: 1280, pills: ['Balance range', 'Spending range', 'Merchant range'] },
  { name: 'the dashboard', wide: 1024, pills: ['Breakdown range', 'Spending range'] },
] as const

/**
 * How far the space each pill holds in the layout reaches below the bottom of its glass. Below zero, the
 * pill covers what follows it by that much
 */
async function measureClearances(page: Page, pills: readonly string[]): Promise<number[]> {
  return Promise.all(pills.map(async (name) => {
    const head = page.getByRole('button', { name: new RegExp(`^${name}: `) }).filter({ visible: true })
    await expect(head).toHaveCount(1)
    return head.evaluate((node) => {
      const glass = node.parentElement!.getBoundingClientRect()
      const slot = node.parentElement!.parentElement!.getBoundingClientRect()
      return Math.round(slot.bottom - glass.bottom)
    })
  }))
}

for (const { name, wide, pills } of PAGES) {
  test(`keeps each range pill clear of what follows it on ${name} narrowed after a wide load`, async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 1000 })
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -1000,
      date: daysFromTodayInTestTimezone(-1),
    })
    await logInViaApi(page, user)
    const path = name === 'the dashboard' ? '/dashboard' : `/accounts/${account.id}`

    // The page opened at the narrow width is the reference: there each pill was showing when measured
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, path)
    const narrow = await measureClearances(page, pills)
    for (const clearance of narrow) expect(clearance).toBeGreaterThanOrEqual(0)

    await page.setViewportSize({ width: wide, height: 900 })
    await openPage(page, path)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect.poll(() => measureClearances(page, pills)).toEqual(narrow)
  })
}

// The Insights pill is sized to its label, and that size used to be measured while a page opened
// narrower was hiding it, so widening the window left a stub that cut off the label, dates and chevron

// The issue's desktop and narrower widths. Crossing the 1050px switch on a rotated tablet shows the
// hidden pill the same way widening a window does, so it isn't checked apart
const DESKTOP = { width: 1280, height: 800 }
const NARROW = { width: 800, height: 900 }

// A saved range whose name is longer than any preset's label
const LONG_RANGE_NAME = 'Household review for the quarter'

type PillState = { width: number; clipped: number[] }

/**
 * The Insights pill on a wide page, which stays in the page while hidden on a narrower one. The narrow
 * page's own pill floats in a layer added after the page, so the wide one comes first
 */
function desktopPill(page: Page) {
  return page.getByRole('button', { name: /^Insights date range: /, includeHidden: true }).first()
}

/** The pill's width, and the overflow of any part of its label, dates or chevron that is cut off */
function readPill(head: Locator): Promise<PillState> {
  return head.evaluate((node) => ({
    width: Math.round(node.parentElement!.getBoundingClientRect().width),
    // An inline box reports no width of its own, so only the boxes that can clip are compared, and each
    // width is rounded on its own, so a line can read a pixel wider than the box it fits
    clipped: [node, ...node.querySelectorAll<HTMLElement>('span')]
      .filter((part) => getComputedStyle(part).display !== 'inline')
      .map((part) => part.scrollWidth - part.clientWidth)
      .filter((overflow) => overflow > 1),
  }))
}

/** Reads the pill once two reads in a row agree, so a width still settling is never taken */
async function readSettledPill(head: Locator): Promise<PillState> {
  let last = await readPill(head)
  await expect.poll(async () => {
    const [previous, next] = [last, last = await readPill(head)]
    return JSON.stringify(previous) === JSON.stringify(next)
  }).toBe(true)
  return last
}

async function signUpWithSpending(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 1000 })
  await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -1000,
    date: daysFromTodayInTestTimezone(-1),
  })
  await logInViaApi(page, user)
  return user
}

/** The pill on a page opened at the desktop width, where it was showing when measured */
async function readFreshPill(page: Page): Promise<PillState> {
  await page.setViewportSize(DESKTOP)
  await openPage(page, '/insights')
  const fresh = await readSettledPill(desktopPill(page))
  expect(fresh.clipped).toEqual([])
  return fresh
}

test.describe('the Insights date-range pill', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('fits its label on a page widened after a narrow load', async ({ page, request }) => {
    await signUpWithSpending(page, request)
    const fresh = await readFreshPill(page)

    await page.setViewportSize(NARROW)
    await openPage(page, '/insights')
    await expect(desktopPill(page)).toBeHidden()
    await page.setViewportSize(DESKTOP)
    await expect.poll(() => readPill(desktopPill(page))).toEqual(fresh)
  })

  test('fits its label after a wide load is narrowed and widened again', async ({ page, request }) => {
    await signUpWithSpending(page, request)
    const fresh = await readFreshPill(page)

    await page.setViewportSize(NARROW)
    await expect(desktopPill(page)).toBeHidden()
    await page.setViewportSize(DESKTOP)
    await expect.poll(() => readPill(desktopPill(page))).toEqual(fresh)
  })

  test('grows to fit a saved range with a long name', async ({ page, request }) => {
    const user = await signUpWithSpending(page, request)
    const saved = await request.post(`${API_BASE_URL}/insights/saved-ranges`, {
      headers: asUser(user),
      data: { name: LONG_RANGE_NAME, amount: 3, unit: 'month', qualifier: 'last' },
    })
    expect(saved.status()).toBe(201)
    const fresh = await readFreshPill(page)

    const head = desktopPill(page)
    await head.click()
    // The page shows one pill at a time, so the open panel's controls are the only ones on it
    await page.getByRole('tab', { name: 'Custom', exact: true }).click()
    await page.getByRole('button', { name: new RegExp(`^${LONG_RANGE_NAME}`) }).click()
    await expect(head).toHaveAccessibleName(`Insights date range: ${LONG_RANGE_NAME}`)
    const grown = await readSettledPill(head)
    expect(grown.clipped).toEqual([])
    expect(grown.width).toBeGreaterThan(fresh.width)
  })
})

// With motion on, the pill used to show its stub width for a few frames on widening and then spring out
// to fit its label, so the first width it shows is read rather than the one it settles at
test('shows the Insights date-range pill at its fitted width from its first frame on widening', async ({ page, request }) => {
  await signUpWithSpending(page, request)
  const fresh = await readFreshPill(page)

  await page.setViewportSize(NARROW)
  await openPage(page, '/insights')
  const head = desktopPill(page)
  await expect(head).toBeHidden()
  // The pill is looked up afresh each frame, since it may be drawn anew once it shows
  const firstShown = page.evaluate(() => new Promise<number>((resolve) => {
    const watch = () => {
      const glass = document.querySelector('button[aria-label^="Insights date range: "]')?.parentElement
      const width = glass && getComputedStyle(glass).visibility === 'visible' ? glass.getBoundingClientRect().width : 0
      if (width > 0) resolve(Math.round(width))
      else requestAnimationFrame(watch)
    }
    requestAnimationFrame(watch)
  }))
  await page.setViewportSize(DESKTOP)
  expect(await firstShown).toBe(fresh.width)
})
