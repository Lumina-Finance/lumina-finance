import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  budgetPeriodStart,
  createAccount,
  createMonthlyBudget,
  createTaxAdvantagedCategory,
  createTransaction,
  daysFromTodayInTestTimezone,
  enrollTotp,
  signUpUser,
} from '../support/api'
import { logInViaApi, openModal, openPage, reachTwoFactorChallenge, signUpThroughTheForm } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs on desktop only, apart from four groups that run at every size. The focus ring on each kind
// of control does so because the toolbar changes below 750px, the Settings section menu and
// card row tests because the menu and the card change with the width too, and the whole-ring test
// because the filters, charts and rows are laid out differently at each size. The date-range control
// tests set their own sizes.

/**
 * Guards the keyboard focus indicator. It used to be a tint at about a tenth of the accent's strength,
 * which nobody could see, the search fields drew none at all, and a focused transaction row showed only
 * a cream tint on cream that stopped short of the row's edges
 */

type FocusRing = {
  kind: 'outline' | 'border'
  style: string
  width: string
  offset: string
  opaque: boolean
  clipped: boolean
  contrast: number
}

/**
 * Reads the focus drawn for the focused element, from the element itself or the nearest frame around it
 * that draws it, such as a date field around its day box. A field draws its border in the focus colour,
 * doubled from the inside by a shadow of the same colour, so its width is the two together. Anything
 * else, such as a row or a button without a border, draws an outline. The contrast is against what the ring is drawn on, worked out from the colours
 * the browser resolved and any fade around the frame, so it is the ratio on screen. Null when nothing
 * draws focus
 */
async function readFocusRing(element: Locator): Promise<FocusRing | null> {
  return element.evaluate((node) => {
    const channels = (colour: string) => colour.match(/[\d.]+/g)!.map(Number)
    // The inner shadow that doubles a field's border, as its colour and its spread in pixels
    const doubling = (style: CSSStyleDeclaration) => {
      const shadow = style.boxShadow.match(/^(rgba?\([^)]*\)) 0px 0px 0px ([\d.]+)px inset$/)
      return shadow && shadow[1] === style.borderTopColor ? { colour: shadow[1], spread: Number(shadow[2]) } : null
    }
    // A control holds a clear outline at rest so its ring can fade in, which draws nothing
    const draws = (style: CSSStyleDeclaration) => style.outlineStyle !== 'none' && (channels(style.outlineColor)[3] ?? 1) > 0
    let frame: Element | null = node
    while (frame && !draws(getComputedStyle(frame)) && !doubling(getComputedStyle(frame))) frame = frame.parentElement
    if (!frame || frame === document.body) return null
    const style = getComputedStyle(frame)
    const border = draws(style) ? null : doubling(style)
    const colour = border ? border.colour : style.outlineColor

    // What the ring is drawn on: the page, then every fill down to the frame's parent, and the frame's own
    // fill too when the ring is drawn inside its edge, where the frame is what sits behind it. The layers
    // are blended on a canvas so the ratio is the one on screen, whatever colour format the browser resolved
    const probe = document.createElement('div')
    probe.style.background = 'var(--app-bg)'
    document.body.append(probe)
    const fills = [getComputedStyle(probe).backgroundColor]
    probe.remove()
    const drawnInside = Boolean(border) || parseFloat(style.outlineOffset) < 0
    for (let box: Element | null = drawnInside ? frame : frame.parentElement; box; box = box.parentElement) fills.splice(1, 0, getComputedStyle(box).backgroundColor)
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    for (const fill of fills) {
      context.fillStyle = fill
      context.fillRect(0, 0, 1, 1)
    }
    const page = `rgb(${Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(', ')})`

    // A faded frame, such as a dialog fading in, fades its ring with it, so the ring on screen is its
    // colour mixed into the page by however much the frame and everything around it are faded
    let fade = 1
    for (let faded: Element | null = frame; faded; faded = faded.parentElement) fade *= Number(getComputedStyle(faded).opacity)

    const behind = channels(page)
    const onScreen = channels(colour).slice(0, 3).map((channel, index) => channel * fade + behind[index] * (1 - fade))
    const luminance = ([r, g, b]: number[]) => {
      const [lr, lg, lb] = [r, g, b].map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
    }
    const [lighter, darker] = [luminance(onScreen), luminance(behind)].sort((a, b) => b - a)
    // An outline reaches past the frame by its gap and width, and a border not at all. Any box around it
    // that clips its contents and doesn't hold all of that cuts it off
    const reach = border ? 0 : parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
    const ring = frame.getBoundingClientRect()
    // A ring drawn inside the control's edge and a box around it can differ by a fraction of a pixel once
    // layout rounds them, which cuts nothing. A ring drawn outside keeps no such allowance
    const slack = drawnInside && !border ? 0.5 : 0
    let clipped = false
    for (let box = frame.parentElement; box; box = box.parentElement) {
      if (getComputedStyle(box).overflow === 'visible') continue
      const edge = box.getBoundingClientRect()
      if (ring.left - reach < edge.left - slack || ring.top - reach < edge.top - slack || ring.right + reach > edge.right + slack || ring.bottom + reach > edge.bottom + slack) clipped = true
    }

    return {
      kind: border ? 'border' : 'outline',
      style: border ? style.borderTopStyle : style.outlineStyle,
      width: border ? `${parseFloat(style.borderTopWidth) + border.spread}px` : style.outlineWidth,
      offset: border ? '0px' : style.outlineOffset,
      opaque: (channels(colour)[3] ?? 1) === 1,
      clipped,
      contrast: (lighter + 0.05) / (darker + 0.05),
    }
  })
}

/**
 * Puts focus on an element the way a keyboard user arrives there, so it matches `:focus-visible`, then
 * brings it to the middle of whatever scrolls it. Focus scrolls only as far as the element's own edge,
 * which can leave the ring just past the edge of a scrolling dialog body, and that is where the page
 * scrolls to rather than how the ring is drawn
 */
async function focusFromKeyboard(page: Page, element: Locator): Promise<void> {
  await page.keyboard.press('Shift')
  await element.focus()
  await element.evaluate((node) => node.scrollIntoView({ block: 'center', inline: 'center' }))
}

