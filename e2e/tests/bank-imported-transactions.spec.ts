import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { answerAsBankImported, BANK_SOURCE } from '../support/bankSync'
import { getTransactionRowButton } from '../support/selectors'

// A bank-imported row carries a muted bank icon naming its provider, and a dot once the user has
// edited a value the bank supplied. Nothing links an account on the server for a sync to import a
// transaction, so each test answers the app's reads with the source the server attaches. No link is
// answered either, since the marker comes with the transaction and stays once the account is unlinked
const EDITED_NOTE = 'You edited a value the bank supplied'

// A control's strokes against the page, the least WCAG asks of anything that isn't text
const MIN_GRAPHIC_CONTRAST = 3

// How far below the bank icon a press lands when it just misses, inside the 24px square WCAG asks a
// small target to take presses across
const NEAR_MISS_PX = 4

// Older days seeded under the row scrolled up to the sticky bars, which with a heading each fill more
// than the short window below it at every width, inside the list's first page of fifteen
const OLDER_DAYS = 14
const SHORT_WINDOW_HEIGHT = 600

// How far below the bars a row's top may sit and still count as just under them
const JUST_UNDER_PX = 16

// How far inside the tooltip panel's edges a point is read to find what covers it, clear of the
// border's antialiasing
const PANEL_EDGE_INSET_PX = 2

/**
 * How strongly a colour of the element stands out from the first solid background behind it, as the
 * WCAG contrast ratio
 */
async function contrastWithBackground(element: Locator, property: 'color' | 'backgroundColor'): Promise<number> {
  return element.evaluate((node, property) => {
    const parse = (value: string) => {
      if (!value.startsWith('rgb')) throw new Error(`expected an rgb colour, got ${value}`)
      const [r, g, b, alpha = 1] = value.match(/[\d.]+/g)!.map(Number)
      return { r, g, b, alpha }
    }
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const linear = (channel: number) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      }
      return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
    }
    let behind = node.parentElement
    while (behind && parse(getComputedStyle(behind).backgroundColor).alpha < 1) behind = behind.parentElement
    if (!behind) throw new Error('nothing behind the element has a solid background')
    const [lighter, darker] = [
      luminance(parse(getComputedStyle(node)[property])),
      luminance(parse(getComputedStyle(behind).backgroundColor)),
    ].sort((a, b) => b - a)
    return (lighter + 0.05) / (darker + 0.05)
  }, property)
}

/**
 * Switch the system theme the app follows, and wait until the app has taken it and the page has
 * finished fading its background over, so a colour is never read against one halfway between themes
 */
async function switchTheme(page: Page, colorScheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme })
  await expect.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(colorScheme === 'dark')
  await expect.poll(() => page.evaluate(() => document.getAnimations()
    .some((animation) => animation instanceof CSSTransition && animation.playState === 'running'))).toBe(false)
}

/** Whether the element is drawn, counting one inside a faded-out panel as not drawn */
async function isShown(element: Locator): Promise<boolean> {
  return element.evaluate((node) => node.checkVisibility({ opacityProperty: true, visibilityProperty: true }))
}

/** Press a point the way the project's user would: a tap on a touch screen and a click elsewhere */
async function pressAt(page: Page, x: number, y: number): Promise<void> {
  if (test.info().project.use.hasTouch) await page.touchscreen.tap(x, y)
  else await page.mouse.click(x, y)
}

/** Press the middle of what the locator finds, scrolled into view first so the point is on screen */
async function pressMiddleOf(page: Page, element: Locator): Promise<void> {
  await element.scrollIntoViewIfNeeded()
  const box = (await element.boundingBox())!
  await pressAt(page, box.x + box.width / 2, box.y + box.height / 2)
}

/**
 * Assert the marker's tooltip is open with these lines, each below the one before, in a panel that
 * stays on screen, clear of the marker it explains and the first thing a press anywhere on it
 * reaches, so nothing covers any part of it, while the row the marker sits in stays closed
 */
