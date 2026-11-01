/**
 * The merchant distribution card narrows to the categories chosen in its filter while the merchant
 * ranking card beside it stays unfiltered, and clearing the filter brings every merchant back
 */
import { expect, test, type APIRequestContext, type Locator } from '@playwright/test'

import { asUser, createAccount, createCategory, createTransaction, findReferenceId, signUpUser } from '../support/api'
import { expectSignedIn, logInViaApi, openPage } from '../support/app'
import { card, matchesApi, navigate } from '../support/insights'
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

/** Seeds one grocery and one dining merchant, plus an expense category with no spend at all */
async function seedFilterMerchants(request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Merchant filter account' })
  const names = { groceries: 'Filter Grocer', dining: 'Filter Diner' }
  for (const name of Object.values(names)) {
    const response = await request.post(`${API_BASE_URL}/merchants`, { headers: asUser(user), data: { name } })
    expect(response.status()).toBe(201)
  }
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', merchantName: names.groceries, amount: -30000 })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', merchantName: names.dining, amount: -20000 })
  await createCategory(request, user, { name: 'Unused filter category' })
  return { user, names }
}

test('a category with no spend says so, with no hint, and the merchants return once the filter is cleared', async ({ page, request }) => {
  const { user, names } = await seedFilterMerchants(request)
  await logInViaApi(page, user)
  await openPage(page, '/insights')
  const distribution = card(page, 3)
  await distribution.scrollIntoViewIfNeeded()
  await expect(distribution.getByText(names.groceries)).toBeVisible()

  await distribution.getByRole('button', { name: 'Merchant category filter' }).click()
  await page.getByRole('checkbox', { name: 'Unused filter category' }).click()
  await page.getByRole('button', { name: 'Apply filter' }).click()

  const message = distribution.getByText('No merchant spending in these categories in this range')
  await expect(message).toBeVisible()
  await expect(distribution.getByText(names.groceries)).toHaveCount(0)
  // The message stands alone in the empty box, with nothing under it telling the user what to do
  await expect(distribution.getByText('Choose other categories or clear the filter')).toHaveCount(0)
  await expect(message).toHaveText('No merchant spending in these categories in this range')

  await distribution.getByRole('button', { name: 'Clear filter' }).click()
  await expect(distribution.getByText(names.groceries)).toBeVisible()
})

// The icon and the title share one row at every width, the title wrapping beside the icon when it is too
// long for what is left, and the title, info icon and FX badge are never cut off by the card
for (const width of [1280, 768, 390, 320]) {
  test(`the merchant map's icon and title share a row and nothing is clipped, ${width}px wide`, async ({ page, request }) => {
    const { user, names } = await seedFilterMerchants(request)
    await page.setViewportSize({ width, height: 844 })
    await logInViaApi(page, user)
    await openPage(page, '/insights')
    const distribution = card(page, 3)
    await distribution.scrollIntoViewIfNeeded()
    await expect(distribution.getByText(names.groceries)).toBeVisible()
    const fx = distribution.getByRole('button', { name: 'Merchant distribution FX status' })
    await expect(fx).toBeVisible()

    const parts = await distribution.evaluate((cardElement) => {
      const rect = (element: Element | null | undefined) => {
        const r = element!.getBoundingClientRect()
        return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
      }
      const title = cardElement.querySelector('span.app-label')!
      const header = title.parentElement!.parentElement!
      const named = (name: string) => cardElement.querySelector(`button[aria-label="${name}"]`)
      return {
        card: rect(cardElement),
        chip: rect(header.querySelector('svg')!.parentElement),
        title: rect(title),
        info: rect(named('Merchant distribution calculation')),
        fx: rect(named('Merchant distribution FX status')),
        filter: rect([...cardElement.querySelectorAll('button[aria-label="Merchant category filter"]')].find((el) => (el as HTMLElement).offsetParent !== null)),
        pageOverflows: document.documentElement.scrollWidth > window.innerWidth,
        titleCutOff: title.scrollWidth > title.clientWidth + 1,
      }
    })
    const centre = (box: { top: number; bottom: number }) => (box.top + box.bottom) / 2

    // The chip is left of the title and level with some line of it, never on a row of its own above it
    expect(parts.chip.right).toBeLessThanOrEqual(parts.title.left + 0.5)
    expect(centre(parts.chip)).toBeGreaterThan(parts.title.top)
    expect(centre(parts.chip)).toBeLessThan(parts.title.bottom)
    // From 390px wide the title fits one line, so the info icon and the FX badge sit on the icon's row
    // rather than dropping under the title. Narrower, the title may wrap and they follow its last word
    if (width >= 390) {
      expect(Math.abs(centre(parts.info) - centre(parts.chip))).toBeLessThan(3)
      expect(Math.abs(centre(parts.fx) - centre(parts.chip))).toBeLessThan(3)
    }
    // Each part sits wholly inside the card
    for (const part of [parts.chip, parts.title, parts.info, parts.fx, parts.filter]) {
      expect(part.left).toBeGreaterThanOrEqual(parts.card.left)
      expect(part.right).toBeLessThanOrEqual(parts.card.right)
    }
    expect(parts.titleCutOff).toBe(false)
    expect(parts.pageOverflows).toBe(false)
    // The info icon and the FX badge stay inside the title's own box
    expect(parts.info.right).toBeLessThanOrEqual(parts.title.right + 0.5)
    expect(parts.fx.right).toBeLessThanOrEqual(parts.title.right + 0.5)
  })
}

