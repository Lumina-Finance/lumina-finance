import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, type SeededAccount, type TestUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { addImportedItem, editTransaction, linkToEmptyBankAccount } from '../support/bankSync'
import { colourContrast, fillContrast } from '../support/contrast'
import { getTransactionRowButton } from '../support/selectors'
import { AT_EVERY_SIZE_NEEDS_BANK_SYNC } from '../support/bankSyncServer'

// Runs at every size: a touch screen opens the bank icon's tooltip by a tap rather than a hover, and
// transaction rows take their own layout below 750px

// A bank-imported row carries a muted bank icon naming its provider, and a dot once the user has
// edited a value the bank supplied.
//
// Everyday links to an empty bank account at Harbour Bank on the fake SimpleFIN Bridge from the day its
// one transaction was booked. The user adds that transaction to the ledger as the bank sent it, and
// changes its amount where a test needs the dot, so each row carries the source the server gives it
const EDITED_NOTE = 'You edited a value from the bank'

// The day the bank booked its $42.50 grocery spend, the first day Everyday imports from. A manual row
// goes on an earlier day, since the bank supplies every day from this one on
const BANK_DAYS_AGO = 3
const BANK_DATE = daysFromTodayInTestTimezone(-BANK_DAYS_AGO)
const BANK_DESCRIPTION = 'GROCER 123'

// A control's strokes against the page, the least WCAG asks of anything that isn't text
const MIN_GRAPHIC_CONTRAST = 3

// How far below the bank icon a press lands when it just misses, inside the 24px square WCAG asks a
// small target to take presses across
const NEAR_MISS_PX = 4

// Older days seeded under the row scrolled up to the sticky bars. With a heading each they fill more
// than the short window below it at every width, inside the list's first page of fifteen
const OLDER_DAYS = 14
const SHORT_WINDOW_HEIGHT = 600

// How far below the sticky bars the bank icon is scrolled to, too close for the panel to fit above it
const ICON_UNDER_BARS_PX = 2

// How far down the window, as a share of its height, the icon is scrolled to for room above it
const ICON_DOWN_THE_WINDOW = 0.85

// How far below the search and filter bars the app sticks a day heading
const HEADING_GAP_UNDER_BARS_PX = 4

// How far inside the tooltip panel's edges a point is read to find what covers it, clear of the
// border's antialiasing
const PANEL_EDGE_INSET_PX = 2

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

/**
 * Signs up with Everyday, linked to Everyday Chequing at Harbour Bank. The user adds its $42.50 grocery spend
 * to the ledger as the bank sent it, then changes to `editedAmount` minor units where given.
 * Answers with the transaction's id
 */
async function startWithImported(
  request: APIRequestContext,
  editedAmount?: number,
): Promise<{ user: TestUser; account: SeededAccount; id: string }> {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await linkToEmptyBankAccount(request, user, {
    accountId: account.id,
    startDate: BANK_DATE,
    transactions: [{ posted: BANK_DATE, amount: '-42.50', description: BANK_DESCRIPTION }],
  })
  const { id } = await addImportedItem(request, user, account.id, BANK_DESCRIPTION)
  if (editedAmount !== undefined) await editTransaction(request, user, id, { amount: editedAmount })
  return { user, account, id }
}

test('marks a bank-imported row with its provider on hover, focus or a press, leaving the row closed and a manual row unmarked', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, account, id: importedId } = await startWithImported(request)
  const manualId = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -1500,
    date: daysFromTodayInTestTimezone(-(BANK_DAYS_AGO + 1)),
  })
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

  // A pointer opens it on hover if there is one to hover with
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

test('opens the tooltip from a press just off the bank icon, leaving the row closed', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, id } = await startWithImported(request)
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

/**
 * Seeds an edited bank-imported row with older days below it, opens the transactions in a short window
 * and scrolls until the row's bank icon sits just under the sticky bars, where there is no room above it
 */
