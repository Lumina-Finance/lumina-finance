import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// Runs on desktop only: it checks the desktop filter pill, and sets the narrower sizes it checks
// itself

/**
 * Guards the desktop Filters pill on both lists that carry it. Its press animation used to put a
 * second, silent Tab stop on its frame, its closed panel stayed in the Tab order at no height, and
 * opening the page narrower than the desktop toolbar left the pill squashed once the window widened
 */

const LISTS = [
  { name: 'transactions', path: '/transactions', filters: 'Transaction filters', neighbour: 'Import transactions' },
  { name: 'accounts', path: '/accounts', filters: 'Account filters', neighbour: 'Add account' },
] as const

async function openList(page: Page, request: Parameters<typeof signUpUser>[0], path: string) {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, path)
}

/** Whether focus sits inside the pill's glass, frame and panel included */
function focusIsInside(glass: Locator) {
  return glass.evaluate((node) => node.contains(document.activeElement))
}

for (const list of LISTS) {
  test.describe(`the Filters pill on ${list.name}`, () => {
    // Motion on, since the press animation is what made the frame a stop
    test('is one Tab stop, on its button', async ({ page, request }) => {
      await openList(page, request, list.path)
      const pill = page.getByRole('button', { name: list.filters, exact: true })
      const glass = page.locator('.app-range-glass').filter({ has: pill })

      await pill.focus()
      await page.keyboard.press('Shift+Tab')
      expect(await focusIsInside(glass)).toBe(false)
      await page.keyboard.press('Tab')
      await expect(pill).toBeFocused()
    })

    // Motion on, so focus is handed back while the panel is still closing
    test('keeps its closed panel out of the Tab order', async ({ page, request }) => {
      await openList(page, request, list.path)
      const pill = page.getByRole('button', { name: list.filters, exact: true })
      const glass = page.locator('.app-range-glass').filter({ has: pill })

      await pill.focus()
      await page.keyboard.press('Tab')
      expect(await focusIsInside(glass)).toBe(false)

      await pill.press('Enter')
      await page.keyboard.press('Tab')
      await expect(glass.getByRole('tab').first()).toBeFocused()

      await page.keyboard.press('Escape')
      await expect(pill).toHaveAttribute('aria-expanded', 'false')
      await expect(pill).toBeFocused()
      await page.keyboard.press('Tab')
      expect(await focusIsInside(glass)).toBe(false)
    })

    // The pill is measured while the desktop toolbar is hidden on a narrow page, so it has to measure
    // again once the toolbar shows. It is compared with the same page opened wide
    test('draws at its full size after the window widens from a narrow load', async ({ page, request }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.setViewportSize({ width: 768, height: 900 })
      await openList(page, request, list.path)
      const pill = page.getByRole('button', { name: list.filters, exact: true })
      const glass = page.locator('.app-range-glass').filter({ has: pill })
      const neighbour = page.getByRole('button', { name: list.neighbour, exact: true })
      const measure = async () => {
        const box = (await glass.boundingBox())!
        const beside = (await neighbour.boundingBox())!
        return { width: Math.round(box.width), height: Math.round(box.height), top: Math.round(box.y - beside.y) }
      }
      const wide = await measure()

      await page.setViewportSize({ width: 390, height: 900 })
      await openPage(page, list.path)
      await expect(pill).toBeHidden()
      await page.setViewportSize({ width: 768, height: 900 })
      await expect(pill).toBeVisible()
      await expect.poll(measure).toEqual(wide)
    })
  })
}

// The pills' head and the range selector's custom dates eased over 0.4s, while every other control's look
// eases over the app's 300ms. Motion is on, since reduced motion zeroes every duration
test('the pills and the range selector ease over 300ms', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)

  const durations = () => page.evaluate(() => {
    const read = (selector: string, property: string) => [...document.querySelectorAll<HTMLElement>(selector)].map((node) => {
      const style = getComputedStyle(node)
      return style.transitionDuration.split(', ')[style.transitionProperty.split(', ').indexOf(property)]
    })
    return {
      heads: read('.app-range-glass-head', 'padding-top'),
      panels: read('.app-range-glass-bodywrap', 'grid-template-rows'),
      custom: read('.app-range-custom', 'grid-template-rows'),
    }
  })

  for (const path of ['/accounts', '/transactions']) {
    await openPage(page, path)
    const { heads } = await durations()
    expect(heads.length).toBeGreaterThan(0)
    expect(heads.every((duration) => duration === '0.3s')).toBe(true)
  }

  await openPage(page, '/insights')
  const insights = await durations()
  expect(insights.heads.length).toBeGreaterThan(0)
  expect(insights.heads.every((duration) => duration === '0.3s')).toBe(true)
  expect(insights.panels.length).toBeGreaterThan(0)
  expect(insights.panels.every((duration) => duration === '0.3s')).toBe(true)
  expect(insights.custom.length).toBeGreaterThan(0)
  expect(insights.custom.every((duration) => duration === '0.3s')).toBe(true)
})

// The panel under the Accounts and Transactions pills used to take 0.45s to open fully. The page's clock is
// faked and stepped, so the reading does not depend on how busy the machine is. A moment after the pill is
// pressed, the ease-out curve of 300ms has covered more than 95% of the way and that of 450ms only 87%
const PANEL_CHECK_AT_MS = 150
const PANEL_ARRIVED_SHARE = 0.92

for (const list of LISTS) {
  test(`the panel under the ${list.name} pill opens and closes over 300ms`, async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.clock.install()
    await openList(page, request, list.path)
    const pill = page.getByRole('button', { name: list.filters, exact: true })
    const glass = page.locator('.app-range-glass').filter({ has: pill })
    await expect(pill).toHaveAttribute('aria-expanded', 'false')

    // Pressing the pill from the page, since a paused clock stops the frames a click waits for
    await page.clock.pauseAt(new Date(Date.now() + 10_000))
    const height = () => glass.evaluate((node) => (node.lastElementChild as HTMLElement).getBoundingClientRect().height)
    const press = () => glass.evaluate((node) => node.querySelector('button')!.click())
    // The first step starts the motion on its first frame, and the second is the time under test
    const stepTo = async (ms: number) => {
      await page.clock.runFor(16)
      await page.clock.runFor(ms)
      return height()
    }

    const closed = await height()
    expect(closed).toBe(0)
    await press()
    const opening = await stepTo(PANEL_CHECK_AT_MS)
    await page.clock.runFor(1000)
    const open = await height()
    expect(open, 'the panel opens').toBeGreaterThan(50)
    expect((opening - closed) / (open - closed), 'the panel has arrived when opening').toBeGreaterThan(PANEL_ARRIVED_SHARE)

    await press()
    const closing = await stepTo(PANEL_CHECK_AT_MS)
    await page.clock.runFor(1000)
    expect(await height(), 'the panel closes').toBe(0)
    expect((open - closing) / open, 'the panel has arrived when closing').toBeGreaterThan(PANEL_ARRIVED_SHARE)
  })
}