/**
 * Expects the shared focus on an element: a solid 2px line, opaque, whole and at least 3:1 against the
 * page, drawn as an outline at the given gap or as the control's own border. Read until it holds, since a
 * dialog fades in after it opens and the focus inside it fades in with it
 */
async function expectSharedRing(element: Locator, kind: FocusRing['kind'], offset = '0px') {
  await expect.poll(async () => {
    const ring = await readFocusRing(element)
    return ring && { ...ring, contrast: ring.contrast >= 3 }
  }, { message: `focus on ${element}` }).toEqual({ kind, style: 'solid', width: '2px', offset, opaque: true, clipped: false, contrast: true })
}

/** What a button's look is made of, read off the element and the row or frame its hover look may fall on */
async function readLook(element: Locator) {
  return element.evaluate(async (node) => {
    // A look is read once the transitions it started have finished, so a hover that has only just
    // begun is not taken for the finished look
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    await Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished.catch(() => undefined)))
    const properties = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'boxShadow', 'transform', 'opacity', 'textDecorationLine'] as const
    // A button inside a row that takes the hover look for it, such as a transaction row, shows the look on the row
    const frame = node.closest('.app-transaction-row, .app-range-glass') ?? node
    const looks = [node, frame].map((box) => Object.fromEntries(properties.map((property) => [property, getComputedStyle(box)[property]])))
    return { button: looks[0], frame: looks[1] }
  })
}

/** Reads a look once its transitions have finished, which is when two reads in a row agree */
async function settledLook(element: Locator) {
  let previous = await readLook(element)
  await expect.poll(async () => {
    const next = await readLook(element)
    const settled = JSON.stringify(next) === JSON.stringify(previous)
    previous = next
    return settled
  }).toBe(true)
  return previous
}

/**
 * Expects a button reached by keyboard to look exactly as it does under the pointer, and returns the look
 * so a caller can also compare it with the button at rest. A button with a border of its own draws no
 * outline. One without, such as a filled button, an icon button or a segmented option, also
 * draws the shared ring at the given gap
 */
async function expectHoverLook(page: Page, element: Locator, ring: { offset: string } | null = null) {
  await page.mouse.move(0, 0)
  const rest = await settledLook(element)
  await focusFromKeyboard(page, element)
  await expect(element).toBeFocused()
  const focused = await settledLook(element)
  if (ring) await expectSharedRing(element, 'outline', ring.offset)
  else expect(await element.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')

  // A touch screen has no hover, so a hover: utility has no pointer look to match there
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
    await element.evaluate((node) => (node as HTMLElement).blur())
    await element.hover()
    const hovered = await settledLook(element)
    expect(focused).toEqual(hovered)
    await page.mouse.move(0, 0)
  }
  return { rest, focused }
}

async function seedOneTransaction(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -1000,
    date: daysFromTodayInTestTimezone(-1),
  })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  return page.getByTestId(`transaction-row-${id}`)
}

/**
 * Measures the contrast of an element's text against what is drawn behind it: every ancestor's fill down
 * to the element's own, and the sliding highlight beside it that tints the selected option. The layers
 * are blended on a canvas so the ratio is the one on screen, whatever colour format the browser resolved
 */
async function readTextContrast(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const pixel = (layers: string[]) => {
      context.clearRect(0, 0, 1, 1)
      for (const layer of layers) {
        context.fillStyle = layer
        context.fillRect(0, 0, 1, 1)
      }
      return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3))
    }
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const channel = value / 255
        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }

    const fills: string[] = []
    const indicator = node.parentElement?.querySelector('[class*="indicator"]')
    for (let ancestor: Element | null = node; ancestor; ancestor = ancestor.parentElement) fills.unshift(getComputedStyle(ancestor).backgroundColor)
    if (indicator) fills.splice(fills.length - 1, 0, getComputedStyle(indicator).backgroundColor)

    const [high, low] = [luminance(pixel(fills)), luminance(pixel([getComputedStyle(node).color]))].sort((a, b) => b - a)
    return (high + 0.05) / (low + 0.05)
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  // One control of each kind the app styles, on the toolbar and in the Add transaction dialog, shows the
  // right focus: a field on its own border, a button with a border of its own as it looks under the
  // pointer with no ring, and one without a border as it looks under the pointer with the ring too
  test(`shows the same keyboard focus on each kind of control in the ${colorScheme} theme`, AT_EVERY_SIZE, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Everyday' })

    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    const toolbar = [
      page.getByRole('textbox', { name: /Search transactions/ }),
    ]
    for (const control of toolbar) {
      await focusFromKeyboard(page, control)
      await expectSharedRing(control, 'border')
    }
    // Buttons and pills with a border of their own show their hover look alone, whatever they are drawn with
    const hoverButtons = [
      page.getByRole('button', { name: 'Select transactions', exact: true }),
      // The phone toolbar has no Filters pill, only a button that opens a sheet
      ...page.viewportSize()!.width >= 750 ? [page.getByRole('button', { name: 'Transaction filters', exact: true })] : [],
      ...page.viewportSize()!.width < 1050 ? [page.getByRole('button', { name: 'Open navigation menu', exact: true })] : [],
    ]
    for (const control of hoverButtons) await expectHoverLook(page, control)

    const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
    const fields = [
      dialog.getByLabel('Amount'),
      dialog.getByRole('group', { name: 'Date', exact: true }).getByRole('textbox', { name: 'Day', exact: true }),
      dialog.getByRole('combobox').first(),
    ]
    for (const control of fields) {
      await focusFromKeyboard(page, control)
      await expectSharedRing(control, 'border')
    }
    await expectHoverLook(page, dialog.getByRole('button', { name: 'Cancel', exact: true }))
    // A segmented option and a filled button have no border, so they keep the ring on top of the look
    await expectHoverLook(page, dialog.getByRole('tab').first(), { offset: '2px' })
    await expectHoverLook(page, dialog.getByRole('button', { name: 'Add transaction', exact: true }), { offset: '2px' })
  })

  // The selected option's text keeps 4.5:1 on the deeper tint it takes under the pointer, which the
  // accent colour itself falls short of in the light theme
  test(`keeps a hovered selected option's text readable in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Everyday' })
    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
    const selected = dialog.getByRole('tab', { selected: true }).first()

    const atRest = await readTextContrast(selected)
    await selected.hover()
    await expect.poll(() => readTextContrast(selected).then((ratio) => ratio !== atRest)).toBe(true)
    expect(await readTextContrast(selected)).toBeGreaterThanOrEqual(4.5)
  })

  // A row has no border, so it keeps the ring, drawn around the row itself inside its edges where the
  // next row can't cover it, and shows its hover look as well. The same holds when its checkbox while
  // selecting holds focus, which also turns its own border the focus colour
  test(`shows a transaction row's ring and hover look on keyboard focus in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const rowButton = await seedOneTransaction(page, request)
    const row = rowButton.locator('..')

    const { rest, focused } = await expectHoverLook(page, rowButton, null)
    expect(focused.frame.backgroundColor).not.toBe(rest.frame.backgroundColor)
    await focusFromKeyboard(page, rowButton)
    await expectSharedRing(row, 'outline', '-2px')

    await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
    const checkbox = row.getByRole('checkbox')
    await focusFromKeyboard(page, checkbox)
    await expect(checkbox).toBeFocused()
    await expectSharedRing(checkbox, 'border')
    await expectSharedRing(row, 'outline', '-2px')
    await expect.poll(async () => (await readLook(row)).button.backgroundColor).toBe(focused.frame.backgroundColor)
  })
}

