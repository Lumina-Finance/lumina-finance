import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: each test sets the width it checks itself with `page.setViewportSize`. A spending card's
// header keeps one line when its currency badge arrives: the range tabs where the card is wide enough for them
// beside the badge, the mobile selector where it is not, and a pointer aimed at its controls never misses

/**
 * The cards whose header holds a range control beside the badge. `minimum` is the header width the tabs need beside
 * the badge, measured: the breakdown card's icon, title, badge, toggle and tabs, and the comparison card's icon, widest
 * title, badge and tabs, with their gaps. Both cards are 444px wide at a 1280px viewport and 554px wide at 1500px
 */
const CASES: {
  card: string
  endpoint: string
  minimum: number
  widths: { viewport: number; tabs: boolean }[]
  toggle?: string
  rangeName: string
}[] = [
  {
    card: 'Spending breakdown',
    endpoint: '/dashboard/spending-breakdown',
    minimum: 461,
    widths: [
      { viewport: 1280, tabs: false },
      { viewport: 1500, tabs: true },
    ],
    toggle: 'Show income breakdown',
    rangeName: 'Breakdown range',
  },
  {
    card: 'Spending comparison',
    endpoint: '/dashboard/spending-comparison',
    minimum: 452,
    widths: [
      { viewport: 1260, tabs: false },
      { viewport: 1280, tabs: false },
      { viewport: 1500, tabs: true },
    ],
    rangeName: 'Spending range',
  },
]

/**
 * Finds the range control the card shows: the segmented tabs, or the mobile selector's button
 */
function rangeControl(page: Page, rangeName: string, tabs: boolean): Locator {
  return tabs
    ? page.getByRole('tablist', { name: rangeName, exact: true })
    : page.getByRole('button', { name: new RegExp(`^${rangeName}:`) }).filter({ visible: true })
}

/**
 * Signs a user in on the dashboard at a viewport width, with one account so the cards draw
 */
async function openDashboard(page: Page, request: Parameters<typeof signUpUser>[0], width: number) {
  await page.setViewportSize({ width, height: 900 })
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
}

/**
 * The header's container, whose own width decides which range control shows
 */
function headerContainer(page: Page, card: string): Locator {
  return page.getByTestId(`${card.toLowerCase().replace(' ', '-')}-header`)
}

for (const { card, endpoint, widths, toggle, rangeName } of CASES) {
  for (const { viewport, tabs } of widths) {
    const shown = tabs ? 'the range tabs' : 'the mobile range selector'
    test(`keeps the ${card.toLowerCase()} header still with ${shown} when its FX badge arrives at ${viewport}px`, async ({
      page,
      request,
    }) => {
      await openDashboard(page, request, viewport)
      // The card's answer waits for the test, so its loading hold lasts until the boxes are read
      let answer!: () => void
      const answered = new Promise<void>((resolve) => (answer = resolve))
      await page.route(new RegExp(`^${API_BASE_URL}${endpoint}\\?`), async (route) => {
        await answered
        await route.fallback()
      })
      await openPage(page, '/dashboard')

      const badge = page.getByRole('button', { name: `${card} FX status`, exact: true })
      const range = rangeControl(page, rangeName, tabs)
      const held = [range, ...(toggle ? [page.getByRole('button', { name: toggle, exact: true })] : [])]
      for (const control of held) await expect(control).toBeVisible()
      // The other range control is not drawn at this width
      await expect(rangeControl(page, rangeName, !tabs)).toBeHidden()
      await expect(badge).toHaveCount(0)
      const before = await Promise.all(held.map((control) => control.boundingBox()))

      answer()
      await expect(badge).toBeVisible()
      const after = await Promise.all(held.map((control) => control.boundingBox()))

      expect(after).toEqual(before)
    })
  }
}

for (const { card, minimum, rangeName } of CASES) {
  test(`switches the ${card.toLowerCase()} header's range control at exactly ${minimum}px of its own width`, async ({
    page,
    request,
  }) => {
    await openDashboard(page, request, 1500)
    await openPage(page, '/dashboard')
    const badge = page.getByRole('button', { name: `${card} FX status`, exact: true })
    await expect(badge).toBeVisible()
    const container = headerContainer(page, card)

    await container.evaluate((node, width) => (node.style.width = `${width}px`), minimum - 1)
    await expect(rangeControl(page, rangeName, false)).toBeVisible()
    await expect(rangeControl(page, rangeName, true)).toBeHidden()

    await container.evaluate((node, width) => (node.style.width = `${width}px`), minimum)
    const tabs = rangeControl(page, rangeName, true)
    await expect(tabs).toBeVisible()
    await expect(rangeControl(page, rangeName, false)).toBeHidden()
    // Icon, title, badge and tabs share the first line, so the tabs never wrap
    const [badgeBox, tabsBox] = await Promise.all([badge.boundingBox(), tabs.boundingBox()])
    const middle = (box: { y: number; height: number } | null) => (box ? box.y + box.height / 2 : Number.NaN)
    expect(Math.abs(middle(badgeBox) - middle(tabsBox))).toBeLessThan(2)
  })
}
