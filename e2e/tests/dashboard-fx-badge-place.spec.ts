import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: each test sets the width it checks itself with `page.setViewportSize`. A spending card's
// header keeps one line when its currency badge arrives. The breakdown card shows the range tabs where it is wide
// enough for them beside the badge and the mobile selector where it is not. The comparison card keeps the tabs on the
// title row at every width the dashboard has them, shortening its title to make room, and a pointer aimed at its
// controls never misses

const BREAKDOWN = {
  card: 'Spending breakdown',
  endpoint: '/dashboard/spending-breakdown',
  // The header width the tabs need beside the badge, measured: the icon, title, badge, toggle and tabs with their
  // gaps. The card is 444px wide at a 1280px viewport and 554px wide at 1500px
  minimum: 461,
  widths: [
    { viewport: 1280, tabs: false },
    { viewport: 1500, tabs: true },
  ],
  toggle: 'Show income breakdown',
  rangeName: 'Breakdown range',
}

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
 * Holds a card's answers until the returned function is called, so its loading frame lasts until the boxes are read
 */
async function holdAnswers(page: Page, endpoint: string): Promise<() => void> {
  let answer!: () => void
  const answered = new Promise<void>((resolve) => (answer = resolve))
  await page.route(new RegExp(`^${API_BASE_URL}${endpoint}\\?`), async (route) => {
    await answered
    await route.fallback()
  })
  return answer
}

test(`keeps the breakdown header still with the mobile range selector when its FX badge arrives at 1280px`, async ({
  page,
  request,
}) => {
  await checkBreakdownStaysStill(page, request, 1280, false)
})

test(`keeps the breakdown header still with the range tabs when its FX badge arrives at 1500px`, async ({
  page,
  request,
}) => {
  await checkBreakdownStaysStill(page, request, 1500, true)
})

async function checkBreakdownStaysStill(
  page: Page,
  request: Parameters<typeof signUpUser>[0],
  viewport: number,
  tabs: boolean,
) {
  const { card, endpoint, toggle, rangeName } = BREAKDOWN
  await openDashboard(page, request, viewport)
  const answer = await holdAnswers(page, endpoint)
  await openPage(page, '/dashboard')

  const badge = page.getByRole('button', { name: `${card} FX status`, exact: true })
  const range = rangeControl(page, rangeName, tabs)
  const held = [range, page.getByRole('button', { name: toggle, exact: true })]
  for (const control of held) await expect(control).toBeVisible()
  // The other range control is not drawn at this width
  await expect(rangeControl(page, rangeName, !tabs)).toBeHidden()
  await expect(badge).toHaveCount(0)
  const before = await Promise.all(held.map((control) => control.boundingBox()))

  answer()
  await expect(badge).toBeVisible()
  const after = await Promise.all(held.map((control) => control.boundingBox()))

  expect(after).toEqual(before)
}

test(`switches the breakdown header's range control at exactly ${BREAKDOWN.minimum}px of its own width`, async ({
  page,
  request,
}) => {
  const { card, minimum, rangeName } = BREAKDOWN
  await openDashboard(page, request, 1500)
  await openPage(page, '/dashboard')
  const badge = page.getByRole('button', { name: `${card} FX status`, exact: true })
  await expect(badge).toBeVisible()
  const container = page.getByTestId('spending-breakdown-header')

  await container.evaluate((node, width) => (node.style.width = `${width}px`), minimum - 1)
  await expect(rangeControl(page, rangeName, false)).toBeVisible()
  await expect(rangeControl(page, rangeName, true)).toBeHidden()

  await container.evaluate((node, width) => (node.style.width = `${width}px`), minimum)
  const tabs = rangeControl(page, rangeName, true)
  await expect(tabs).toBeVisible()
  await expect(rangeControl(page, rangeName, false)).toBeHidden()
  // Icon, title, badge and tabs share the first line, so the tabs never wrap
  const [badgeBox, tabsBox] = await Promise.all([badge.boundingBox(), tabs.boundingBox()])
  expect(Math.abs(middle(badgeBox) - middle(tabsBox))).toBeLessThan(2)
})