// Every stop on the way through the page and a dialog, links, charts and info buttons included, shows
// the app's focus rather than the browser's own ring, which Chrome reports as an outline style of auto
test('never shows the browser focus ring when tabbing through the app', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedOneTransaction(page, request)
  const browserRings = new Set<string>()
  const tabThrough = async (stops: number) => {
    for (let stop = 0; stop < stops; stop++) {
      await page.keyboard.press('Tab')
      const ring = await page.evaluate(() => {
        const node = document.activeElement
        return node && getComputedStyle(node).outlineStyle === 'auto' ? `${node.tagName} ${node.textContent?.trim().slice(0, 30)}` : null
      })
      if (ring) browserRings.add(ring)
    }
  }

  await tabThrough(30)
  await openModal(page, ['Add transaction'], 'Add transaction')
  await tabThrough(15)
  expect([...browserRings]).toEqual([])
})

// An info icon reached from the keyboard shows what hovering it shows, its tooltip, and draws no ring,
// and the tooltip goes again once focus moves on
test('opens an info tooltip on keyboard focus without a ring', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedOneTransaction(page, request)
  const info = page.getByRole('button', { name: 'How net flow is calculated', exact: true })
  const tooltip = page.getByRole('tooltip').filter({ hasText: /^Money in minus money out for this period/ })
  const opacity = () => tooltip.evaluate((node) => getComputedStyle(node).opacity)
  await expect.poll(opacity).toBe('0')

  await focusFromKeyboard(page, info)
  await expect.poll(opacity).toBe('1')
  expect(await info.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')

  await page.keyboard.press('Tab')
  await expect.poll(opacity).toBe('0')
})

// A click still opens the tooltip and a second click closes it, since focus that came from the mouse
// doesn't hold it open the way keyboard focus does
test('toggles an info tooltip with the mouse', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedOneTransaction(page, request)
  const info = page.getByRole('button', { name: 'How net flow is calculated', exact: true })
  const tooltip = page.getByRole('tooltip').filter({ hasText: /^Money in minus money out for this period/ })
  const opacity = () => tooltip.evaluate((node) => getComputedStyle(node).opacity)

  await info.click()
  await page.mouse.move(0, 0)
  await expect.poll(opacity).toBe('1')

  await info.click()
  await page.mouse.move(0, 0)
  await expect(info).toBeFocused()
  await expect.poll(opacity).toBe('0')
  expect(await info.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
})

// A row opened with the mouse gets focus back when its dialog closes, and draws no ring for it
test('leaves no focus ring on a transaction row opened with the mouse', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const rowButton = await seedOneTransaction(page, request)

  await rowButton.click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toBeHidden()

  await expect(rowButton).toBeFocused()
  expect(await readFocusRing(rowButton)).toBeNull()
})

// The dashboard's range selector clips what spills past its edge and has room for the ring but not its
// gap, so its options draw the ring against their edge, whole, on top of their hover look
test('shows the whole ring and the hover look on a range selector option reached by keyboard', async ({ page, request }) => {
  test.skip(page.viewportSize()!.width < 730, 'below 730px the range is picked from a sheet instead')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedOneTransaction(page, request)
  await openPage(page, '/dashboard')
  const option = page.getByRole('tablist', { name: 'Breakdown range' }).filter({ visible: true }).first().getByRole('tab', { selected: false }).first()

  const { rest, focused } = await expectHoverLook(page, option, { offset: '0px' })
  expect(focused.button.backgroundColor).not.toBe(rest.button.backgroundColor)
})

