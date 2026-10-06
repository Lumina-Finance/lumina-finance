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
 * and the light share the rounded corners of an account row. No border another box draws over the row
 * may cover the ring
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

      // Each side of every border another box draws across the row, such as the dashed edge the Upcoming
      // section lays over its rows' sides. Only a positioned box outside the row can be painted over it,
      // and one laid out but unseen is left out
      const rowBox = edgesOf(rowElement!.getBoundingClientRect())
      const borders: (ReturnType<typeof edgesOf> & { side: 'left' | 'right' | 'top' | 'bottom' })[] = []
      for (const other of document.body.querySelectorAll('*')) {
        if (other === rowElement || other.contains(rowElement!) || rowElement!.contains(other)) continue
        const style = getComputedStyle(other)
        if (style.position === 'static' || !other.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
        const box = edgesOf(other.getBoundingClientRect())
        if (box.right <= rowBox.left || box.left >= rowBox.right || box.bottom <= rowBox.top || box.top >= rowBox.bottom) continue
        borders.push(
          { ...box, side: 'left', right: box.left + parseFloat(style.borderLeftWidth) },
          { ...box, side: 'right', left: box.right - parseFloat(style.borderRightWidth) },
          { ...box, side: 'top', bottom: box.top + parseFloat(style.borderTopWidth) },
          { ...box, side: 'bottom', top: box.bottom - parseFloat(style.borderBottomWidth) },
        )
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
        rowBox,
        textBox: text,
        borders,
        pixelRatio: window.devicePixelRatio,
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
      // On the row's own edge, or just inside a border along it, such as the separator along a
      // transaction row's foot or the Upcoming section's edge over its sides
      expect(Math.round(ringInset[edge]), `the ring's ${edge} edge against the row's`).toBeGreaterThanOrEqual(0)
      expect(Math.round(ringInset[edge]), `the ring's ${edge} edge against the row's`).toBeLessThanOrEqual(2)
      expect(textClearance[edge], `the text's clearance from the ring's ${edge} edge`).toBeGreaterThanOrEqual(FOCUS_RING_TEXT_CLEARANCE)
    }

    // The outline is inset by its own width, so the ring is the layer's outer band of that width, and no
    // border another box draws may cross it by more than a pixel's antialiased edge
    const stroke = parseFloat(ring.width)
    const ringSides: Edges[] = [
      { ...ring.box, right: ring.box.left + stroke },
      { ...ring.box, left: ring.box.right - stroke },
      { ...ring.box, bottom: ring.box.top + stroke },
      { ...ring.box, top: ring.box.bottom - stroke },
    ]
    const crosses = (a: Edges, b: Edges) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
    expect(ring.borders.filter((border) => ringSides.some((side) => crosses(border, side))), 'borders drawn across the ring')
      .toEqual([])

    // Where borders run down both of the ring's sides, as the Upcoming section's edge does, the ring keeps
    // the same gap from each as the screen draws them. A box's edges are drawn on the nearest device pixel
    // and its border inward from there, so an inset that isn't a whole number of device pixels rounds the
    // two gaps opposite ways
    const snap = (x: number) => Math.round(x * ring.pixelRatio) / ring.pixelRatio
    const beside = (border: (typeof ring.borders)[number]) => (border.side === 'left' || border.side === 'right')
      && border.right > border.left
      && Math.min(border.bottom, ring.box.bottom) - Math.max(border.top, ring.box.top) > 0.5
    const drawn = (border: (typeof ring.borders)[number]) => border.side === 'right'
      ? { left: snap(border.right) - (border.right - border.left), right: snap(border.right) }
      : { left: snap(border.left), right: snap(border.left) + (border.right - border.left) }
    const leftBorders = ring.borders.filter((border) => beside(border) && border.right <= ring.box.left + 0.5).map(drawn)
    const rightBorders = ring.borders.filter((border) => beside(border) && border.left >= ring.box.right - 0.5).map(drawn)
    if (leftBorders.length > 0 && rightBorders.length > 0) {
      const leftGap = snap(ring.box.left) - Math.max(...leftBorders.map((border) => border.right))
      const rightGap = Math.min(...rightBorders.map((border) => border.left)) - snap(ring.box.right)
      expect(leftGap, 'the ring\'s drawn gap from the border along its left side, against its right side\'s').toBeCloseTo(rightGap, 3)
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

/** What WCAG AA asks of small text against what is behind it */
export const MIN_TEXT_CONTRAST = 4.5

/**
 * The contrast of an element's text against what is behind it, every translucent background
 * between it and the first opaque one blended in
 */
export async function contrastOf(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    type Rgba = [number, number, number, number]
    const parse = (value: string): Rgba => {
      // A colour mixed in CSS computes to the color() form, its channels from 0 to 1
      const mixed = /color\(srgb ([^)]+)\)/.exec(value)?.[1].split(/[\s/]+/).filter(Boolean).map(Number)
      if (mixed) return [mixed[0] * 255, mixed[1] * 255, mixed[2] * 255, mixed[3] ?? 1]
      const channels = /rgba?\(([^)]+)\)/.exec(value)?.[1].split(/[\s,/]+/).filter(Boolean).map(Number)
      if (!channels) throw new Error(`Unreadable colour ${value}`)
      return [channels[0], channels[1], channels[2], channels[3] ?? 1]
    }
    const over = (top: Rgba, bottom: Rgba): Rgba =>
      [0, 1, 2].map((index) => top[index] * top[3] + bottom[index] * (1 - top[3])).concat(1) as Rgba
    const layers: Rgba[] = []
    for (let current: Element | null = node; current; current = current.parentElement) {
      const background = parse(getComputedStyle(current).backgroundColor)
      if (background[3] > 0) layers.unshift(background)
      if (background[3] === 1) break
    }
    const background = layers.reduce<Rgba>((below, layer) => over(layer, below), [255, 255, 255, 1])
    const text = over(parse(getComputedStyle(node).color), background)
    const luminance = (colour: Rgba) => {
      const [red, green, blue] = colour.slice(0, 3).map((channel) => {
        const value = channel / 255
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const [lighter, darker] = [luminance(text), luminance(background)].sort((a, b) => b - a)
    return (lighter + 0.05) / (darker + 0.05)
  })
}
