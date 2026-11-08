import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test'

import { API_BASE_URL } from './target'

const NO_CONTENT_STATUS = 204

/** The true minus sign the app puts before an amount that moved out. A hyphen never matches it */
export const MINUS = String.fromCodePoint(0x2212)

/** Assert identity selection still finds an accessible pending action */
export async function expectPendingAction(action: Locator, name: string): Promise<void> {
  await expect(action).toHaveRole('button')
  await expect(action).toHaveAccessibleName(name)
  await expect(action).toBeDisabled()
  await expect(action).toHaveAttribute('aria-busy', 'true')
}

/** Hold an own-resource mutation while asserting pending UI, then await its real response */
export async function whileApiRequestHeld(
  page: Page,
  method: 'POST' | 'PATCH' | 'DELETE',
  path: string,
  click: () => Promise<void>,
  checkPending: () => Promise<void>,
  body?: Record<string, string>,
): Promise<void> {
  let release!: () => void
  let markFinished!: () => void
  let intercepted = false
  let holding = true
  let mutation: Request | undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  const finished = new Promise<void>((resolve) => { markFinished = resolve })
  const url = `${API_BASE_URL}${path}`

  /** Match the mutation's method and synthetic record before holding its network request */
  const handler = async (route: Route): Promise<void> => {
    const request = route.request()
    if (!holding || request.method() !== method) {
      await route.fallback()
      return
    }
    if (body) {
      const data = request.postDataJSON() as Record<string, unknown>
      if (!Object.entries(body).every(([key, value]) => data[key] === value)) {
        await route.fallback()
        return
      }
    }
    intercepted = true
    mutation = request
    try {
      await held
      await route.continue()
    } finally {
      markFinished()
    }
  }

  await page.route(url, handler)
  try {
    await click()
    await expect.poll(() => intercepted, { message: 'Own-resource mutation was intercepted' }).toBe(true)
    await checkPending()
    release()
    await finished

    // Dispatch is not completion, so start post-save UI checks only after the server answers
    const response = await mutation!.response()
    expect(response, 'The held mutation must receive a response').not.toBeNull()
    expect(response!.ok(), `The held mutation returned HTTP ${response!.status()}`).toBe(true)

    // Chromium does not reliably finish intercepted no-content responses through this API
    if (response!.status() !== NO_CONTENT_STATUS) {
      expect(await response!.finished(), 'The held mutation response must finish').toBeNull()
    }
  } finally {
    // Removing the last route here can race with the app's post-mutation refetches
    // Keep an inactive passthrough until this test's browser context is disposed
    holding = false
    release()
    if (intercepted) await finished
  }
}

/**
 * Find the button that opens a transaction row, given the row's content
 *
 * The button is the row's title, stretched over the row. Each responsive layout has its own title
 * and only the one on screen is exposed, where it comes before the controls beside it
 */
export function getTransactionRowButton(row: Locator): Locator {
  return row.getByRole('button').first()
}

/**
 * Find an account's row on the accounts page by the account's name
 *
 * The row's link is the name alone, stretched over the row, so the balance and anything else the row
 * shows beside the name is read from the row rather than from the link
 */
export function getAccountRow(page: Page, name: string): Locator {
  return page.getByTestId(/^account-row-/).filter({ has: page.getByRole('link', { name, exact: true }) })
}

type Edges = { left: number; top: number; right: number; bottom: number }

// How far the row's text keeps clear of the ring's inner edge on every side, so the ring never touches a line
const FOCUS_RING_TEXT_CLEARANCE = 4

/**
 * Assert keyboard focus on a control stretched over its row rings the row in the app's focus colour
 *
 * The ring is the row's own, drawn by the shared focus rule on the row's box inside the one given,
 * rather than by the control. The control draws none. The ring has to sit against that box's edge and
 * inside it, and every line of the box's text has to clear its inner edge. Focus does not light the box in the
 * accent's soft tint, since the ring falls under 3:1 against that tint on the light theme's page
 */