// Every stop on the way through the transactions page, the Add transaction dialog, an account's page and
// the dashboard, whose "View all transactions" link is an outlined button drawn on a link,
// shows its focus whole: a ring that nothing clips and that reaches 3:1, or no ring and a hover look that
// differs from rest. A tooltip's trigger opens its tooltip instead, which its own test covers
test('shows every Tab stop with a whole ring or a visible hover look', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-1) })
  await logInViaApi(page, user)
  const problems = new Set<string>()
  let switchStops = 0
  const tabThrough = async (stops: number) => {
    for (let stop = 0; stop < stops; stop++) {
      await page.keyboard.press('Tab')
      // The stop is marked so it can be found again once focus has left it
      await page.evaluate(() => {
        document.querySelector('[data-tab-stop]')?.removeAttribute('data-tab-stop')
        document.activeElement?.setAttribute('data-tab-stop', '')
      })
      const focused = page.locator('[data-tab-stop]')
      if (await focused.evaluate((node) => node.getAttribute('role') === 'switch')) switchStops += 1
      const label = await focused.evaluate((node) => `${node.tagName} ${node.getAttribute('aria-label') ?? node.textContent?.trim().slice(0, 30)}`)
      // Chart marks draw their own focus and are not buttons, and a stop on the page itself is focus leaving it
      if (await focused.evaluate((node) => node.tagName === 'BODY' || node instanceof SVGElement || Boolean(node.closest('.group')?.querySelector('[role="tooltip"]')))) continue
      // Read once a dialog's fade and the control's own transitions have finished
      const withFocus = await settledLook(focused)
      const ring = await readFocusRing(focused)
      if (ring) {
        if (ring.clipped) problems.add(`${label}: ring is clipped`)
        if (ring.contrast < 3) problems.add(`${label}: ring is ${ring.contrast.toFixed(2)}:1`)
        continue
      }
      await focused.evaluate((node) => (node as HTMLElement).blur())
      const atRest = await settledLook(focused)
      if (JSON.stringify(withFocus) === JSON.stringify(atRest)) problems.add(`${label}: no ring and no hover look`)
      await focusFromKeyboard(page, focused)
    }
  }

  await openPage(page, '/transactions')
  await tabThrough(30)
  await openModal(page, ['Add transaction'], 'Add transaction')
  await tabThrough(15)
  await openPage(page, `/accounts/${account.id}`)
  await tabThrough(40)
  await openPage(page, '/dashboard')
  await tabThrough(60)
  // The Edit account window holds a toggle switch and the filled Delete circle
  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit account', exact: true })).toBeVisible()
  await tabThrough(25)
  expect(switchStops, 'the toggle switch was reached by Tab').toBeGreaterThan(0)
  expect([...problems]).toEqual([])
})

/**
 * Expects the shared focus on an element to be whole: drawn, at least 3:1 against the page, and not cut
 * by any scrolling or clipping box around it. Read until it holds, since a card fades its content in
 */
async function expectWholeRing(element: Locator) {
  await expect.poll(async () => {
    const ring = await readFocusRing(element)
    return ring && { drawn: true, clipped: ring.clipped, contrast: ring.contrast >= 3 }
  }, { message: `focus on ${element}` }).toEqual({ drawn: true, clipped: false, contrast: true })
}

// A control without a border draws the ring outside its edge, which a box around it that scrolls or
// clips cuts off: a transaction row, the charts, and an option in the filters' scrolling account list.
// Each keeps its whole ring, on every screen and in both themes
for (const colorScheme of ['light', 'dark'] as const) {
  test(`keeps the whole ring on rows, charts and filter options in the ${colorScheme} theme`, AT_EVERY_SIZE, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Chequing' })
    await createAccount(request, user, { name: 'Savings' })
    const rows = [
      await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250, date: daysFromTodayInTestTimezone(-1) }),
      await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1875, date: daysFromTodayInTestTimezone(-1) }),
    ]
    await logInViaApi(page, user)
    const charts = page.locator('svg.recharts-surface[tabindex="0"]').filter({ visible: true })
    const expectEveryChart = async () => {
      // A chart that mounts late is counted too: the count is read until two reads in a row agree
      let previous = 0
      await expect.poll(async () => {
        const count = await charts.count()
        const settled = count > 0 && count === previous
        previous = count
        return settled
      }).toBe(true)
      for (let index = 0; index < await charts.count(); index++) {
        await focusFromKeyboard(page, charts.nth(index))
        await expectWholeRing(charts.nth(index))
      }
    }

    await openPage(page, '/transactions')
    await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    // The rows are already covered on desktop by the row test above, so this adds the tablet and phone
    // sizes for the issue's two row examples
    for (const id of rows) {
      const row = page.getByTestId(`transaction-row-${id}`)
      await focusFromKeyboard(page, row)
      await expectWholeRing(row)
    }
    await expectEveryChart()

    const mobile = page.viewportSize()!.width < 750
    await page.getByRole('button', { name: mobile ? /^Filters/ : 'Transaction filters', exact: !mobile }).click()
    const panel = mobile ? page.getByRole('dialog', { name: 'Transaction filters', exact: true }) : page.locator('.app-range-glass').filter({ has: page.getByRole('button', { name: 'Transaction filters', exact: true }) })
    // The accounts list is the shared checklist and the merchants list the server-searched one, and each
    // keeps its whole ring. A selected option sits on the accent tint, which the ring must still reach 3:1 against
    for (const { facet, name } of [{ facet: 'Accounts', name: 'Chequing' }, { facet: 'Merchant', name: 'Unknown' }]) {
      if (mobile) {
        await panel.getByRole('combobox', { name: 'Filters', exact: true }).click()
        await page.getByRole('option', { name: new RegExp(`^${facet}`) }).click()
      } else await panel.getByRole('tab', { name: new RegExp(`^${facet}`) }).click()
      const option = panel.getByRole('checkbox', { name, exact: true })
      await focusFromKeyboard(page, option)
      await expectWholeRing(option)

      await option.click()
      await expect(option).toBeChecked()
      await page.mouse.move(0, 0)
      await focusFromKeyboard(page, option)
      // The tint is dropped while the row has keyboard focus, so the ring is measured on the plain surface
      await expect.poll(() => option.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
      await expectWholeRing(option)
    }

    await openPage(page, '/dashboard')
    await expectEveryChart()
    await openPage(page, `/accounts/${account.id}`)
    await expectEveryChart()
  })
}

// The date-range controls built on the glass pill, the Insights one on a wide page and a dashboard
// widget's on a phone, have a press animation that used to put their frame in the Tab order as a
// silent stop before the button. Motion stays on, since the press animation is what made the frame a stop
for (const { where, path, width, height, name } of [
  { where: 'Insights', path: '/insights', width: 1280, height: 800, name: /^Insights date range: / },
  { where: 'a dashboard widget on a phone', path: '/dashboard', width: 390, height: 844, name: /^Breakdown range: / },
]) {
  test(`reaches the date-range control on ${where} in one Tab stop with visible focus`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    await seedOneTransaction(page, request)
    await openPage(page, path)
    const head = page.getByRole('button', { name }).filter({ visible: true })
    const insideFrame = () => head.evaluate((node) => node.parentElement!.contains(document.activeElement))

    await focusFromKeyboard(page, head)
    await page.keyboard.press('Shift+Tab')
    expect(await insideFrame()).toBe(false)
    await page.keyboard.press('Tab')
    await expect(head).toBeFocused()
    // Shown as the hover look on the glass, with no ring on the head
    expect(await readFocusRing(head)).toBeNull()
    await page.keyboard.press('Enter')
    await expect(head).toHaveAttribute('aria-expanded', 'true')

    // A pointer press opens it without a ring
    await page.keyboard.press('Escape')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await openPage(page, path)
    await head.click()
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    expect(await readFocusRing(head)).toBeNull()
  })
}

