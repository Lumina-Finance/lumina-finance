/**
 * The merchant distribution card narrows to the categories chosen in its filter while the merchant
 * ranking card beside it stays unfiltered, and clearing the filter brings every merchant back
 */
import { expect, test, type Locator } from '@playwright/test'

import { asUser, createAccount, createTransaction, findReferenceId, signUpUser } from '../support/api'
import { expectSignedIn, logInViaApi, openPage } from '../support/app'
import { card, matchesApi } from '../support/insights'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the filter's request and the two cards' rows are the same at every size

test('the category filter narrows the merchant map but not the merchant ranking', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Merchant filter account' })
  const names = { groceries: 'Filter Grocer', dining: 'Filter Diner' }
  for (const name of Object.values(names)) {
    const response = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name } })
    expect(response.status()).toBe(201)
  }
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', merchantName: names.groceries, amount: -30000 })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', merchantName: names.dining, amount: -20000 })
  const diningId = await findReferenceId(request, user, 'categories', 'Dining')

  await logInViaApi(page, user)
  await openPage(page, '/insights')
  await expectSignedIn(page)
  const distribution = card(page, 3)
  const ranking = card(page, 4)
  // The merchant cards load only once scrolled into view
  await distribution.scrollIntoViewIfNeeded()
  await expect(distribution.getByText(names.groceries)).toBeVisible()
  await expect(distribution.getByText(names.dining)).toBeVisible()
  await expect(ranking.getByText(names.groceries)).toBeVisible()

  await distribution.getByRole('button', { name: 'Merchant category filter' }).click()
  await page.getByRole('checkbox', { name: 'Dining' }).click()
  const filtered = page.waitForRequest((candidate) => matchesApi(candidate.url(), '/insights/merchants')
    && new URL(candidate.url()).searchParams.getAll('category_id').join() === diningId)
  await page.getByRole('button', { name: 'Apply filter' }).click()
  await filtered

  await expect(distribution.getByText(names.dining)).toBeVisible()
  await expect(distribution.getByText(names.groceries)).toHaveCount(0)
  await expect(ranking.getByText(names.groceries)).toBeVisible()
  await expect(ranking.getByText(names.dining)).toBeVisible()

  await distribution.getByRole('button', { name: 'Clear filter' }).click()
  await expect(distribution.getByText(names.groceries)).toBeVisible()
  await expect(distribution.getByText(names.dining)).toBeVisible()
})

// The open filter panel is never covered by, and never shows, the page's floating range selector, and
// the reason on a disabled Clear all never covers the line above it. Each size is set on the desktop
// project, since the layouts depend on the window and not on the device
const OVERLAP_SIZES = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'phone', width: 390, height: 844 },
] as const

type Box = { left: number; top: number; right: number; bottom: number }

function overlaps(a: Box, b: Box) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function toBox(b: { x: number; y: number; width: number; height: number }): Box {
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }
}

// The box of an element once it has stopped moving, since the reason eases to its place
async function settledBox(locator: Locator): Promise<Box> {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await locator.boundingBox())
    const same = now === last
    last = now
    return same
  }, { intervals: [150] }).toBe(true)
  return toBox((await locator.boundingBox())!)
}

