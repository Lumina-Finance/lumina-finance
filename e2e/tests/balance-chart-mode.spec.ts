import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// The first test runs at every size: the chart switch is capped at the screen's width. The second runs
// on desktop only and sets each width it checks itself

/**
 * Guards the Balance and Change switch and the range pills above an account's balance chart. The switch
 * was a fixed width sized for the English labels, so a longer translation, such as "Veränderung" from a
 * browser's translation, was cut off by its edge. The controls were pushed to the right edge of their
 * row, so on a tablet, where they wrap below the title, their left edge sat 28px in from the title's
 */

/** Whether each option shows its whole label, and the switch's width */
function measure(control: Locator) {
  return control.evaluate((node) => ({
    width: Math.round(node.getBoundingClientRect().width),
    clipped: [...node.querySelectorAll('[role="tab"]')]
      .some((tab) => tab.scrollWidth > tab.clientWidth + 1 || tab.getBoundingClientRect().right > node.getBoundingClientRect().right),
  }))
}

test('shows both options in full in English and in a longer translation', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const control = page.getByRole('tablist', { name: 'Balance chart view' }).filter({ visible: true })
  await expect(control.getByRole('tab', { name: 'Change', exact: true })).toBeVisible()

  // English keeps the width it has always had
  expect(await measure(control)).toEqual({ width: 152, clipped: false })

  // The labels a browser translating the page into German puts in place
  await control.evaluate((node) => {
    const [balance, change] = node.querySelectorAll('[role="tab"]')
    balance.textContent = 'Kontostand'
    change.textContent = 'Veränderung'
  })
  const translated = await measure(control)
  expect(translated.clipped).toBe(false)
  expect(translated.width).toBeLessThanOrEqual(page.viewportSize()!.width)
})

// The test below sets its own widths, so it runs on desktop alone

/** Within a pixel, since the layout's widths are fractions */
function expectNear(actual: number, expected: number, message: string) {
  expect(Math.abs(actual - expected), `${message}: ${actual} against ${expected}`).toBeLessThanOrEqual(1)
}

/**
 * The edges of the card's title, of the header's content, of the Balance and Change switch and of the
 * range control, in page pixels
 */
function measureHeader(page: Page) {
  return page.evaluate(() => {
    const title = [...document.querySelectorAll('p')].find((node) => node.textContent === 'Current balance')!
    const header = title.parentElement!
    const visible = (node: Element) => node.getBoundingClientRect().width > 0
    const switchBox = [...header.querySelectorAll('[role="tablist"][aria-label="Balance chart view"]')].find(visible)!
    // From 750px the range is pills in the same row as the switch, and on a phone a control of its own
    const pills = [...header.querySelectorAll('[role="tablist"][aria-label="Balance range"]')].find(visible)
    const range = pills ?? [...header.children].filter(visible).at(-1)!
    const edges = (node: Element) => {
      const { left, right, top, bottom } = node.getBoundingClientRect()
      return { left, right, top, bottom }
    }
    return {
      title: edges(title),
      header: edges(header),
      switchBox: edges(switchBox),
      row: edges(switchBox.parentElement!),
      range: edges(range),
    }
  })
}

test('keeps the controls row on the title\'s edges, wrapped below it or beside it', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)

  // The row drops below the title on a tablet, shares its line from 1024 and, on a phone, has the
  // switch beside the title and the range as a row of its own
  for (const [width, height, layout] of [[768, 1024, 'below'], [1024, 768, 'beside'], [390, 844, 'phone']] as const) {
    const at = `${width}px`
    await page.setViewportSize({ width, height })
    await openPage(page, `/accounts/${account.id}`)
    await expect(page.getByRole('tablist', { name: 'Balance chart view' }).filter({ visible: true })).toBeVisible()
    const { title, header, switchBox, row, range } = await measureHeader(page)

    if (layout === 'phone') {
      expect(switchBox.top, `${at} switch on the title's line`).toBeLessThan(title.bottom)
      expectNear(switchBox.right, header.right, `${at} switch right edge`)
      expect(range.top, `${at} range below the title`).toBeGreaterThanOrEqual(title.bottom)
      expectNear(range.left, title.left, `${at} range left edge`)
      expectNear(range.right, header.right, `${at} range right edge`)
      continue
    }

    expect(row.top >= title.bottom, `${at} row below the title`).toBe(layout === 'below')
    expectNear(switchBox.left, row.left, `${at} switch at the row's left`)
    expectNear(range.right, header.right, `${at} pills right edge`)
    if (layout === 'below') {
      expectNear(row.left, title.left, `${at} row left edge`)
      expectNear(row.right, header.right, `${at} row right edge`)
    }
  }

  // German labels, wider than the English ones: the pills drop under the switch, and the row stays
  // on the title's left edge and the pills on the card's right edge, with nothing cut off
  await page.setViewportSize({ width: 768, height: 1024 })
  await openPage(page, `/accounts/${account.id}`)
  const control = page.getByRole('tablist', { name: 'Balance chart view' }).filter({ visible: true })
  await control.evaluate((node) => {
    const [balance, change] = node.querySelectorAll('[role="tab"]')
    balance.textContent = 'Kontostand'
    change.textContent = 'Veränderung'
  })
  const { title, header, switchBox, row, range } = await measureHeader(page)
  expect(range.top, 'German pills under the switch').toBeGreaterThanOrEqual(switchBox.bottom)
  expect(row.top, 'German row below the title').toBeGreaterThanOrEqual(title.bottom)
  expectNear(switchBox.left, title.left, 'German switch left edge')
  expectNear(range.right, header.right, 'German pills right edge')
  expect((await measure(control)).clipped).toBe(false)
})