// A closed date-range control keeps its options mounted at no height and fully faded, where they used
// to stay in the Tab order as a run of invisible stops after the button
for (const { where, path, width, height, name, list, loaded } of [
  { where: 'a dashboard widget on a phone', path: '/dashboard', width: 390, height: 844, name: /^Breakdown range: /, list: 'listbox', loaded: 'Spending breakdown FX status' },
  { where: 'Insights', path: '/insights', width: 1280, height: 800, name: /^Insights date range: /, list: 'tablist', loaded: 'Income and expense FX status' },
  { where: 'Insights on a phone', path: '/insights', width: 390, height: 844, name: /^Insights date range: /, list: 'tablist', loaded: 'Income and expense FX status' },
] as const) {
  test(`keeps the closed date-range control's options on ${where} out of the Tab order`, async ({ page, request }) => {
    await page.setViewportSize({ width, height })
    await seedOneTransaction(page, request)
    await openPage(page, path)
    const head = page.getByRole('button', { name }).filter({ visible: true })
    const insideFrame = () => head.evaluate((node) => node.parentElement!.contains(document.activeElement))
    // The stops after the button belong to a card that shows placeholders until its figures load, and
    // the loaded card puts new stops, such as its chart or FX badge, ahead of the one a Tab reached. So
    // wait for its FX badge, which comes with its figures
    await expect(page.getByRole('button', { name: loaded })).toBeVisible()

    await focusFromKeyboard(page, head)
    await page.keyboard.press('Tab')
    expect(await insideFrame()).toBe(false)
    await page.keyboard.press('Shift+Tab')
    await expect(head).toBeFocused()

    // Open, its options follow the button in order
    await page.keyboard.press('Enter')
    await expect(head).toHaveAttribute('aria-expanded', 'true')
    const options = head.locator('..').getByRole(list).first().getByRole(list === 'tablist' ? 'tab' : 'option')
    await page.keyboard.press('Tab')
    await expect(options.first()).toBeFocused()
    // Nothing the open panel folds away, such as a custom range builder, is a stop after them
    for (let stop = await options.count(); stop > 0; stop--) await page.keyboard.press('Tab')
    expect(await insideFrame()).toBe(false)
    await page.keyboard.press('Shift+Tab')
    await expect(options.last()).toBeFocused()

    // Closing from inside hands focus back to the button, and the options leave the Tab order again
    await page.keyboard.press('Escape')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await expect(head).toBeFocused()
    await page.keyboard.press('Tab')
    expect(await insideFrame()).toBe(false)

    // Picking a range closes it the same way
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Enter')
    await page.keyboard.press('Tab')
    await expect(options.first()).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(head).toHaveAttribute('aria-expanded', 'false')
    await expect(head).toBeFocused()
  })
}

/**
 * Expects a button's keyboard focus to look like its hover and to change what it looks like at rest, so
 * that keyboard focus can be told apart from no focus. The change may be on the button or on the frame
 * that shows its look, such as a row or the glass around a pill's head
 */
async function expectVisibleHoverLook(page: Page, element: Locator, ring: { offset: string } | null = null) {
  const { rest, focused } = await expectHoverLook(page, element, ring)
  expect(JSON.stringify([focused.button, focused.frame]), `${element} looks the same focused as at rest`).not.toBe(JSON.stringify([rest.button, rest.frame]))
}

// Every button that had no hover look, or one too faint to see, shows a visible change on keyboard focus
test('shows a visible hover look on keyboard focus on the buttons that had none', AT_EVERY_SIZE, async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-1) })
  await logInViaApi(page, user)

  await openPage(page, '/insights')
  await expectVisibleHoverLook(page, page.getByRole('button', { name: /^Insights date range: / }).filter({ visible: true }))

  await openPage(page, '/settings')
  await expectVisibleHoverLook(page, page.getByRole('checkbox', { name: /Everyday/ }).first())
  if (page.viewportSize()!.width < 1200) await expectVisibleHoverLook(page, page.locator('[aria-controls="settings-mobile-section-menu"]'))

  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  await expectVisibleHoverLook(page, dialog.getByRole('button', { name: 'Cancel', exact: true }))
  await expectVisibleHoverLook(page, dialog.getByRole('tab', { selected: true }).first(), { offset: '2px' })
  await dialog.getByRole('group', { name: 'Date', exact: true }).getByRole('button', { name: 'Open calendar', exact: true }).click()
  const calendar = page.getByRole('dialog', { name: 'Choose date', exact: true })
  await expect(calendar).toBeVisible()
  await expectVisibleHoverLook(page, calendar.locator('[data-iso]').nth(16), { offset: '2px' })
  await expectVisibleHoverLook(page, calendar.locator('[data-iso][data-selected]'), { offset: '2px' })
})

