import { expect, test, type Page } from '@playwright/test'

import { createAccount, signUpUser, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size: the choice opens a dialog that fills the screen on a phone, and the widget header
// carries its button at every width

const CHOOSE_BUTTON = 'Choose credit accounts'
const EMPTY_STATE_BUTTON = 'Choose a credit account'

/**
 * The dashboard's content, which a fresh user's other widgets leave without any percentage, so a
 * percentage found in it is the credit widget's
 */
function dashboardContent(page: Page) {
  return page.getByRole('main')
}

/** Create a credit card in the test currency with an amount used and a limit, in minor units */
async function createCard(request: Parameters<typeof createAccount>[0], user: TestUser, name: string, used: number, limit: number) {
  return createAccount(request, user, {
    name,
    accountKind: 'revolving',
    accountType: 'credit_card',
    startingBalance: -used,
    creditLimit: limit,
  })
}

/** Open the chooser from the widget header and return its dialog */
async function openChooser(page: Page, from: 'header' | 'empty state' = 'header') {
  await page.getByRole('button', { name: from === 'header' ? CHOOSE_BUTTON : EMPTY_STATE_BUTTON }).click()
  return page.getByRole('dialog', { name: 'Credit utilization' })
}

test('leaves a card out of the credit widget by keyboard, keeps the choice on a fresh load, and counts a later card', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 50_000, 500_000)
  await createCard(request, user, 'Card B', 150_000, 200_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')

  // Both cards count at first: 2,000 used of 7,000 is about 29%
  await expect(dashboardContent(page)).toContainText('29%')

  const dialog = await openChooser(page)
  const cardB = dialog.getByRole('checkbox', { name: 'Card B' })
  await expect(dialog.getByRole('checkbox', { name: 'Card A' })).toHaveAttribute('aria-checked', 'true')
  await expect(cardB).toHaveAttribute('aria-checked', 'true')

  await cardB.focus()
  await page.keyboard.press('Space')
  await expect(cardB).toHaveAttribute('aria-checked', 'false')
  await dialog.getByRole('button', { name: 'Save' }).click()

  // Only Card A is left: 500 used of 5,000 is 10%
  await expect(dialog).toBeHidden()
  await expect(dashboardContent(page)).toContainText('10%')

  // A fresh load stands in for opening the dashboard on another device, and a card added since counts
  await createCard(request, user, 'Card C', 100_000, 100_000)
  await openPage(page, '/dashboard')
  const reopened = await openChooser(page)
  await expect(reopened.getByRole('checkbox', { name: 'Card A' })).toHaveAttribute('aria-checked', 'true')
  await expect(reopened.getByRole('checkbox', { name: 'Card B' })).toHaveAttribute('aria-checked', 'false')
  await expect(reopened.getByRole('checkbox', { name: 'Card C' })).toHaveAttribute('aria-checked', 'true')
})

test('shows its own empty state once every card is left out, and brings a card back from the chooser', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 50_000, 500_000)
  await createCard(request, user, 'Card B', 150_000, 200_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const dialog = await openChooser(page)
  await dialog.getByRole('checkbox', { name: 'Card A' }).click()
  await dialog.getByRole('checkbox', { name: 'Card B' }).click()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await expect(dialog).toBeHidden()

  // The choice is on the server, so a fresh load shows the same state with the way back still in the header
  await openPage(page, '/dashboard')
  await expect(page.getByText('No accounts selected')).toBeVisible()
  await expect(page.getByText('Choose a credit account to get started')).toBeVisible()
  await expect(page.getByText('No credit accounts')).toBeHidden()

  // The empty state's own button opens the same chooser as the header's
  const reopened = await openChooser(page, 'empty state')
  await reopened.getByRole('checkbox', { name: 'Card B' }).click()
  await reopened.getByRole('button', { name: 'Save' }).click()
  await expect(reopened).toBeHidden()

  // Card B alone is 1,500 used of 2,000
  await expect(dashboardContent(page)).toContainText('75%')
  await expect(page.getByText('No accounts selected')).toBeHidden()
})