test('on a phone the sheet narrows the map and covers the floating range selector', async ({ page, request }) => {
  const { user, names } = await seedFilterMerchants(request)
  await page.setViewportSize({ width: 390, height: 844 })
  await logInViaApi(page, user)
  await openPage(page, '/insights')
  const distribution = card(page, 3)
  await distribution.scrollIntoViewIfNeeded()
  await expect(distribution.getByText(names.groceries)).toBeVisible()
  await distribution.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -120))

  // Where the floating selector sits on screen before the sheet opens
  const selectorPoint = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.app-floating-range')].find((node) => getComputedStyle(node).display !== 'none')
    const b = el?.querySelector('.app-range-glass')?.getBoundingClientRect()
    return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null
  })
  expect(selectorPoint, 'a floating selector is on screen').not.toBeNull()

  await distribution.getByRole('button', { name: 'Merchant category filter' }).filter({ visible: true }).click()
  const sheet = page.getByRole('dialog', { name: 'Merchant category filter' })
  await expect(sheet).toBeVisible()
  await expect.poll(() => page.evaluate(({ x, y }) => {
    const top = document.elementFromPoint(x, y)
    return top !== null && top.closest('.app-floating-range') === null
  }, selectorPoint!), { message: "the sheet answers at the selector's position" }).toBe(true)

  // The footer's two buttons take half of its width each, as a phone modal's footer does
  const clearBox = await sheet.getByRole('button', { name: 'Clear all', exact: true }).boundingBox()
  const applyBox = await sheet.getByRole('button', { name: 'Apply filter' }).boundingBox()
  expect(Math.abs(clearBox!.width - applyBox!.width)).toBeLessThan(1)
  expect(Math.abs(clearBox!.width * 2 + (applyBox!.x - (clearBox!.x + clearBox!.width)) - (390 - 40))).toBeLessThan(1)

  await sheet.getByRole('checkbox', { name: 'Dining' }).click()
  const filtered = page.waitForRequest((candidate) => matchesApi(candidate.url(), '/insights/merchants')
    && new URL(candidate.url()).searchParams.getAll('category_id').length === 1)
  await sheet.getByRole('button', { name: 'Apply filter' }).click()
  await filtered
  await expect(sheet).toHaveCount(0)
  await expect(distribution.getByText(names.dining)).toBeVisible()
  await expect(distribution.getByText(names.groceries)).toHaveCount(0)
})

test('the category choice is gone after leaving Insights and coming back', async ({ page, request }) => {
  const { user, names } = await seedFilterMerchants(request)
  await logInViaApi(page, user)
  await openPage(page, '/insights')
  const distribution = card(page, 3)
  await distribution.scrollIntoViewIfNeeded()
  await distribution.getByRole('button', { name: 'Merchant category filter' }).click()
  await page.getByRole('checkbox', { name: 'Dining' }).click()
  await page.getByRole('button', { name: 'Apply filter' }).click()
  await expect(distribution.getByText(names.groceries)).toHaveCount(0)
  await expect(distribution.getByText(names.dining)).toBeVisible()

  await navigate(page, 'Transactions')
  await navigate(page, 'Insights')
  await expect(page.getByRole('heading', { name: 'Insights', exact: true })).toBeVisible()
  await distribution.scrollIntoViewIfNeeded()

  await expect(distribution.getByText(names.groceries)).toBeVisible()
  await expect(distribution.getByText(names.dining)).toBeVisible()
  await distribution.getByRole('button', { name: 'Merchant category filter' }).click()
  await expect(page.getByRole('checkbox', { name: 'Dining' })).not.toBeChecked()
  await expect(page.getByText('No filter applied').filter({ visible: true })).toBeVisible()
})

test('Insights is whole again after leaving and coming back inside the page fade', async ({ page, request }) => {
  const { user, names } = await seedFilterMerchants(request)
  await logInViaApi(page, user)
  await openPage(page, '/insights')
  const distribution = card(page, 3)
  await distribution.scrollIntoViewIfNeeded()
  const pill = distribution.getByRole('button', { name: 'Merchant category filter' })
  await pill.click()
  await page.getByRole('checkbox', { name: 'Dining' }).click()
  await page.getByRole('button', { name: 'Apply filter' }).click()
  await expect(distribution.getByText(names.groceries)).toHaveCount(0)
  await expect(pill).toContainText('1')

  // Both clicks run inside the page, the second 100ms after the first, so it lands in the 350ms exit
  // fade of the first however slowly the test driver answers
  await page.evaluate(() => new Promise<void>((resolve) => {
    const link = (name: string) => [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Primary"] a')]
      .find((anchor) => anchor.textContent?.trim() === name)
    link('Transactions')!.click()
    setTimeout(() => {
      link('Insights')!.click()
      resolve()
    }, 100)
  }))
  await expect(page).toHaveURL(/\/insights$/)

  const heading = page.getByRole('heading', { name: 'Insights', exact: true })
  await expect(heading).toBeVisible()
  await expect.poll(() => heading.evaluate((element) => {
    let opacity = 1
    for (let node: Element | null = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return opacity
  }), { message: 'the page is back at full opacity' }).toBe(1)
  await distribution.scrollIntoViewIfNeeded()
  await expect(distribution.getByText(names.groceries)).toBeVisible()
  await expect(distribution.getByText(names.dining)).toBeVisible()
  await expect(pill).not.toContainText(/\d/)
})
