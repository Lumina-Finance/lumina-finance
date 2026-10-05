import { expect, type Locator, type Page, type Request, type Route } from '@playwright/test'

import { API_BASE_URL } from './target'

const NO_CONTENT_STATUS = 204

/** The true minus sign the app puts before an amount that moved out, which a hyphen never matches */
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

type Edges = { left: number; top: number; right: number; bottom: number }

// How far the row's text keeps clear of the ring on every side, so the ring never touches a line
const FOCUS_RING_TEXT_CLEARANCE = 4

// The corners of a focused row's ring and light, which are those of the rounded-xl account row
const FOCUS_RING_RADIUS = '12px'

/**
 * Assert keyboard focus on a control stretched over its row rings the row in the app's accent focus
 * outline, read from the layer the control lays over the row, which is what draws it
 *
 * The ring has to run around the row's own box, so it goes round the whole row with the row's padding
 * inside it rather than tight around the text, and every line of the row's text has to clear it. The
 * row is lit in the accent's soft tint as well, by its own background or by the layer, and the ring
 * and the light share the rounded corners of an account row
 */
export async function expectStretchedFocusRing(control: Locator, row: Locator): Promise<void> {
  // The pointer is kept off the row, so the light that a hover also gives can only come from the focus
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
      const accent = resolve('var(--app-accent)')
      const accentSoft = resolve('var(--app-accent-soft)')
      probe.remove()
      const layer = getComputedStyle(element, '::after')
      const rowStyle = getComputedStyle(rowElement!)
      const lit = [layer, rowStyle].find((style) => style.backgroundColor === accentSoft)

      // The layer is placed against the nearest positioned ancestor, measured from inside its border
      const block = (element as HTMLElement).offsetParent as HTMLElement
      const blockBox = block.getBoundingClientRect()
      const left = blockBox.left + block.clientLeft + parseFloat(layer.left)
      const top = blockBox.top + block.clientTop + parseFloat(layer.top)

      // Every line of text on screen in the row, leaving out what is laid out but unseen, such as a
      // closed tooltip's faded panel
      let text: ReturnType<typeof edgesOf> | null = null
      const walker = document.createTreeWalker(rowElement!, NodeFilter.SHOW_TEXT)
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
        position: layer.position,
        style: layer.outlineStyle,
        width: layer.outlineWidth,
        color: layer.outlineColor,
        accent,
        radius: layer.borderRadius,
        litRadius: lit?.borderRadius ?? null,
        box: { left, top, right: left + parseFloat(layer.width), bottom: top + parseFloat(layer.height) },
        rowBox: edgesOf(rowElement!.getBoundingClientRect()),
        textBox: text,
      }
    }, rowElement)
    expect({ position: ring.position, style: ring.style, width: ring.width, color: ring.color })
      .toEqual({ position: 'absolute', style: 'solid', width: '2px', color: ring.accent })

    // The light is null where neither the row nor the layer carries the tint
    expect({ radius: ring.radius, litRadius: ring.litRadius })
      .toEqual({ radius: FOCUS_RING_RADIUS, litRadius: FOCUS_RING_RADIUS })

    // How far each edge of the inner box sits inside the outer one, negative where it pokes out
    const inset = (outer: Edges, inner: Edges): Edges => ({
      left: inner.left - outer.left,
      top: inner.top - outer.top,
      right: outer.right - inner.right,
      bottom: outer.bottom - inner.bottom,
    })
    expect(ring.textBox).not.toBeNull()
    const ringInset = inset(ring.rowBox, ring.box)
    const textClearance = inset(ring.box, ring.textBox!)
    for (const edge of ['left', 'top', 'right', 'bottom'] as const) {
      // On the row's own edge, or just inside its border, which on a transaction row is the separator along its foot
      expect(Math.round(ringInset[edge]), `the ring's ${edge} edge against the row's`).toBeGreaterThanOrEqual(0)
      expect(Math.round(ringInset[edge]), `the ring's ${edge} edge against the row's`).toBeLessThanOrEqual(1)
      expect(textClearance[edge], `the text's clearance from the ring's ${edge} edge`).toBeGreaterThanOrEqual(FOCUS_RING_TEXT_CLEARANCE)
    }
  }).toPass()
}

/**
 * Assert a scoped row opens from a button named by its title alone and described by its amount, and
 * has exactly one rendered responsive amount
 *
 * A name holding the amount would mean the button is named by the whole row, which a screen reader
 * then reads twice, once as the button and once as the content. The description is what tabbing from
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