test('shows the breakdown header the mobile range selector at a 600px viewport, as the comparison card does', async ({
  page,
  request,
}) => {
  const { card, rangeName } = BREAKDOWN
  await openDashboard(page, request, 600)
  await openPage(page, '/dashboard')
  await expect(page.getByRole('button', { name: `${card} FX status`, exact: true })).toBeVisible()
  // The card is wider than the 461px the tabs need here, but the dashboard keeps the tabs for 730px and up
  await expect(rangeControl(page, rangeName, false)).toBeVisible()
  await expect(rangeControl(page, rangeName, true)).toBeHidden()
  await expect(rangeControl(page, 'Spending range', false)).toBeVisible()
  await expect(rangeControl(page, 'Spending range', true)).toBeHidden()
})

/** The vertical middle of a box, or NaN where it has none */
function middle(box: { y: number; height: number } | null) {
  return box ? box.y + box.height / 2 : Number.NaN
}

/** The date on the given day of the month a number of months from this one, as YYYY-MM-DD */
function dayOfMonthFromNow(monthsBack: number, day: number): string {
  const [year, month] = todayInTestTimezone().split('-').map(Number)
  return new Date(Date.UTC(year, month - 1 - monthsBack, day)).toISOString().slice(0, 10)
}

/**
 * Gives a new user history reaching back two whole years, with spending in earlier weeks, months, quarters and the
 * year before, so the average has something to show for every range. The average is kept on in their browser
 */
async function seedAverageHistory(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Salary',
    amount: 100_000,
    date: dayOfMonthFromNow(26, 1),
  })
  const today = new Date(`${todayInTestTimezone()}T00:00:00Z`)
  const daysBack = (days: number) => new Date(today.getTime() - days * 86_400_000).toISOString().slice(0, 10)
  const dates = [
    daysBack(8),
    daysBack(15),
    daysBack(22),
    ...[1, 2, 3, 5, 8, 13, 14].map((months) => dayOfMonthFromNow(months, 2)),
  ]
  for (const date of dates) {
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -10_000,
      date,
    })
  }
  const me = await request.get(`${API_BASE_URL}/me`, { headers: asUser(user) })
  const { id } = (await me.json()) as { id: string }
  await logInViaApi(page, user)
  await page.addInitScript((key) => localStorage.setItem(key, 'on'), `lumina:dashboard:spending-average-kept:${id}`)
}

for (const range of ['WTD', 'MTD', 'QTD', 'YTD']) {
  for (const average of [true, false]) {
    test(`keeps the spending comparison tabs on the title row when its FX badge arrives for ${range} with the average ${average ? 'shown' : 'hidden'}`, async ({
      page,
      request,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      if (average) await seedAverageHistory(page, request)
      else await openDashboard(page, request, 1280)
      const answer = await holdAnswers(page, '/dashboard/spending-comparison')
      await openPage(page, '/dashboard')

      const tabs = page.getByRole('tablist', { name: 'Spending range', exact: true })
      await expect(tabs).toBeVisible()
      await tabs.getByRole('tab', { name: range }).click()
      await page.mouse.move(0, 0)
      const title = page.getByText(/^Spending vs\./).filter({ visible: true })
      const badge = page.getByRole('button', { name: 'Spending comparison FX status', exact: true })
      await expect(badge).toHaveCount(0)
      // The tabs are on the title's line, and no mobile selector takes their place
      await expect(rangeControl(page, 'Spending range', false)).toBeHidden()
      const sameLine = async () => Math.abs(middle(await tabs.boundingBox()) - middle(await title.boundingBox()))
      expect(await sameLine()).toBeLessThan(2)
      const before = await tabs.boundingBox()

      answer()
      await expect(badge).toBeVisible()
      await expect(title).toHaveText(average ? /avg\.|average/ : /last/)
      // The title rolls and the form it takes settles over a moment, so the tabs are sampled until ten frames in a
      // row have been read, and none of them may have moved or wrapped
      const samples: { tabs: unknown; sameLine: number }[] = []
      await expect
        .poll(
          async () => {
            samples.push({ tabs: await tabs.boundingBox(), sameLine: await sameLine() })
            return samples.length
          },
          // Each read waits on a busy shared host, so ten of them can take longer than the usual 15 seconds
          { intervals: [100], timeout: 45_000 },
        )
        .toBeGreaterThanOrEqual(10)
      for (const sample of samples) {
        expect(sample.tabs).toEqual(before)
        expect(sample.sameLine).toBeLessThan(2)
      }
    })
  }
}