export async function expectStretchedFocusRing(control: Locator, row: Locator): Promise<void> {
  // The pointer is kept off the row, so any light on it could only come from the focus
  await control.page().mouse.move(0, 0)
  await control.focus()

  // Back a step and forward again, so the focus arrives from the keyboard as a user's would
  await control.page().keyboard.press('Shift+Tab')
  await control.page().keyboard.press('Tab')
  await expect(control).toBeFocused()
  const rowElement = await row.elementHandle()

  // Measured in one pass, and again until the list has settled, since a row still growing in or a
  // list still moving would put the ring and the row in different places between two measurements
  await expect(async () => {
    const ring = await control.evaluate((element, rowElement) => {
      const edgesOf = ({ left, top, right, bottom }: DOMRect) => ({ left, top, right, bottom })
      const probe = document.createElement('span')
      element.append(probe)
      const resolve = (color: string) => {
        probe.style.color = color
        return getComputedStyle(probe).color
      }
      const focusRing = resolve('var(--app-focus-ring)')
      const accentSoft = resolve('var(--app-accent-soft)')
      probe.remove()

      // The nearest box around the control that draws an outline. That is the box the ring belongs to
      let frame: Element | null = element
      while (frame && getComputedStyle(frame).outlineStyle === 'none') frame = frame.parentElement
      const ringStyle = frame ? getComputedStyle(frame) : null
      const ringBox = frame ?? rowElement!
      const lit = [getComputedStyle(element), getComputedStyle(ringBox)].some(
        (style) => style.backgroundColor === accentSoft,
      )

      // Every line of text on screen in the ring's box, leaving out what is laid out but unseen, such as a
      // closed tooltip's faded panel
      let text: ReturnType<typeof edgesOf> | null = null
      const walker = document.createTreeWalker(ringBox, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        if (!node.textContent?.trim() || !parent?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const line = edgesOf(range.getBoundingClientRect())
        // A glyph's box can reach past its line. An emoji's font metrics, for one, are taller than the line it
        // is set in. What is seen of it is inside the line's own box, so that is where it is measured
        const lineBox = parent.getBoundingClientRect()
        line.top = Math.max(line.top, lineBox.top)
        line.bottom = Math.min(line.bottom, lineBox.bottom)
        text = text
          ? {
            left: Math.min(text.left, line.left),
            top: Math.min(text.top, line.top),
            right: Math.max(text.right, line.right),
            bottom: Math.max(text.bottom, line.bottom),
          }
          : line
      }

      return {
        drawnInRow: frame !== null && rowElement!.contains(frame),
        style: ringStyle?.outlineStyle,
        width: ringStyle?.outlineWidth,
        color: ringStyle?.outlineColor,
        offset: ringStyle ? parseFloat(ringStyle.outlineOffset) : Number.NaN,
        radius: ringStyle ? parseFloat(ringStyle.borderTopLeftRadius) || 0 : 0,
        focusRing,
        lit,
        rowBox: edgesOf(ringBox.getBoundingClientRect()),
        textBox: text,
      }
    }, rowElement)
    expect({ drawnInRow: ring.drawnInRow, style: ring.style, width: ring.width, color: ring.color })
      .toEqual({ drawnInRow: true, style: 'solid', width: '2px', color: ring.focusRing })
    expect(ring.lit, 'the ring\'s box lit in the accent tint').toBe(false)

    // The ring sits against the row's edge, inside it, so the row beside it cannot cover it
    expect(ring.offset, "the ring's gap from the row's edge").toBe(-2)

    // The ring's inner edge is the row's edge pulled in by the gap, and the text stays clear of it
    expect(ring.textBox).not.toBeNull()
    const inner: Edges = {
      left: ring.rowBox.left - ring.offset,
      top: ring.rowBox.top - ring.offset,
      right: ring.rowBox.right + ring.offset,
      bottom: ring.rowBox.bottom + ring.offset,
    }
    const clearance: Edges = {
      left: ring.textBox!.left - inner.left,
      top: ring.textBox!.top - inner.top,
      right: inner.right - ring.textBox!.right,
      bottom: inner.bottom - ring.textBox!.bottom,
    }
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
      expect(clearance[edge], `the text's clearance from the ring's ${edge} edge`).toBeGreaterThanOrEqual(FOCUS_RING_TEXT_CLEARANCE)
    }

    // The ring follows the row's corners, so a rounded row cuts its corners off the ring's inner edge. Each corner of
    // the text stays inside that arc
    const arcs = [
      { x: ring.textBox!.left, y: ring.textBox!.top, from: [inner.left, inner.top], toward: [1, 1] },
      { x: ring.textBox!.right, y: ring.textBox!.top, from: [inner.right, inner.top], toward: [-1, 1] },
      { x: ring.textBox!.left, y: ring.textBox!.bottom, from: [inner.left, inner.bottom], toward: [1, -1] },
      { x: ring.textBox!.right, y: ring.textBox!.bottom, from: [inner.right, inner.bottom], toward: [-1, -1] },
    ]
    for (const { x, y, from, toward } of arcs) {
      const along = (x - from[0]) * toward[0]
      const down = (y - from[1]) * toward[1]
      if (along < ring.radius && down < ring.radius) {
        expect(Math.hypot(ring.radius - along, ring.radius - down), "the text's corner against the row's rounded corner").toBeLessThanOrEqual(ring.radius)
      }
    }
  }).toPass()
}

