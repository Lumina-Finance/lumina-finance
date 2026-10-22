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

test('eases every text colour of a chooser row straight from its old value to its new one', async ({ page, request }) => {
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
    for (const [line, from] of first.entries()) {
      const to = last[line]
      // Every channel stays between its old and new value, give or take rounding, so no line passes through another colour
      for (const frame of frames) {
        frame[line].forEach((channel, index) => {
          expect(channel).toBeGreaterThanOrEqual(Math.min(from[index], to[index]) - 2)
          expect(channel).toBeLessThanOrEqual(Math.max(from[index], to[index]) + 2)
        })
      }
      // And the change is eased, so some frame sits between the two colours
      expect(frames.some((frame) => frame[line].some((channel, index) => channel !== from[index] && channel !== to[index]))).toBe(true)
    }
  }
})
