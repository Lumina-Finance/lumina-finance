import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: the toolbar and the pinned day headings stack the same way at every width

async function openTransactionsWithTwoUnconvertedDays(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request, { baseCurrency: 'USD' })
  const euros = await createAccount(request, user, { name: 'Day tooltip euro account', currency: 'EUR' })
  // Days before any exchange rate exists, so each day's total is left unconverted and shows its badge.
  // The older day has enough rows to stay on screen with its heading pinned under the toolbar
  for (const [date, rows] of [['1990-01-02', 5], ['1990-01-01', 15]] as const) {
    for (let row = 0; row < rows; row += 1) {
      await createTransaction(request, user, { accountId: euros.id, categoryName: 'Groceries', amount: -1_000 - row, currency: 'EUR', date })
    }
  }
  await page.setViewportSize({ width: 1920, height: 700 })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
}

test('draws the FX tooltip of a pinned day heading over the toolbar', async ({ page, request }) => {
  await openTransactionsWithTwoUnconvertedDays(page, request)

  // Pin the older day's heading under the toolbar, then open its badge's tooltip
  const heading = page.getByTestId('day-heading').nth(1)
  const badge = heading.getByRole('button', { name: /^FX status for/ })
  await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  // Just below the pinned position, where the tooltip has room to open above the heading and under the toolbar
  await page.evaluate(() => window.scrollBy(0, -150))
  await expect.poll(async () => (await heading.boundingBox())?.y ?? 0).toBeGreaterThan(130)
  await badge.hover()
  const tooltip = heading.getByRole('tooltip')
  await expect(tooltip).toHaveCSS('opacity', '1')

  // The point just inside the panel's top edge, where the toolbar would cover it, belongs to the panel, not to the toolbar drawn over it
  await expect.poll(() => tooltip.evaluate((panel) => {
    const box = panel.getBoundingClientRect()
    const top = document.elementFromPoint(box.left + box.width / 2, box.top + 8)
    return top !== null && panel.contains(top)
  })).toBe(true)
})

// A main tooltip keeps the side it first picked while it stays shown, and a press does not pick again
// unless the trigger asks for that, as the bank screens' tooltips do
test('keeps the side an FX tooltip first opened on across presses of its focused badge', async ({ page, request }) => {
  await openTransactionsWithTwoUnconvertedDays(page, request)

  const heading = page.getByTestId('day-heading').nth(1)
  const badge = heading.getByRole('button', { name: /^FX status for/ })
  const tooltip = heading.getByRole('tooltip')
  const sideOfBadge = async () => {
    const [panelBox, badgeBox] = [await tooltip.boundingBox(), await badge.boundingBox()]
    return panelBox!.y + panelBox!.height <= badgeBox!.y ? 'above' : 'below'
  }

  // Focused by keyboard where there is room above, which shows the tooltip there
  await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await page.evaluate(() => window.scrollBy(0, -150))
  await expect.poll(async () => (await heading.boundingBox())?.y ?? 0).toBeGreaterThan(130)
  await badge.focus()
  await expect(tooltip).toHaveCSS('opacity', '1')
  expect(await sideOfBadge()).toBe('above')

  // Scrolled until the heading pins under the toolbar, where a fresh pick would go below
  await heading.evaluate((element) => element.scrollIntoView({ block: 'start' }))
  await expect.poll(async () => (await heading.boundingBox())?.y ?? 0).toBeLessThan(130)
  await expect(badge).toBeFocused()

  // Each press waits for the badge to say whether it is open, which is rendered with the placement
  for (const expanded of ['true', 'false', 'true']) {
    await page.keyboard.press('Enter')
    await expect(badge).toHaveAttribute('aria-expanded', expanded)
    expect(await sideOfBadge()).toBe('above')
  }
})
