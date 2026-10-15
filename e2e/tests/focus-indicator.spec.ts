import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { API_BASE_URL } from '../support/target'
import { logInViaApi, openModal, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop only, apart from the focus ring on each kind of control, which runs at every
// size: the toolbar changes below 750px. The date-range control tests set their own sizes

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
 * that draws it, such as a date field around its day box. A field or outlined button draws its border in
 * the focus colour, doubled from the inside by a shadow of the same colour, so its width is the two
 * together. Anything else, filled buttons included, draws an outline. The contrast is against the page, worked out from the colours
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
    let frame: Element | null = node
    while (frame && getComputedStyle(frame).outlineStyle === 'none' && !doubling(getComputedStyle(frame))) frame = frame.parentElement
    if (!frame || frame === document.body) return null
    const style = getComputedStyle(frame)
    const border = style.outlineStyle === 'none' ? doubling(style) : null
    const colour = border ? border.colour : style.outlineColor

    const probe = document.createElement('div')
    probe.style.background = 'var(--app-bg)'
    document.body.append(probe)
    const page = getComputedStyle(probe).backgroundColor
    probe.remove()

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
    let clipped = false
    for (let box = frame.parentElement; box; box = box.parentElement) {
      if (getComputedStyle(box).overflow === 'visible') continue
      const edge = box.getBoundingClientRect()
      if (ring.left - reach < edge.left || ring.top - reach < edge.top || ring.right + reach > edge.right || ring.bottom + reach > edge.bottom) clipped = true
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

for (const colorScheme of ['light', 'dark'] as const) {
  // One control of each kind the app styles, on the toolbar and in the Add Transaction dialog, shows the
  // same focus: a field or outlined button on its own border, anything else as a ring outside its edge
  test(`shows the same keyboard focus on each kind of control in the ${colorScheme} theme`, AT_EVERY_SIZE, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Everyday' })

    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    const toolbar = [
      page.getByRole('textbox', { name: /Search transactions/ }),
      page.getByRole('button', { name: 'Select transactions', exact: true }),
      // The phone toolbar has no Filters pill, only a button that opens a sheet
      ...page.viewportSize()!.width >= 750 ? [page.getByRole('button', { name: 'Transaction filters', exact: true })] : [],
      // Below the desktop navigation width the menu opens from a glass icon button
      ...page.viewportSize()!.width < 1050 ? [page.getByRole('button', { name: 'Open navigation menu', exact: true })] : [],
    ]
    for (const control of toolbar) {
      await focusFromKeyboard(page, control)
      await expectSharedRing(control, 'border')
    }

    const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
    const fields = [
      { control: dialog.getByLabel('Amount'), kind: 'border' },
      { control: dialog.getByRole('group', { name: 'Date', exact: true }).getByRole('textbox', { name: 'Day', exact: true }), kind: 'border' },
      { control: dialog.getByRole('combobox').first(), kind: 'border' },
      { control: dialog.getByRole('tab').first(), kind: 'outline' },
      { control: dialog.getByRole('button', { name: 'Cancel', exact: true }), kind: 'border' },
      { control: dialog.getByRole('button', { name: 'Add Transaction', exact: true }), kind: 'outline' },
    ] as const
    for (const { control, kind } of fields) {
      await focusFromKeyboard(page, control)
      await expectSharedRing(control, kind, kind === 'outline' ? '2px' : '0px')
    }
  })

  // The ring goes around the row itself, inside its edges where the next row can't cover it, whether
  // the row's own button or its checkbox while selecting holds focus
  test(`shows keyboard focus around a whole transaction row in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const rowButton = await seedOneTransaction(page, request)
    const row = rowButton.locator('..')

    await focusFromKeyboard(page, rowButton)
    await expectSharedRing(row, 'outline', '-2px')

    await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
    const checkbox = row.getByRole('checkbox')
    await focusFromKeyboard(page, checkbox)
    await expect(checkbox).toBeFocused()
    await expectSharedRing(row, 'outline', '-2px')
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
  await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
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
// gap, so its options draw the ring against their edge, whole
test('shows the whole keyboard focus ring on a range selector option', async ({ page, request }) => {
  test.skip(page.viewportSize()!.width < 730, 'below 730px the range is picked from a sheet instead')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedOneTransaction(page, request)
  await openPage(page, '/dashboard')
  const option = page.getByRole('tablist', { name: 'Breakdown range' }).filter({ visible: true }).first().getByRole('tab').first()

  await focusFromKeyboard(page, option)
  await expectSharedRing(option, 'outline', '0px')
})

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
    // Shown on the glass's own border, like every bordered control
    await expectSharedRing(head, 'border')
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

// A bordered button built from utilities, such as the Settings section menu, shows focus on its own
// border alone, with no ring around it as well
test('shows keyboard focus on the border of a bordered button built from utilities', async ({ page, request }) => {
  test.skip(page.viewportSize()!.width >= 1200, 'from 1200px the sections are a sidebar list instead')
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const menu = page.locator('[aria-controls="settings-mobile-section-menu"]')

  await focusFromKeyboard(page, menu)
  await expectSharedRing(menu, 'border')
})

// A table row is a bordered card on a phone, where it shows focus on that border, and a plain row
// from 750px, where it takes the ring inside its edge, since the table clips anything past it
test('shows keyboard focus on a card row border only while the row is a card', async ({ page, request }) => {
  const user = await signUpUser(request)
  const response = await request.post(`${API_BASE_URL}/tax-advantaged-categories`, {
    headers: asUser(user),
    data: { name: 'Retirement Savings', tax_treatment: 'tax_deferred', currency: 'CAD', lifetime_contribution_limit: null },
  })
  expect(response.status()).toBe(201)
  await logInViaApi(page, user)
  await openPage(page, '/settings#tax-advantaged-categories')
  const row = page.locator('tr[tabindex="0"]').filter({ hasText: 'Retirement Savings' })

  await focusFromKeyboard(page, row)
  if (page.viewportSize()!.width < 750) await expectSharedRing(row, 'border')
  else await expectSharedRing(row, 'outline', '-2px')
})