test('keeps the chooser its height while a search matches no card', async ({ page, request }) => {
  const user = await signUpUser(request)
  for (const name of ['Card A', 'Card B', 'Card C']) await createCard(request, user, name, 50_000, 500_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const dialog = await openChooser(page)
  await expect(dialog.getByRole('checkbox', { name: 'Card C' })).toBeVisible()
  // The layout height, which the dialog's entrance scaling does not change
  const heightOf = () => dialog.evaluate((panel) => (panel as HTMLElement).offsetHeight)
  const full = await heightOf()
  expect(full).toBeGreaterThan(300)

  await dialog.getByPlaceholder('Search accounts').fill('zzzz')
  await expect(dialog.getByText('No matches')).toBeVisible()
  await expect.poll(heightOf).toBe(full)
})

test('cuts a long card name off inside the chooser instead of widening it past its panel', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const longName = 'A card named for the whole product design and research team across all travel and events in a very long year'
  await createCard(request, user, longName, 50_000, 500_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const dialog = await openChooser(page)
  await expect(dialog.getByRole('checkbox', { name: longName })).toBeVisible()

  // A row that sized itself to its text would push the panel's content wider than the panel and scroll its rail away
  const overflow = await dialog.evaluate((panel) => ({ width: panel.scrollWidth - panel.clientWidth, left: panel.scrollLeft }))
  expect(overflow).toEqual({ width: 0, left: 0 })
})

test('eases the name of a chooser row straight to its new colour and leaves the type line as it was', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 50_000, 500_000)

  await logInViaApi(page, user)
  await openPage(page, '/dashboard')
  const dialog = await openChooser(page)
  const row = dialog.getByRole('checkbox', { name: 'Card A' })
  await expect(row).toBeVisible()

  // Samples the name line and the type line on every frame of a click, as red, green and blue
  const sampleToggle = async () => {
    await row.evaluate((button) => {
      const lines = [...button.querySelectorAll('span > span')] as HTMLElement[]
      const toByte = (linear: number) => 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055)
      // A colour in the middle of a transition reads back as oklab() or color(srgb), a settled one as rgb()
      const read = (line: HTMLElement) => {
        const color = getComputedStyle(line).color
        const numbers = (color.match(/-?\d*\.?\d+(?:e-?\d+)?/g) ?? []).map(Number)
        if (color.startsWith('oklab')) {
          const [lightness, a, b] = numbers
          const [l, m, s] = [lightness + 0.3963377774 * a + 0.2158037573 * b, lightness - 0.1055613458 * a - 0.0638541728 * b, lightness - 0.0894841775 * a - 1.291485548 * b].map((value) => value ** 3)
          return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(toByte)
        }
        return color.startsWith('color(srgb') ? numbers.slice(0, 3).map((value) => value * 255) : numbers.slice(0, 3)
      }
      const frames: number[][][] = []
      const start = performance.now()
      const sampled = { frames, done: false }
      // Samples until the colours have changed and then held still for ten frames, or for a few seconds at most
      const tick = () => {
        frames.push(lines.map(read))
        const changed = frames.some((frame) => JSON.stringify(frame) !== JSON.stringify(frames[0]))
        const still = frames.length > 10 && frames.slice(-10).every((frame) => JSON.stringify(frame) === JSON.stringify(frames[frames.length - 1]))
        if ((changed && still) || performance.now() - start > 4000) sampled.done = true
        else requestAnimationFrame(tick)
      }
      Object.assign(window, { __sampled: sampled })
      requestAnimationFrame(tick)
    })
    await row.click()
    await page.mouse.move(0, 0)
    await page.waitForFunction(() => (window as unknown as { __sampled: { done: boolean } }).__sampled.done)
    return page.evaluate(() => (window as unknown as { __sampled: { frames: number[][][] } }).__sampled.frames)
  }

  // The card starts selected, so the first click deselects it and the second selects it again
  await expect(row).toHaveAttribute('aria-checked', 'true')
  for (const checked of ['false', 'true']) {
    const frames = await sampleToggle()
    await expect(row).toHaveAttribute('aria-checked', checked)
    const first = frames[0]
    const last = frames[frames.length - 1]
    const [from, to] = [first[0], last[0]]
    // The name's channels stay between its old and new value, give or take rounding, so it passes through no other colour
    for (const frame of frames) {
      frame[0].forEach((channel, index) => {
        expect(channel).toBeGreaterThanOrEqual(Math.min(from[index], to[index]) - 2)
        expect(channel).toBeLessThanOrEqual(Math.max(from[index], to[index]) + 2)
      })
    }
    // And the change is eased, so some frame sits between the two colours
    expect(frames.some((frame) => frame[0].some((channel, index) => channel !== from[index] && channel !== to[index]))).toBe(true)
    // The type line is the same colour on every frame, selected or not
    expect(frames.every((frame) => frame[1].every((channel, index) => channel === first[1][index]))).toBe(true)
  }
})

