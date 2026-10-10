/**
 * Guards the bars that pin to the top of a page as it scrolls, against covering the controls and content
 * below them or running under the round menu button the phone layout fixes to the top right
 */
import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop only, apart from the section menu and Shift+Tab tests, which run at every size:
// the pinned bars change with the width. The others set their own sizes

/**
 * How far the right end of a control reaches past the left edge of the phone menu button, while the two
 * share any height on screen. Zero or less means the control stops short of the button
 */
async function overlapWithMenuButton(page: Page, control: Locator): Promise<number> {
  const button = (await page.getByRole('button', { name: 'Open navigation menu' }).boundingBox())!
  const box = (await control.boundingBox())!
  const sharesHeight = box.y < button.y + button.height && box.y + box.height > button.y
  return sharesHeight ? box.x + box.width - button.x : 0
}

test('keeps the pinned settings section menu clear of the menu button just below the wide layout', async ({ page, request }) => {
  const user = await signUpUser(request)
  // The widest window that still shows the phone layout, which some browser zoom levels give
  await page.setViewportSize({ width: 1049, height: 768 })
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  const menu = page.locator('[aria-controls="settings-mobile-section-menu"]')
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect(menu).toBeInViewport()
  await expect.poll(() => overlapWithMenuButton(page, menu)).toBeLessThanOrEqual(-8)
})

/** Resolve once the page has held still for ten frames, so a smooth scroll has come to rest */
async function waitForScrollToRest(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((resolve) => {
    let last = window.scrollY
    let stillFrames = 0
    const tick = () => {
      if (window.scrollY === last) stillFrames += 1
      else stillFrames = 0
      last = window.scrollY
      if (stillFrames >= 10) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
}

test('brings each chosen settings section to rest below the pinned section menu', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  // The section menu pins above the page below the side list's width, and the side list takes its place
  // above it. Found by what it opens, since its name is whichever section is current
  const menu = page.locator('[aria-controls="settings-mobile-section-menu"]')
  const compact = await menu.isVisible()
  const gap = compact ? 16 : 32
  for (const name of ['Security', 'Runway', 'Categories', 'Merchants', 'Tags', 'Tax-Advantaged Categories']) {
    if (compact) {
      await menu.click()
      await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name, exact: true }).click()
    } else {
      await page.getByRole('button', { name, exact: true }).click()
    }

    // Polled, since the smooth scroll may not have started yet. The last sections can't scroll up that
    // far, so they only have to come to rest at the end of the page and still clear the menu
    const heading = page.getByRole('heading', { level: 2, name, exact: true })
    await expect.poll(async () => {
      const top = (await heading.boundingBox())!.y
      const menuBox = compact ? (await menu.boundingBox())! : undefined
      const below = top - (menuBox ? menuBox.y + menuBox.height : 0)
      const atEnd = await page.evaluate(() => Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight)
      return atEnd ? below >= gap - 2 : Math.abs(below - gap) <= 2
    }, { message: name }).toBe(true)
  }
})

for (const { path, placeholder, lastSeeded } of [
  { path: '/transactions', placeholder: 'Search transactions...', lastSeeded: (page: Page) => page.getByTestId(/^transaction-row-/).nth(13) },
  { path: '/accounts', placeholder: 'Search accounts...', lastSeeded: (page: Page) => page.getByText('Pinned bar account 13') },
]) {
  test(`keeps the ${path.slice(1)} search field clear of the menu button while its toolbar nears the top`, async ({ page, request }) => {
    const user = await signUpUser(request)
    // Enough accounts and rows below the toolbar that the page can scroll it up to the top on a small phone
    for (let index = 0; index < 14; index += 1) {
      const account = await createAccount(request, user, { name: `Pinned bar account ${index}`, startingBalance: 1000 })
      await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -500 - index })
    }
    await page.setViewportSize({ width: 390, height: 667 })
    await logInViaApi(page, user)
    await openPage(page, path)
    // The page reaches its full length only once the list has loaded, which the scroll below needs
    await expect(lastSeeded(page)).toBeAttached()

    // Rested with the toolbar just short of docking, where the field used to keep its full width
    const search = page.getByPlaceholder(placeholder)
    const fieldTop = (await search.boundingBox())!.y
    await page.evaluate((by) => window.scrollBy(0, by), fieldTop - 28)
    await expect.poll(async () => (await search.boundingBox())!.y).toBeLessThan(52)
    await expect.poll(() => overlapWithMenuButton(page, search)).toBeLessThanOrEqual(0)
  })
}

/**
 * How far the focused row's top sits below the lowest pinned bar above it, such as the toolbar and the day
 * heading or Upcoming header stuck below it, and whether its bottom is still inside the window
 */
async function focusedRowClearance(page: Page): Promise<{ belowBars: number, bottomInWindow: boolean }> {
  return page.evaluate(() => {
    const row = document.activeElement!.getBoundingClientRect()
    const coveredTo = Math.max(0, ...[...document.querySelectorAll('body *')]
      .filter((element) => getComputedStyle(element).position === 'sticky')
      .map((bar) => bar.getBoundingClientRect())
      .filter((bar) => bar.top < row.top)
      .map((bar) => bar.bottom))
    return { belowBars: row.top - coveredTo, bottomInWindow: row.bottom <= window.innerHeight }
  })
}

for (const { place, date } of [
  { place: 'list', date: undefined },
  { place: 'open Upcoming section', date: daysFromTodayInTestTimezone(3) },
]) {
  test(`scrolls a transaction row in the ${place} reached with Shift+Tab out from under the pinned bars`, AT_EVERY_SIZE, async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Focus account', startingBalance: 1000 })
    // One day's worth of rows, so the rows walked through all sit under the same pinned heading
    for (let index = 0; index < 30; index += 1) {
      await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -100 - index, date })
    }
    // Short enough at every width that the list runs well past the bottom of the window
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 700 })
    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    if (date) {
      // Fully open before the scroll below, or the page can still grow under it and miss the next page of rows
      const upcoming = page.getByRole('button', { name: /Upcoming/ })
      await upcoming.click()
      const body = page.locator(`[id="${await upcoming.getAttribute('aria-controls')}"]`)
      await expect(body).toHaveCSS('opacity', '1')
      await expect(body).toHaveCSS('overflow', 'visible')
    }
    const rows = page.getByTestId(/^transaction-row-/)
    // The second page of rows too, so there is list enough below the 12th row to scroll it up to the bars
    await expect(rows.nth(14)).toBeAttached()
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
    await expect(rows).toHaveCount(30)

    // Rested with the 12th row's top level with the bottom of the bars, so the rows above it are under them
    await rows.nth(11).focus()
    await waitForScrollToRest(page)
    await page.evaluate((by) => window.scrollBy(0, by), (await focusedRowClearance(page)).belowBars)
    await waitForScrollToRest(page)

    for (const row of [rows.nth(10), rows.nth(9)]) {
      await page.keyboard.press('Shift+Tab')
      await expect(row).toBeFocused()
      await waitForScrollToRest(page)
      const clearance = await focusedRowClearance(page)
      expect(clearance.belowBars).toBeGreaterThanOrEqual(0)
      expect(clearance.bottomInWindow).toBe(true)
    }

    // A row already clear of the bars leaves the page where it is
    const restingAt = await page.evaluate(() => window.scrollY)
    await page.keyboard.press('Tab')
    await expect(rows.nth(10)).toBeFocused()
    await waitForScrollToRest(page)
    expect(await page.evaluate(() => window.scrollY)).toBe(restingAt)
  })
}