for (const size of OVERLAP_SIZES) {
  test(`the open filter is not covered by the range selector and its reason clears the line above, ${size.name}`, async ({ page, request }) => {
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Filter overlap account' })
    const merchant = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name: 'Overlap Grocer' } })
    expect(merchant.status()).toBe(201)
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', merchantName: 'Overlap Grocer', amount: -30000 })

    await page.setViewportSize({ width: size.width, height: size.height })
    await logInViaApi(page, user)
    await openPage(page, '/insights')
    await expectSignedIn(page)
    const distribution = card(page, 3)
    await distribution.scrollIntoViewIfNeeded()
    await expect(distribution.getByText('Overlap Grocer')).toBeVisible()
    await distribution.evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => window.scrollBy(0, -120))

    const pill = distribution.getByRole('button', { name: 'Merchant category filter' })
    await pill.filter({ visible: true }).first().click()
    const clear = page.getByRole('button', { name: 'Clear all', exact: true })
    await expect(clear).toBeVisible()

    if (size.name !== 'phone') {
      // Scrolls the closed pill under the floating selector, the place where the two meet
      const floatingGlass = () => page.evaluate(() => {
        const el = [...document.querySelectorAll('.app-floating-range')].find((node) => getComputedStyle(node).display !== 'none')
        const b = el?.querySelector('.app-range-glass')?.getBoundingClientRect()
        return { box: b ? { top: b.top, bottom: b.bottom } : null, visibility: el ? getComputedStyle(el).visibility : null }
      })
      const selector = (await floatingGlass()).box
      expect(selector, 'a floating selector is on screen').not.toBeNull()
      const pillTop = (await pill.boundingBox())!.y
      await page.evaluate((delta) => window.scrollBy(0, delta), pillTop - (selector!.top + selector!.bottom) / 2)

      // The selector steps aside once the panel is open, so none of it shows through
      await expect.poll(async () => (await floatingGlass()).visibility).toBe('hidden')

      // Every corner and the middle of the part of the panel on screen answers to the panel
      const covered = await page.evaluate(() => {
        const panel = document.querySelector('button[aria-label="Merchant category filter"]')?.closest('.app-range-glass')
        if (!panel) return ['no panel']
        const b = panel.getBoundingClientRect()
        // Held in from the edge by more than the glass's 20px corner radius, so a corner is inside it
        const left = Math.max(b.left, 0) + 24
        const right = Math.min(b.right, innerWidth) - 24
        const top = Math.max(b.top, 0) + 24
        const bottom = Math.min(b.bottom, innerHeight) - 24
        return [[left, top], [right, top], [left, bottom], [right, bottom], [(left + right) / 2, (top + bottom) / 2]]
          .filter(([x, y]) => !panel.contains(document.elementFromPoint(x, y)))
          .map(([x, y]) => `${Math.round(x)},${Math.round(y)}`)
      })
      expect(covered, 'points on the panel that something else answers').toEqual([])
    }

    // Hover, then keyboard focus: the reason never covers the line above the button
    const line = page.getByText('No filter applied').filter({ visible: true })
    const tooltip = page.getByTestId('disabled-reason-tooltip').filter({ hasText: 'No filter is set' })
    // The wrapper follows the pointer and its inner card carries the move above or below, so the card is
    // the box a reader sees
    const reasonCard = tooltip.locator('.app-cursor-tooltip-flip')
    // Measured once the panel has stopped growing, or the pointer lands where the button no longer is
    const button = await settledBox(clear)
    await page.mouse.move((button.left + button.right) / 2, (button.top + button.bottom) / 2, { steps: 3 })
    await expect(tooltip).toBeVisible()
    const hoverReason = await settledBox(reasonCard)
    const hoverLine = await settledBox(line)
    expect(overlaps(hoverReason, hoverLine), `hover reason ${JSON.stringify(hoverReason)} covers the line ${JSON.stringify(hoverLine)}`).toBe(false)

    await page.mouse.move(2, 2)
    await expect(tooltip).toBeHidden()
    await page.keyboard.press('Shift+Tab')
    await clear.focus()
    await expect(tooltip).toBeVisible()
    const focusReason = await settledBox(reasonCard)
    const focusLine = await settledBox(line)
    expect(overlaps(focusReason, focusLine), `focus reason ${JSON.stringify(focusReason)} covers the line ${JSON.stringify(focusLine)}`).toBe(false)

    // Closing the filter brings the floating selector back, fully opaque, visible and pressable. The
    // first Escape puts away the reason that focus shows and a later one closes the panel or sheet
    await expect(async () => {
      await page.keyboard.press('Escape')
      // The panel keeps its collapsed body in the page, so it counts as closed once the pill says so, and
      // the sheet once its dialog is gone
      if (size.name === 'phone') await expect(page.getByRole('dialog', { name: 'Merchant category filter' })).toHaveCount(0, { timeout: 1500 })
      else await expect(pill.filter({ visible: true }).first()).toHaveAttribute('aria-expanded', 'false', { timeout: 1500 })
    }).toPass({ timeout: 15_000 })
    await expect.poll(async () => {
      const state = await page.evaluate(() => {
        const el = [...document.querySelectorAll('.app-floating-range')].find((node) => getComputedStyle(node).display !== 'none')
        return el ? { opacity: getComputedStyle(el).opacity, visibility: getComputedStyle(el).visibility } : null
      })
      return state
    }, { message: 'the floating selector after the filter closes' }).toEqual({ opacity: '1', visibility: 'visible' })
  })
}