test('says no credit accounts when the user has no credit card', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')

  await expect(page.getByText('No credit accounts', { exact: true })).toBeVisible()
  await expect(page.getByText('No credit limit set', { exact: true })).toHaveCount(0)
})

test('says no credit limit is set when the counted card has none', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 0, 0)
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')

  await expect(page.getByText('No credit limit set', { exact: true })).toBeVisible()
  await expect(page.getByText('No credit accounts', { exact: true })).toHaveCount(0)
})

test('says a rate is missing when the only counted card has a limit that could not be converted', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createCard(request, user, 'Card A', 0, 500_000)

  // The suite has no way to make the server find no rate, so the response is the server's own with the
  // total it would give and the status it would report when the card's limit has no rate to convert it
  await page.route(/\/dashboard\/credit-utilization$/, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    await route.fulfill({
      response,
      json: { ...body, credit_limit_total: 0, fx_status: { state: 'unavailable', missing_pairs: [{ base: 'USD', quote: 'CAD' }] } },
    })
  })
  await logInViaApi(page, user)
  await openPage(page, '/dashboard')

  await expect(page.getByText('An exchange rate is missing for USD/CAD', { exact: true })).toBeVisible()
  await expect(page.getByText('No credit accounts', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No credit limit set', { exact: true })).toHaveCount(0)
})

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`keeps every digit of the credit amount inside the widget with ${reducedMotion} motion`, async ({ page, request }) => {
    const user = await signUpUser(request, { baseCurrency: 'USD' })
    await createAccount(request, user, {
      name: 'Card A',
      accountKind: 'revolving',
      accountType: 'credit_card',
      currency: 'USD',
      startingBalance: -320_000,
      creditLimit: 800_000,
    })
    await page.emulateMedia({ reducedMotion })
    await logInViaApi(page, user)

    // A wide desktop, a tablet and a phone, where the amount's column is narrow enough to cut a digit
    for (const width of [1920, 768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      await openPage(page, '/dashboard')
      const amount = page.getByTestId('credit-amount')
      await expect(amount).toContainText('US$3,200.00')

      // The amount's box animates its width, so poll until it has settled. It must then be as wide as
      // its whole text, which a range over the text measures, and end inside the row the widget draws it in
      await expect.poll(() => amount.evaluate((paragraph) => {
        const range = document.createRange()
        range.selectNodeContents(paragraph)
        const textRight = range.getBoundingClientRect().right
        const boxRight = paragraph.firstElementChild!.getBoundingClientRect().right
        const rowRight = paragraph.closest('[data-testid="credit-row"]')!.getBoundingClientRect().right
        return boxRight >= textRight - 0.5 && textRight <= rowRight + 0.5
      }), `amount at ${width}`).toBe(true)
    }
  })
}