/**
 * Assert a scoped row opens from a button named by its title alone and described by its amount, and
 * has exactly one rendered responsive amount
 *
 * A name holding the amount would mean the button is named by the whole row. A screen reader
 * then reads it twice, once as the button and once as the content. The description is what tabbing from
 * row to row hears of the amount
 */
export async function expectTransactionRow(page: Page, id: string, amount: string): Promise<void> {
  const row = page.getByTestId(`transaction-row-${id}`)
  await expect(row).toBeVisible()
  const button = getTransactionRowButton(row)
  const amountPattern = new RegExp(amount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  await expect(button).toBeVisible()
  await expect(button).toHaveAccessibleName(/\S/)
  await expect(button).not.toHaveAccessibleName(amountPattern)
  await expect(button).toHaveAccessibleDescription(amountPattern)
  const amounts = row.getByTestId('transaction-amount')
  await expect(amounts).toHaveCount(2)
  const visibleAmount = amounts.filter({ visible: true })
  await expect(visibleAmount).toHaveCount(1)
  await expect(visibleAmount).toHaveText(amount)
}

/**
 * The boxes of the elements given, read at one instant, so a modal still scrolling to a section
 * moves them all alike
 */
export async function readBoxes(page: Page, locators: Locator[]): Promise<{ x: number; y: number; width: number; height: number }[]> {
  const elements = await Promise.all(locators.map((locator) => locator.elementHandle()))
  return page.evaluate((targets) => targets.map((target) => {
    const { x, y, width, height } = target!.getBoundingClientRect()
    return { x, y, width, height }
  }), elements)
}

/**
 * Returns whether nothing is drawn over the element at its centre or near any of its four edges, so
 * something covering only part of it, such as an open list, still counts as covering it. The points
 * stay clear of the corners. A pill button's rounding leaves them outside the button
 */
export async function isUncovered(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const middleX = box.left + box.width / 2
    const middleY = box.top + box.height / 2
    const inset = box.height / 2
    const points = [
      [middleX, middleY],
      [middleX, box.top + 2],
      [middleX, box.bottom - 2],
      [box.left + inset, middleY],
      [box.right - inset, middleY],
    ]
    return points.every(([x, y]) => {
      const shown = document.elementFromPoint(x, y)
      return shown !== null && element.contains(shown)
    })
  })
}

// How far in from the screen's right and bottom edges the app shows a message when nothing is in its way
export const MESSAGE_IN_CORNER = { right: 20, bottom: 20 }

/**
 * How far in from the screen's right and bottom edges the message sits
 */
export async function readMessageInset(message: Locator): Promise<{ right: number; bottom: number }> {
  return message.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const screen = document.documentElement
    return { right: Math.round(screen.clientWidth - box.right), bottom: Math.round(screen.clientHeight - box.bottom) }
  })
}

/**
 * Asserts the message sits in the screen's bottom-right corner, read once it has finished coming in
 */
export async function expectMessageInCorner(message: Locator): Promise<void> {
  await expect(message).toHaveCSS('opacity', '1')
  expect(await readMessageInset(message)).toEqual(MESSAGE_IN_CORNER)
}