// A menu item's hover look adds a border, so keyboard focus shows exactly that look and no ring: the
// Settings menu on the left and the sidebar items. The selected item already rests in that look, so its
// border turns stronger on focus and under the pointer instead
test('shows the hover look and no ring on keyboard focus on menu items', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  await logInViaApi(page, user)

  await openPage(page, '/settings')
  await expectVisibleHoverLook(page, page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Security', exact: true }))
  await expectVisibleHoverLook(page, page.getByRole('link', { name: 'Accounts', exact: true }))

  // The selected item rests in the hover look, so keyboard focus and the pointer both strengthen its
  // border to the same colour, and nothing else changes
  const selected = page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Profile', exact: true })
  await page.mouse.move(0, 0)
  const rest = await settledLook(selected)
  await focusFromKeyboard(page, selected)
  const focused = await settledLook(selected)
  expect(await selected.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
  expect(focused.button.borderTopColor).not.toBe(rest.button.borderTopColor)
  expect({ ...focused.button, borderTopColor: '', borderRightColor: '', borderBottomColor: '', borderLeftColor: '' })
    .toEqual({ ...rest.button, borderTopColor: '', borderRightColor: '', borderBottomColor: '', borderLeftColor: '' })
  await selected.evaluate((node) => (node as HTMLElement).blur())
  await selected.hover()
  const hovered = await settledLook(selected)
  expect(hovered.button.borderTopColor).not.toBe(rest.button.borderTopColor)
  expect(hovered).toEqual(focused)
})

// A control without a border keeps the ring on top of its hover look: a filled button and the filled
// danger circle in the Edit account window. The ring is whole and at least 3:1 against the page, and the
// hover look shows with it
test('keeps the ring and the hover look on keyboard focus on controls without a border', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)

  await openPage(page, `/accounts/${account.id}`)
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
  await expect(dialog).toBeVisible()
  await expectVisibleHoverLook(page, dialog.getByRole('button', { name: 'Delete account', exact: true }), { offset: '2px' })
  await expectVisibleHoverLook(page, dialog.getByRole('button', { name: 'Cancel', exact: true }))
})