async function expectTooltipOpen(page: Page, marker: Locator, row: Locator, lines: string[]): Promise<void> {
  const shownLines = lines.map((line) => row.getByText(line, { exact: true }).filter({ visible: true }))
  for (const line of shownLines) await expect.poll(() => isShown(line)).toBe(true)

  await expect(async () => {
    const boxes = await Promise.all(shownLines.map((line) => line.boundingBox()))
    for (let index = 1; index < boxes.length; index += 1) {
      expect(boxes[index]!.y).toBeGreaterThanOrEqual(boxes[index - 1]!.y + boxes[index - 1]!.height - 1)
    }

    const placement = await shownLines[0].evaluate((line, { trigger, inset }) => {
      const panel = line.parentElement!
      const box = panel.getBoundingClientRect()
      const markerBox = trigger!.getBoundingClientRect()

      // The middle of each edge, so a bar over part of the panel counts even where it misses the
      // middle of every line, and the middle of each line
      const points = [
        [box.left + box.width / 2, box.top + inset],
        [box.left + box.width / 2, box.bottom - inset],
        [box.left + inset, box.top + box.height / 2],
        [box.right - inset, box.top + box.height / 2],
        ...[...panel.children].map((child) => {
          const lineBox = child.getBoundingClientRect()
          return [lineBox.left + lineBox.width / 2, lineBox.top + lineBox.height / 2]
        }),
      ]
      return {
        isOnScreen: box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight,
        isClearOfMarker: box.bottom <= markerBox.top || box.top >= markerBox.bottom,
        isUncovered: points.every(([x, y]) => {
          const topmost = document.elementFromPoint(x, y)
          return topmost !== null && panel.contains(topmost)
        }),
      }
    }, { trigger: await marker.elementHandle(), inset: PANEL_EDGE_INSET_PX })
    expect(placement).toEqual({ isOnScreen: true, isClearOfMarker: true, isUncovered: true })
  }).toPass({ timeout: 15_000 })

  await expect(page.getByRole('dialog')).toHaveCount(0)
}

/** Assert the marker's tooltip has faded out, read from its first line */
async function expectTooltipClosed(row: Locator, firstLine: string): Promise<void> {
  await expect.poll(() => isShown(row.getByText(firstLine, { exact: true }).filter({ visible: true }))).toBe(false)
}

// A stand-in can still be fetching for the page when a test ends, which would otherwise surface as an
// error outside any test
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' })
})

test('marks a bank-imported row with its provider on hover, focus or a press, leaving the row closed and a manual row unmarked', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const importedId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: BANK_SOURCE.bank_values.amount!,
    date: BANK_SOURCE.bank_values.date,
  })
  const manualId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -1500,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [importedId]: BANK_SOURCE })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const imported = page.getByTestId(`transaction-row-${importedId}`)
  const manual = page.getByTestId(`transaction-row-${manualId}`)
  const marker = imported.getByRole('button', { name: 'From SimpleFIN', exact: true })
  await expect(marker).toBeVisible()
  await expect(imported.getByTestId('bank-edited-dot').filter({ visible: true })).toHaveCount(0)
  await expect(imported.getByText(EDITED_NOTE)).toHaveCount(0)

  // A manual row in the same account looks as it always has, with the title its only control
  await expect(getTransactionRowButton(manual)).toBeVisible()
  await expect(manual.getByRole('button')).toHaveCount(1)

  // Keyboard focus opens it, and moving on closes it
  await getTransactionRowButton(imported).focus()
  await page.keyboard.press('Tab')
  await expect(marker).toBeFocused()
  await expectTooltipOpen(page, marker, imported, ['From SimpleFIN'])
  await page.keyboard.press('Tab')
  await expectTooltipClosed(imported, 'From SimpleFIN')

  // A pointer opens it on hover, where there is one to hover with
  if (!test.info().project.use.hasTouch) {
    await marker.hover()
    await expectTooltipOpen(page, marker, imported, ['From SimpleFIN'])
    await page.mouse.move(0, 0)
    await expectTooltipClosed(imported, 'From SimpleFIN')
  }

  // A press opens it and keeps it open once the pointer leaves, and a press on the open panel stays
  // with the panel rather than reaching the row beneath it
  await pressMiddleOf(page, marker)
  await page.mouse.move(0, 0)
  await expectTooltipOpen(page, marker, imported, ['From SimpleFIN'])
  await pressMiddleOf(page, imported.getByText('From SimpleFIN', { exact: true }).filter({ visible: true }))
  await page.mouse.move(0, 0)
  await expectTooltipOpen(page, marker, imported, ['From SimpleFIN'])

  // A second press on the icon closes it, though the press left the icon focused, since only
  // keyboard focus holds it open
  await pressMiddleOf(page, marker)
  await page.mouse.move(0, 0)
  await expect(marker).toBeFocused()
  await expectTooltipClosed(imported, 'From SimpleFIN')

  // A press anywhere else closes it too
  await pressMiddleOf(page, marker)
  await expectTooltipOpen(page, marker, imported, ['From SimpleFIN'])
  await pressMiddleOf(page, page.getByRole('heading', { name: 'Transactions', level: 1 }))
  await expectTooltipClosed(imported, 'From SimpleFIN')
})

