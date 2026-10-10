import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser } from '../support/api'
import { API_BASE_URL } from '../support/target'
import { logInViaApi, openModal, openPage } from '../support/app'

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
 * that draws it, such as a date field around its day box. A control with no border of its own draws an
 * outline. A field draws its border in the focus colour, doubled from the inside by a shadow of the same
 * colour, so its width is the two together. The contrast is against the page, worked out from the colours
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

    // A faded frame, such as a read-only row, fades its ring with it, so the ring on screen is its
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
 * page, drawn as an outline at the given gap or as the field's own border. Read until it holds, since a
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
  // same focus: a field on its own border, anything else as a ring outside its edge
  test(`shows the same keyboard focus on each kind of control in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Everyday' })

    await logInViaApi(page, user)
    await openPage(page, '/transactions')
    await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    const toolbar = [
      { control: page.getByRole('textbox', { name: /Search transactions/ }), kind: 'border' },
      { control: page.getByRole('button', { name: 'Select transactions', exact: true }), kind: 'outline' },
    ] as const
    for (const { control, kind } of toolbar) {
      await focusFromKeyboard(page, control)
      await expectSharedRing(control, kind, kind === 'outline' ? '2px' : '0px')
    }

    const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
    const fields = [
      { control: dialog.getByLabel('Amount'), kind: 'border' },
      { control: dialog.getByRole('group', { name: 'Date', exact: true }).getByRole('textbox', { name: 'Day', exact: true }), kind: 'border' },
      { control: dialog.getByRole('combobox').first(), kind: 'border' },
      { control: dialog.getByRole('tab').first(), kind: 'outline' },
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

// A row on an archived account is drawn faded, and the fade would take its ring under 3:1, so a focused
// read-only row shows its ring at full strength
test('shows keyboard focus at full strength on a read-only row', async ({ page, request }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Old savings' })
  const id = await createTransaction(request, user, {
    accountId: account.id,
    categoryName: 'Groceries',
    amount: -1000,
    date: daysFromTodayInTestTimezone(-1),
  })
  const archived = await request.patch(`${API_BASE_URL}/accounts/${account.id}`, { headers: asUser(user), data: { is_archived: true } })
  expect(archived.status()).toBe(200)

  await logInViaApi(page, user)
  await openPage(page, `/accounts/${account.id}`)
  const rowButton = page.getByTestId(`transaction-row-${id}`)
  await expect(rowButton.getByText('Archived · Read-only', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect.poll(() => rowButton.locator('..').evaluate((row) => Number(getComputedStyle(row).opacity))).toBeLessThan(1)

  await focusFromKeyboard(page, rowButton)
  await expectSharedRing(rowButton.locator('..'), 'outline', '-2px')
})

// The actions that appear while selecting grow in from nothing, clipped as they grow, and once in
// place show their whole ring
test('shows the whole keyboard focus ring on the selection actions', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const rowButton = await seedOneTransaction(page, request)

  await page.getByRole('button', { name: 'Select transactions', exact: true }).click()
  await rowButton.locator('..').getByRole('checkbox').check()
  for (const name of ['Edit the selected transactions', 'Delete the selected transactions']) {
    const action = page.getByRole('button', { name, exact: true })
    await expect(action).toBeEnabled()
    await focusFromKeyboard(page, action)
    await expectSharedRing(action, 'outline', '2px')
  }
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