// A toggle switch has no border, so keyboard focus draws the ring around the whole switch in the shared
// focus colour, not the text colour it used to be, and the track takes the stronger fill it has under the
// pointer, off and on
for (const colorScheme of ['light', 'dark'] as const) {
  test(`shows a toggle switch's ring and hover look on keyboard focus in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday' })
    await logInViaApi(page, user)
    await openPage(page, `/accounts/${account.id}`)
    await page.getByRole('button', { name: 'Edit account', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit account', exact: true })
    const toggle = dialog.getByRole('switch')
    // The label row that toggles the switch, whose hover gives the track its hover look
    const row = dialog.locator('label').filter({ has: page.getByRole('switch') })
    await expect(toggle).toBeVisible()

    // The track's fill once its transition has finished, which is when two reads in a row agree. The track
    // is the hidden input's next sibling
    const readFill = () => toggle.evaluate(async (node) => {
      // A fill is read once the transition a state change started has begun, then finished
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await Promise.all(document.getAnimations().filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished.catch(() => undefined)))
      return getComputedStyle(node.nextElementSibling!).backgroundColor
    })
    const settledFill = async () => {
      let previous = await readFill()
      await expect.poll(async () => {
        const next = await readFill()
        const settled = next === previous
        previous = next
        return settled
      }).toBe(true)
      return previous
    }

    for (const on of [false, true]) {
      if (on) await row.click({ position: { x: 20, y: 10 } })
      await expect(toggle).toBeChecked({ checked: on })
      await page.mouse.move(0, 0)
      const rest = await settledFill()

      await focusFromKeyboard(page, toggle)
      await expectSharedRing(toggle, 'outline', '2px')
      const ringColour = await toggle.evaluate((node) => {
        const probe = document.createElement('div')
        probe.style.color = 'var(--app-focus-ring)'
        document.body.append(probe)
        const expected = getComputedStyle(probe).color
        probe.remove()
        return { expected, actual: getComputedStyle(node.parentElement!).outlineColor }
      })
      expect(ringColour.actual).toBe(ringColour.expected)
      const focused = await settledFill()
      expect(focused).not.toBe(rest)

      await toggle.evaluate((node) => (node as HTMLElement).blur())
      // The pointer on the row's text, away from the switch, gives the track the same look as focus
      await row.hover({ position: { x: 20, y: 10 } })
      expect(await settledFill()).toBe(focused)
      await page.mouse.move(0, 0)
    }
  })
}

// A table row is a bordered card on a phone, where it shows focus on that border, and a plain row
// from 750px, where it takes the ring inside its edge, since the table clips anything past it
test('shows keyboard focus on a card row border only while the row is a card', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
  await logInViaApi(page, user)
  await openPage(page, '/settings#tax-advantaged-categories')
  const row = page.locator('tr[tabindex="0"]').filter({ hasText: 'Retirement Savings' })

  await focusFromKeyboard(page, row)
  if (page.viewportSize()!.width < 750) await expectSharedRing(row, 'border')
  else await expectSharedRing(row, 'outline', '-2px')
})

/**
 * Moves focus onto `target` and off it again by keyboard, the way a Tab does, and reads the ring on
 * `frame` as it fades. Both happen in one step in the page, so the transitions are read the instant they
 * start rather than after a round trip that outlasts them. Each fade is paused halfway through and the
 * colour the browser draws then is read, with its length. Null where nothing fades, because the ring
 * switches at once
 */
async function readRingFades(page: Page, target: Locator, frame: Locator) {
  await page.keyboard.press('Shift')
  const targetHandle = await target.elementHandle()
  return frame.evaluate((box, focusable) => {
    const alpha = (colour: string) => {
      const channels = colour.match(/[\d.]+/g)!.map(Number)
      return channels.length > 3 ? channels[3] : 1
    }
    const settle = () => box.getAnimations().forEach((animation) => animation.finish())
    const midway = () => {
      const fade = box.getAnimations().find((animation): animation is CSSTransition => animation instanceof CSSTransition && animation.transitionProperty === 'outline-color')
      if (!fade) return null
      const duration = Number(fade.effect!.getComputedTiming().duration)
      fade.pause()
      fade.currentTime = duration / 2
      return { duration, alpha: alpha(getComputedStyle(box).outlineColor), offset: getComputedStyle(box).outlineOffset }
    }

    settle()
    ;(focusable as HTMLElement).focus()
    const atOnce = alpha(getComputedStyle(box).outlineColor)
    const fadeIn = midway()
    settle()
    ;(focusable as HTMLElement).blur()
    const fadeOut = midway()
    settle()
    return { atOnce, fadeIn, fadeOut }
  }, targetHandle!)
}

// Every control that draws the ring eases its outline colour, so none pops in. A control that sets its own
// transition has to list outline-color (or all) in it. Each is focused by keyboard and read where it draws
// the ring, on the pages the Tab-through test visits
async function sweepRingTransitions(page: Page, offenders: Set<string>): Promise<void> {
  const found = await page.evaluate(() => {
    const controls = document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex], [role="button"], [role="tab"], [role="radio"], [role="menuitem"], .app-focus-ring, .app-focus-inset, .app-transaction-row, .app-switch, .app-breakdown-sector, svg.recharts-surface')
    const problems: string[] = []
    let drawing = 0
    for (const control of controls) {
      if (control.getClientRects().length === 0) continue
      control.focus({ focusVisible: true } as FocusOptions)
      if (document.activeElement !== control) continue
      const target = control.closest<HTMLElement>('.app-transaction-row, .app-switch') ?? control
      control.getAnimations().forEach((animation) => animation.finish())
      const style = getComputedStyle(target)
      const draws = style.outlineStyle !== 'none' && style.outlineStyle !== 'auto' && !/, 0\)$|\/ 0\)$/.test(style.outlineColor)
      // The last entry naming the outline colour, or all, is the one that applies, and it eases it over
      // a short time: a longer one, such as a button's 300ms width change, would drag the ring out too
      const properties = style.transitionProperty.split(', ')
      const durations = style.transitionDuration.split(', ')
      const named = properties.map((property, index) => (property === 'outline-color' || property === 'all' ? index : -1)).filter((index) => index >= 0)
      const seconds = named.length > 0 ? parseFloat(durations[named[named.length - 1] % durations.length]) : 0
      const eases = seconds > 0 && seconds <= 0.25
      if (draws) drawing++
      if (draws && !eases) problems.push(`${control.tagName.toLowerCase()}.${String(control.getAttribute('class') ?? '').split(' ').slice(0, 3).join('.')} ${control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 20)}`)
      control.blur()
    }
    return { problems, drawing }
  })
  for (const problem of found.problems) offenders.add(problem)
  // A page where no control drew a ring means the sweep read nothing, so it must not pass
  expect(found.drawing).toBeGreaterThan(0)
}

test('lists the outline colour in the transition of every control that draws the ring', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: daysFromTodayInTestTimezone(-1) })
  await logInViaApi(page, user)
  const offenders = new Set<string>()
  const sweep = () => sweepRingTransitions(page, offenders)

  await openPage(page, '/transactions')
  await sweep()
  await openModal(page, ['Add transaction'], 'Add transaction')
  await sweep()
  await openPage(page, `/accounts/${account.id}`)
  await sweep()
  await page.getByRole('button', { name: 'Edit account', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Edit account', exact: true })).toBeVisible()
  await sweep()
  await openPage(page, '/dashboard')
  await sweep()
  await openPage(page, '/settings')
  await sweep()
  await openPage(page, '/imports')
  await sweep()
  await openPage(page, '/insights')
  await sweep()
  expect([...offenders]).toEqual([])
})

// The same sweep on the pages the first one doesn't reach, which hold borderless controls too: a dashboard
// with a budget, the accounts list, a transaction with a tag, the tax-advantaged settings, the import page
// at its account step and the passkey menu. Each is seeded with what its controls need
test('lists the outline colour in the transition of every control that draws the ring on the pages with data', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const tag = await request.post(`${API_BASE_URL}/tags`, { headers: asUser(user), data: { name: 'Holiday' } })
  expect(tag.status()).toBe(201)
  const { id: tagId } = await tag.json() as { id: string }
  const periodStart = budgetPeriodStart()
  await createMonthlyBudget(request, user, { name: 'Food', categoryNames: ['Groceries'], overallLimit: 50_000, periodStart })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: periodStart, tagIds: [tagId] })
  const categoryId = await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
  const limit = await request.post(`${API_BASE_URL}/tax-advantaged-categories/${categoryId}/limits`, {
    headers: asUser(user),
    data: { year: 2026, contribution_limit: 700000 },
  })
  expect(limit.status()).toBe(201)
  // The passkey menu needs a passkey, which the list answers here since a real one needs a prompt
  await page.route(`${API_BASE_URL}/auth/passkeys`, (route) => route.fulfill({
    json: [{ id: 'laptop', name: 'Laptop', created_at: new Date().toISOString(), last_used_at: null }],
  }))
  await logInViaApi(page, user)
  const offenders = new Set<string>()
  const sweep = () => sweepRingTransitions(page, offenders)

  await openPage(page, '/dashboard')
  await expect(page.getByRole('link', { name: /Food/ }).first()).toBeVisible()
  await sweep()
  await openPage(page, '/accounts')
  await sweep()
  await openPage(page, '/transactions')
  await page.getByRole('button', { name: /Groceries/ }).first().click()
  await expect(page.getByRole('button', { name: /Holiday/ }).first()).toBeVisible()
  await sweep()
  await openPage(page, '/settings#tax-advantaged-categories')
  await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
  const category = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
  await expect(category).toBeVisible()
  await sweep()
  await category.getByRole('tab').last().click()
  await sweep()
  await page.keyboard.press('Escape')
  await expect(category).toBeHidden()
  await openPage(page, '/settings#security')
  await page.locator('#security').getByRole('button', { name: 'Manage', exact: true }).click()
  await page.getByRole('dialog', { name: 'Multi-factor authentication' }).getByRole('button', { name: /More|Laptop/ }).first().click()
  await sweep()
  await openPage(page, `/settings/imports?account=${account.id}`)
  await sweep()
  expect([...offenders]).toEqual([])
})

// The pages before sign-in, the second step of sign-up and the screens that hold a user who has signed in but
// not finished: the sign-in and sign-up forms, the provider's failure and sign-up screens, the passkey and
// authenticator setup, the code prompt and the re-enrolment screen
test('lists the outline colour in the transition of every control that draws the ring before the app opens', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const offenders = new Set<string>()
  const sweep = () => sweepRingTransitions(page, offenders)

  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Forgot password?', exact: true })).toBeVisible()
  await sweep()
  await page.goto('/signup')
  await expect(page.getByLabel('Email')).toBeVisible()
  await sweep()
  await page.goto('/auth/oidc/callback?error=access_denied')
  await expect(page.getByRole('heading', { name: 'Sign-in failed' })).toBeVisible()
  await sweep()
  await page.route(`${API_BASE_URL}/auth/oidc/callback`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue()
    await route.fulfill({
      json: {
        onboarding_required: true,
        onboarding_token: `e2e-token-${crypto.randomUUID()}`,
        email: `e2e-oidc-${crypto.randomUUID()}@example.com`,
        first_name: 'Ring',
        last_name: null,
      },
    })
  })
  await page.goto(`/auth/oidc/callback?${new URLSearchParams({ code: 'e2e-code', state: 'e2e-state' })}`)
  await expect(page.getByText('Wrong account?')).toBeVisible()
  await sweep()
  await page.unroute(`${API_BASE_URL}/auth/oidc/callback`)

  const user = await signUpUser(request)
  await enrollTotp(request, user)
  await reachTwoFactorChallenge(page, user)
  await sweep()

  await page.context().clearCookies()
  await signUpThroughTheForm(page)
  const authenticatorInstead = page.getByRole('button', { name: 'Use an authenticator app instead' })
  const setupHeading = page.getByRole('heading', { name: 'Set up two-factor authentication' })
  await expect(authenticatorInstead.or(setupHeading)).toBeVisible()
  await sweep()
  if (await authenticatorInstead.isVisible()) await authenticatorInstead.click()
  await expect(page.getByRole('button', { name: 'Copy key' })).toBeVisible()
  await sweep()

  const reenroll = await signUpUser(request)
  await page.context().clearCookies()
  await page.route(`${API_BASE_URL}/auth/refresh`, async (route) => {
    const response = await route.fetch()
    const body = await response.json()
    body.user.second_factor_reenrollment_required = true
    await route.fulfill({ response, json: body })
  })
  await page.route(`${API_BASE_URL}/auth/passkeys/config`, (route) =>
    route.fulfill({ json: { rp_id: new URL(BASE_URL).hostname } }))
  await logInViaApi(page, reenroll)
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Set up a passkey' })).toBeVisible()
  await sweep()
  expect([...offenders]).toEqual([])
})

// The ring fades in on Tab and out on leaving over about the time a hover look takes, wherever a control
// without a border draws one, and its end state keeps 3:1. Each fade is read halfway through its time.
// The shared fade is 150ms ease-out, which has the ring about 0.96 drawn there. A control that overrides
// it with a 200ms curve, such as Tailwind's duration-200, has it about 0.77 drawn, so it fails both the length and the midpoint
test('fades the keyboard focus ring in and out', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const rowButton = await seedOneTransaction(page, request)

  const expectFades = async (name: string, target: Locator, frame: Locator, offset: string) => {
    const fades = await readRingFades(page, target, frame)
    expect(fades.fadeIn, `${name} fades in`).not.toBeNull()
    expect(fades.fadeOut, `${name} fades out`).not.toBeNull()
    for (const [way, fade] of [['in', fades.fadeIn!], ['out', fades.fadeOut!]] as const) {
      expect(fade.duration, `${name} fade ${way} length`).toBe(150)
      // Ease-out is quick at first: halfway the ring is nearly all drawn fading in and nearly all gone fading out
      const drawn = way === 'in' ? fade.alpha : 1 - fade.alpha
      expect(drawn, `${name} fade ${way} midway`).toBeCloseTo(0.96, 2)
      // The ring stays where it is drawn while it fades out, so an inset one doesn't jump outward
      expect(fade.offset, `${name} fade ${way} gap`).toBe(offset)
    }
    await focusFromKeyboard(page, target)
    await expectSharedRing(frame, 'outline', offset)
  }

  await expectFades('transaction row', rowButton, rowButton.locator('..'), '-2px')
  const chart = page.locator('svg.recharts-surface[tabindex="0"]').filter({ visible: true }).first()
  await expect(chart).toBeVisible()
  await expectFades('chart', chart, chart, '-2px')

  // An option in the filters' list also eases its hover colours, which must not replace the ring's curve
  await page.getByRole('button', { name: 'Transaction filters', exact: true }).click()
  await page.getByRole('tab', { name: /^Accounts/ }).click()
  const option = page.getByRole('checkbox', { name: 'Everyday', exact: true })
  await expectFades('filter option', option, option, '-2px')
})

// With reduced motion the ring is the focus colour from the start and only its style switches, so it
// appears and goes at once. Removing the reduced-motion override of the rest outline fails this
test('shows the keyboard focus ring at once with reduced motion', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const rowButton = await seedOneTransaction(page, request)
  expect(await readRingFades(page, rowButton, rowButton.locator('..'))).toEqual({ atOnce: 1, fadeIn: null, fadeOut: null })
})

// Forced colours would draw the clear outline a control holds at rest, so none is held there
test('holds no outline at rest in forced colours', async ({ page, request }) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await seedOneTransaction(page, request)
  await openPage(page, '/settings')
  const security = page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Security', exact: true })
  expect(await security.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('none')
})

// The login page's "Forgot password?" link has no border of its own, and the box it slides in and out in
// hides what spills past its edge while it moves, so it must keep its whole ring once it has settled.
// It runs at every size and in both themes for the same reason as the whole-ring test above, and with motion
// on as well as off, since the box only lets the ring show once its slide has finished
for (const colorScheme of ['light', 'dark'] as const) {
  for (const reducedMotion of ['reduce', 'no-preference'] as const) {
    const motion = reducedMotion === 'reduce' ? 'reduced' : 'full'
    test(`keeps the whole ring on the login page's forgot password link in the ${colorScheme} theme with ${motion} motion`, AT_EVERY_SIZE, async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion })
      await page.goto('/login')
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
      const link = page.getByRole('button', { name: 'Forgot password?', exact: true })
      await focusFromKeyboard(page, link)
      await expectWholeRing(link)
    })
  }
}

// Focus can reach the link while it is still sliding in, and its ring must still be whole once the slide ends
test('keeps the whole ring on the forgot password link focused while it slides in', AT_EVERY_SIZE, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign up', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Forgot password?', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Log in', exact: true }).click()
  const link = page.getByRole('button', { name: 'Forgot password?', exact: true })
  await focusFromKeyboard(page, link)
  await expectWholeRing(link)
})