test('opens the tooltip from a press just off the bank icon, leaving the row closed', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: BANK_SOURCE.bank_values.amount!,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [id]: BANK_SOURCE })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // The row opens on a press anywhere else, so a near miss on the small icon still has to open the
  // tooltip
  const row = page.getByTestId(`transaction-row-${id}`)
  const marker = row.getByRole('button', { name: 'From SimpleFIN', exact: true })
  await marker.scrollIntoViewIfNeeded()
  const box = (await marker.boundingBox())!
  await pressAt(page, box.x + box.width / 2, box.y + box.height + NEAR_MISS_PX)
  await page.mouse.move(0, 0)
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN'])
})

test('opens the tooltip below the bank icon when the row sits just under the sticky bars', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4000,
    date: BANK_SOURCE.bank_values.date,
  })

  // A day each before it, below it in the list, so the page runs on far enough to scroll its row up
  // to the bars in a short window
  for (let day = 1; day <= OLDER_DAYS; day += 1) {
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -1000,
      date: `2026-01-${String(15 - day).padStart(2, '0')}`,
    })
  }
  await page.setViewportSize({ ...page.viewportSize()!, height: SHORT_WINDOW_HEIGHT })
  await answerAsBankImported(page, { [id]: { ...BANK_SOURCE, edited_fields: ['amount'] } })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const row = page.getByTestId(`transaction-row-${id}`)
  const marker = row.getByRole('button', { name: 'From SimpleFIN, edited', exact: true })
  await expect(marker).toBeVisible()

  // Scrolled until the row's day heading has just stuck under the search and filter bars, which
  // leaves the row right under the heading. Retried while the bars settle into their stuck size
  await expect(async () => {
    const gap = await row.evaluate((node) => {
      const heading = [...document.querySelectorAll<HTMLElement>('*')]
        .filter((element) => getComputedStyle(element).position === 'sticky' && !element.contains(node)
          && element.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
        .at(-1)!
      window.scrollBy({ top: heading.getBoundingClientRect().top - parseFloat(getComputedStyle(heading).top), behavior: 'instant' })
      return node.getBoundingClientRect().top - heading.getBoundingClientRect().bottom
    })
    expect(gap).toBeGreaterThanOrEqual(-1)
    expect(gap).toBeLessThan(JUST_UNDER_PX)
  }).toPass()

  // There is no room above the icon below the bars, so the panel opens under it, every line readable
  await getTransactionRowButton(row).focus()
  await page.keyboard.press('Tab')
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN', EDITED_NOTE])
  const firstLine = (await row.getByText('From SimpleFIN', { exact: true }).filter({ visible: true }).boundingBox())!
  const markerBox = (await marker.boundingBox())!
  expect(firstLine.y).toBeGreaterThan(markerBox.y + markerBox.height)
})

test('adds a dot and the edited note to a bank-imported row whose bank value the user changed', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -4000,
    date: BANK_SOURCE.bank_values.date,
  })
  await answerAsBankImported(page, { [id]: { ...BANK_SOURCE, edited_fields: ['amount'] } })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // The closed panel isn't read, so the marker's name says the value was edited
  const row = page.getByTestId(`transaction-row-${id}`)
  const marker = row.getByRole('button', { name: 'From SimpleFIN, edited', exact: true })
  const dot = row.getByTestId('bank-edited-dot').filter({ visible: true })
  await expect(marker).toBeVisible()
  await expect(dot).toBeVisible()

  // The dot sits on the icon's corner rather than wherever the row would put it
  const [dotBox, markerBox] = [(await dot.boundingBox())!, (await marker.boundingBox())!]
  expect(dotBox.x < markerBox.x + markerBox.width && markerBox.x < dotBox.x + dotBox.width).toBe(true)
  expect(dotBox.y < markerBox.y + markerBox.height && markerBox.y < dotBox.y + dotBox.height).toBe(true)

  // The note sits on its own line under the provider
  await getTransactionRowButton(row).focus()
  await page.keyboard.press('Tab')
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN', EDITED_NOTE])
  await page.keyboard.press('Shift+Tab')
  await expectTooltipClosed(row, 'From SimpleFIN')

  // The icon's strokes and the dot stand out from the page in both themes, the icon looking the same
  // whether or not the row was edited
  await page.mouse.move(0, 0)
  for (const colorScheme of ['light', 'dark'] as const) {
    await switchTheme(page, colorScheme)
    expect(await contrastWithBackground(marker, 'color')).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST)
    expect(await contrastWithBackground(dot, 'backgroundColor')).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST)
  }
})