async function scrollBankIconUnderBars(page: Page, request: APIRequestContext): Promise<{ row: Locator; marker: Locator }> {
  const { user, account, id } = await startWithImported(request, -4000)

  // A day each before it, below it in the list and before the days the bank supplies, so the page runs
  // on far enough to scroll its row up to the bars in a short window
  for (let day = 1; day <= OLDER_DAYS; day += 1) {
    await createTransaction(request, user, {
      accountId: account.id,
      categoryName: 'Groceries',
      amount: -1000,
      date: daysFromTodayInTestTimezone(-(BANK_DAYS_AGO + day)),
    })
  }
  await page.setViewportSize({ ...page.viewportSize()!, height: SHORT_WINDOW_HEIGHT })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const row = page.getByTestId(`transaction-row-${id}`)
  const marker = row.getByRole('button', { name: 'From SimpleFIN, edited', exact: true })
  await expect(marker).toBeVisible()

  // The row's day heading is the last sticky element before the bank icon, and the search and filter
  // bars it sticks under mark themselves as covering the list
  const heading = await marker.evaluateHandle((icon) => [...document.querySelectorAll<HTMLElement>('*')]
    .filter((element) => getComputedStyle(element).position === 'sticky' && !element.contains(icon)
      && element.compareDocumentPosition(icon) & Node.DOCUMENT_POSITION_FOLLOWING)
    .at(-1)!)
  const bars = page.locator('[data-tooltip-cover]')

  // Scrolled until the heading has stuck under the bars and the bank icon sits just under the heading
  await marker.evaluate((icon, { element, iconGap }) => {
    window.scrollBy({ top: element.getBoundingClientRect().top - parseFloat(getComputedStyle(element).top), behavior: 'instant' })
    window.scrollBy({ top: icon.getBoundingClientRect().top - element.getBoundingClientRect().bottom - iconGap, behavior: 'instant' })
  }, { element: heading, iconGap: ICON_UNDER_BARS_PX })

  // Sticking eases the bars into their stuck size, and the heading follows once the app publishes
  // where they now end, so the gap is read once the bars have stuck, nothing in them is easing and
  // the heading sticks where the app places it under them
  await expect(bars).toHaveAttribute('data-stuck', 'true')
  await expect.poll(() => bars.evaluate((element, { stuckHeading, headingGap }) => {
    const isEasing = element.getAnimations({ subtree: true })
      .some((animation) => animation instanceof CSSTransition && animation.playState === 'running')
    const placed = Math.ceil(element.getBoundingClientRect().height) + parseFloat(getComputedStyle(element).top) + headingGap
    return !isEasing && parseFloat(getComputedStyle(stuckHeading).top) === placed
  }, { stuckHeading: heading, headingGap: HEADING_GAP_UNDER_BARS_PX })).toBe(true)
  const gap = await marker.evaluate((icon, element) => icon.getBoundingClientRect().top - element.getBoundingClientRect().bottom, heading)
  // Within a pixel, since the page scrolls by whole pixels and the icon can sit on a half one
  expect(gap).toBeGreaterThanOrEqual(ICON_UNDER_BARS_PX - 1)
  expect(gap).toBeLessThanOrEqual(ICON_UNDER_BARS_PX + 1)
  return { row, marker }
}

/**
 * Focuses the row's title where it sits, since bringing it into view would lift the whole row clear of
 * the bars, and reaches the bank icon from it by keyboard, which shows its tooltip
 */
async function focusBankIconByKeyboard(page: Page, row: Locator): Promise<void> {
  await getTransactionRowButton(row).evaluate((title) => title.focus({ preventScroll: true }))
  await page.keyboard.press('Tab')
}

/** Whether the tooltip's first line sits below the bank icon, or above it */
async function readSideOfIcon(row: Locator, marker: Locator): Promise<'above' | 'below'> {
  const firstLine = (await row.getByText('From SimpleFIN', { exact: true }).filter({ visible: true }).boundingBox())!
  const markerBox = (await marker.boundingBox())!
  return firstLine.y > markerBox.y + markerBox.height ? 'below' : 'above'
}

test('opens the tooltip below the bank icon when the icon sits just under the sticky bars', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { row, marker } = await scrollBankIconUnderBars(page, request)

  // There is no room above the icon below the bars, so the panel opens under it, every line readable
  await focusBankIconByKeyboard(page, row)
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN', EDITED_NOTE])
  expect(await readSideOfIcon(row, marker)).toBe('below')
})

test('picks the side of the bank icon tooltip afresh when a press opens it, rather than keeping where it showed', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { row, marker } = await scrollBankIconUnderBars(page, request)
  await focusBankIconByKeyboard(page, row)
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN', EDITED_NOTE])
  expect(await readSideOfIcon(row, marker)).toBe('below')

  // Scrolled back until the icon is well down the window, where there is room above, the tooltip keeps
  // showing on the side it was placed
  await marker.evaluate((icon, share) => {
    window.scrollBy({ top: icon.getBoundingClientRect().top - window.innerHeight * share, behavior: 'instant' })
  }, ICON_DOWN_THE_WINDOW)
  await expect(marker).toBeFocused()
  await expect.poll(async () => (await marker.boundingBox())!.y).toBeGreaterThan(page.viewportSize()!.height / 2)
  expect(await readSideOfIcon(row, marker)).toBe('below')

  // A press on the focused icon opens it afresh, now above, the side a main tooltip would have kept
  await page.keyboard.press('Enter')
  await expect(marker).toHaveAttribute('aria-expanded', 'true')
  await expect.poll(() => readSideOfIcon(row, marker)).toBe('above')
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN', EDITED_NOTE])
})

test('adds a dot and the edited note to a bank-imported row whose bank value the user changed', AT_EVERY_SIZE_NEEDS_BANK_SYNC, async ({ page, request }) => {
  const { user, id } = await startWithImported(request, -4000)
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

  // The note sits on its own line under the provider, a single line as tall as the provider's
  await getTransactionRowButton(row).focus()
  await page.keyboard.press('Tab')
  await expectTooltipOpen(page, marker, row, ['From SimpleFIN', EDITED_NOTE])
  const [providerLine, noteLine] = await Promise.all(['From SimpleFIN', EDITED_NOTE]
    .map((line) => row.getByText(line, { exact: true }).filter({ visible: true }).boundingBox()))
  expect(noteLine!.height).toBeCloseTo(providerLine!.height, 0)
  await page.keyboard.press('Shift+Tab')
  await expectTooltipClosed(row, 'From SimpleFIN')

  // The icon's strokes and the dot stand out from the page in both themes, the icon looking the same
  // whether or not the row was edited
  await page.mouse.move(0, 0)
  for (const colorScheme of ['light', 'dark'] as const) {
    await switchTheme(page, colorScheme)
    expect(await colourContrast(marker)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST)
    expect(await fillContrast(dot)).toBeGreaterThanOrEqual(MIN_GRAPHIC_CONTRAST)
  }
})
