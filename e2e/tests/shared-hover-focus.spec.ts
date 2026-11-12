import { expect, test, type Locator, type Page } from '@playwright/test'

import {
  asUser,
  budgetPeriodStart,
  createAccount,
  createMonthlyBudget,
  createTransaction,
  daysFromTodayInTestTimezone,
  signUpUser,
} from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'
import { contrastRatio, shownFill, type Rgb } from '../support/paint'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: hover, keyboard focus and the sidebar's collapse are the desktop's states, and the
// colours and easing they check don't vary with width

/**
 * Guards the hover, focus and motion rules shared across screens, which each used to leave a control
 * showing nothing under the pointer or the keyboard in one theme
 */

const NAV_EXPANDED_KEY = 'lumina:settings:navExpanded'

// The sidebar's widths, as the sidebar spec has them, which a spec cannot import
const RAIL_WIDTH = 74
const EXPANDED_WIDTH = 240

// The smallest step between a surface and the same surface under the pointer that shows
const MINIMUM_HOVER_STEP = 1.05

// The smallest contrast text needs against its fill
const MINIMUM_TEXT_CONTRAST = 4.5

/** Signs up a user, opens a page in a theme and pins the sidebar open, so its controls are on screen */
async function openAs(page: Page, request: Parameters<typeof signUpUser>[0], colorScheme: 'light' | 'dark', url: string, withAccount = false) {
  await page.emulateMedia({ colorScheme })
  const user = await signUpUser(request)
  // Add transaction stays off until an account is open, so a page that opens it needs one
  if (withAccount) await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await page.addInitScript((key) => localStorage.setItem(key, 'true'), NAV_EXPANDED_KEY)
  await openPage(page, url)
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
}

/** How far an element's colour on screen steps when the pointer comes onto it, as a contrast ratio */
async function hoverStep(page: Page, element: Locator): Promise<number> {
  await page.mouse.move(0, 0)
  const rest = await shownFill(element)
  await element.hover()
  await expect.poll(async () => contrastRatio(rest, await shownFill(element))).toBeGreaterThan(1)
  return contrastRatio(rest, await shownFill(element))
}

/** Waits for a field's frame to turn the focus colour, doubled by an inner shadow, as it does once its input is focused */
async function expectFocusBorder(search: Locator) {
  const frame = search.locator('xpath=..')
  await search.focus()
  await expect.poll(() => frame.evaluate((node) => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--app-focus-ring)'
    document.body.append(probe)
    const ring = getComputedStyle(probe).color
    probe.remove()
    const style = getComputedStyle(node)
    return style.borderTopColor === ring && style.boxShadow.startsWith(ring)
  })).toBe(true)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`draws the focus ring on the runway threshold thumbs in the ${colorScheme} theme`, async ({ page, request }) => {
    await openAs(page, request, colorScheme, '/settings#runway')
    for (const name of ['Risky threshold', 'Healthy threshold']) {
      const thumb = page.getByRole('slider', { name, exact: true })
      await thumb.scrollIntoViewIfNeeded()

      // Reached by keyboard, which is what shows the ring, then read once its fade has ended
      await page.keyboard.press('Tab')
      await thumb.focus()
      await expect.poll(() => thumb.evaluate((node) => {
        const probe = document.createElement('i')
        probe.style.color = 'var(--app-focus-ring)'
        document.body.append(probe)
        const ring = getComputedStyle(probe).color
        probe.remove()
        const style = getComputedStyle(node)
        return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor === ring}`
      }), name).toBe('solid 2px true')
      await thumb.blur()
    }
  })
}

// The app's ease-out curve, as the browser writes it
const APP_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

// Every shared button class, and the ones that change their width into a spinner and back at 300ms
const SHARED_BUTTON_CLASSES = [
  'app-primary-button',
  'app-secondary-button',
  'app-danger-button',
  'app-glass-button',
  'app-glass-button-primary',
  'app-glass-icon-button',
  'app-icon-button',
  'app-primary-button duration-300',
  'app-secondary-button duration-300',
  'app-danger-button duration-300',
]

test('eases every shared button on the app curve, and not on Tailwind\'s default', async ({ page, request }) => {
  await openAs(page, request, 'light', '/transactions')

  // A button of each shared class on the page's own stylesheet, and the real Add transaction button
  const curves = await page.evaluate((classes) => {
    const read = (node: Element) => getComputedStyle(node).transitionTimingFunction.split(/(?<=\)),\s*/)
    const found: Record<string, string[]> = {}
    for (const name of classes) {
      const button = document.createElement('button')
      button.className = name
      document.body.append(button)
      found[name] = read(button)
      button.remove()
    }
    return found
  }, SHARED_BUTTON_CLASSES)
  for (const [name, list] of Object.entries(curves)) expect(new Set(list), name).toEqual(new Set([APP_EASE]))

  const add = page.getByRole('button', { name: 'Add transaction', exact: true }).first()
  const real = await add.evaluate((node) => getComputedStyle(node).transitionTimingFunction)
  expect(new Set(real.split(/(?<=\)),\s*/))).toEqual(new Set([APP_EASE]))
})

test('moves focus to a menu item that stays on screen when the sidebar is collapsed from the keyboard', async ({ page, request }) => {
  await openAs(page, request, 'light', '/accounts')
  const navigation = page.getByRole('navigation', { name: 'Primary', exact: true })
  await page.mouse.move(page.viewportSize()!.width - 10, page.viewportSize()!.height - 10)

  await navigation.getByRole('button', { name: 'Collapse sidebar', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect.poll(() => navigation.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(RAIL_WIDTH)

  // Focus is on the first menu item, whose icon shows in the rail with the focus ring, not on the pin
  // button, which fades out of the rail
  const focused = navigation.getByRole('link').first()
  await expect(focused).toBeFocused()
  expect(await focused.evaluate((node) => node.matches(':focus-visible') && getComputedStyle(node).opacity)).toBe('1')
  await expect(navigation.getByRole('button', { name: 'Keep sidebar expanded', exact: true })).not.toBeFocused()

  // Moving on to the next menu item previews the full menu again
  await page.keyboard.press('Tab')
  await expect.poll(() => navigation.evaluate((node) => Math.round(node.getBoundingClientRect().width))).toBe(EXPANDED_WIDTH)
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`turns the checklist search field's border the focus colour in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Card A', accountKind: 'revolving', accountType: 'credit_card', startingBalance: -50_000, creditLimit: 500_000 })
    await logInViaApi(page, user)

    // The credit picker's checklist, and the transaction filters' checklist and merchant search
    await openPage(page, '/dashboard')
    await page.getByRole('button', { name: 'Choose credit accounts' }).click()
    await expectFocusBorder(page.getByRole('dialog', { name: 'Credit utilization' }).getByPlaceholder('Search accounts'))

    await openPage(page, '/transactions')
    await page.getByRole('button', { name: 'Transaction filters' }).click()
    await page.getByRole('tab', { name: 'Category' }).click()
    await expectFocusBorder(page.getByPlaceholder('Search category'))
    await page.getByRole('tab', { name: 'Merchant' }).click()
    await expectFocusBorder(page.getByPlaceholder('Search merchant'))
  })

  test(`shows a hover on a chosen checklist row in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Card A', accountKind: 'revolving', accountType: 'credit_card', startingBalance: -50_000, creditLimit: 500_000 })
    await logInViaApi(page, user)
    await openPage(page, '/dashboard')
    await page.getByRole('button', { name: 'Choose credit accounts' }).click()

    // Every card is chosen to begin with, and a chosen row rests in the soft accent tint
    const row = page.getByRole('dialog', { name: 'Credit utilization' }).getByRole('checkbox', { name: 'Card A' })
    await expect(row).toHaveAttribute('aria-checked', 'true')
    await row.blur()
    expect(await hoverStep(page, row)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })

  test(`keeps a calendar day outside the month readable under the pointer in the ${colorScheme} theme`, async ({ page, request }) => {
    await openAs(page, request, colorScheme, '/transactions', true)
    const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
    await dialog.getByRole('group', { name: 'Date', exact: true }).getByRole('button', { name: 'Open calendar', exact: true }).click()
    const calendar = page.getByRole('dialog', { name: 'Choose date', exact: true })
    await expect(calendar).toBeVisible()

    // The grid always shows days of a neighbouring month, which rest in subtle text and take the text colour under the pointer
    const outside = calendar.locator('[data-outside]:not([data-selected])').first()
    await page.mouse.move(0, 0)
    await outside.hover()
    const text = await outside.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.color = 'var(--app-text)'
      document.body.append(probe)
      const resolved = getComputedStyle(probe).color
      probe.remove()
      return resolved
    })
    await expect.poll(() => outside.evaluate((node) => getComputedStyle(node).color)).toBe(text)
    const channels = text.match(/\d+/g)!.slice(0, 3).map(Number) as Rgb
    expect(contrastRatio(channels, await shownFill(outside))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)
  })

  test(`shows a hover on the Insights category header and none on its rows in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    const account = await createAccount(request, user, { name: 'Everyday chequing', startingBalance: 100_000 })
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Salary', amount: 300_000 })
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -20_000 })
    await logInViaApi(page, user)
    await openPage(page, '/insights')

    // The header toggles the list, so it shows a hover on the card. A row inside the open list does nothing
    // when clicked, so it shows none
    const header = page.getByRole('button', { name: /^Toggle / }).first()
    await header.click()
    const row = page.locator(`#${await header.getAttribute('aria-controls')}`).getByText(/^(Salary|Groceries)$/).first()
    expect(await hoverStep(page, header)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
    await page.mouse.move(0, 0)
    const rest = await shownFill(row)
    await row.hover()
    await page.waitForTimeout(400)
    expect(await shownFill(row)).toEqual(rest)
  })

  test(`shows the menu item hover on the sidebar's log out button and collapse toggle in the ${colorScheme} theme`, async ({ page, request }) => {
    await openAs(page, request, colorScheme, '/settings')

    const sidebar = page.getByRole('navigation', { name: 'Primary', exact: true })
    const buttons = {
      'a menu item': sidebar.getByRole('link', { name: 'Insights', exact: true }),
      'the log out button': sidebar.getByRole('button', { name: 'Log out', exact: true }),
      'the collapse toggle': page.getByRole('button', { name: 'Collapse sidebar', exact: true }),
    }
    // The accent text, soft fill and border a menu item shows under the pointer, resolved by the browser
    const menuItemLook = await page.evaluate(() => {
      const probe = document.createElement('i')
      probe.style.cssText = 'color: var(--app-accent-nav-text); background-color: var(--app-accent-soft); border: 1px solid var(--app-accent-border)'
      document.body.append(probe)
      const style = getComputedStyle(probe)
      const resolved = [style.color, style.backgroundColor, style.borderTopColor]
      probe.remove()
      return resolved
    })
    for (const [name, element] of Object.entries(buttons)) {
      await page.mouse.move(0, 0)
      await element.hover()
      await expect.poll(
        () => element.evaluate((node) => {
          const style = getComputedStyle(node)
          return [style.color, style.backgroundColor, style.borderTopColor]
        }),
        { message: name },
      ).toEqual(menuItemLook)
    }
  })

  test(`shows a hover on a settings card row in the ${colorScheme} theme`, async ({ page, request }) => {
    await openAs(page, request, colorScheme, '/settings')

    const expenseGroup = page.getByRole('button', { name: /^Expense/ }).first()
    expect(await hoverStep(page, expenseGroup)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`tints a Top budgets row on the dashboard under the pointer and fades it out in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    await createMonthlyBudget(request, user, {
      name: 'Groceries',
      categoryNames: ['Groceries'],
      overallLimit: 50_000,
      periodStart: budgetPeriodStart(),
    })
    await logInViaApi(page, user)
    await openPage(page, '/dashboard')
    const row = page.getByRole('link', { name: 'Open Groceries budget', exact: true })

    // The soft accent fill every other clickable row takes, which has to show on the widget's card
    expect(await hoverStep(page, row)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)

    // Every line of text in the row stays readable on that tint, the green status and the faint end date included
    const tinted = await shownFill(row)
    const lines = await row.evaluate((node) => {
      const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
      return [...node.querySelectorAll('p, span')].map((line) => {
        context.clearRect(0, 0, 1, 1)
        context.fillStyle = getComputedStyle(line).color
        context.fillRect(0, 0, 1, 1)
        return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3) as Rgb
      })
    })
    expect(lines.length).toBeGreaterThanOrEqual(5)
    for (const line of lines) expect(contrastRatio(line, tinted)).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)

    // It eases over the app's usual duration rather than changing at once
    expect(await row.evaluate((node) => {
      const style = getComputedStyle(node)
      return style.transitionDuration.split(', ')[style.transitionProperty.split(', ').indexOf('background-color')]
    })).toBe('0.3s')

    // Off the row, the tint fades away and the row is as it was
    await page.mouse.move(0, 0)
    await expect.poll(() => row.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe('rgba(0, 0, 0, 0)')
  })
}

/** Opens Edit budget for a budget tracking Groceries, so Dining is a category it leaves out */
async function openEditBudget(page: Page, request: Parameters<typeof signUpUser>[0], colorScheme: 'light' | 'dark', archived: boolean) {
  await page.emulateMedia({ colorScheme })
  const user = await signUpUser(request)
  const id = await createMonthlyBudget(request, user, {
    name: 'Hover budget',
    categoryNames: ['Groceries'],
    overallLimit: 50_000,
    periodStart: budgetPeriodStart(),
  })
  if (archived) {
    const response = await request.patch(`${API_BASE_URL}/base-budgets/${id}`, { headers: asUser(user), data: { is_archived: true } })
    expect(response.status()).toBe(200)
  }
  await logInViaApi(page, user)
  await openPage(page, '/budgets')
  if (archived) await page.getByRole('button', { name: /Archived budgets/ }).click()
  await page.getByTestId(`budget-card-${id}`).click()
  await page.getByRole('dialog', { name: 'Hover budget', exact: true }).getByRole('button', { name: 'Edit', exact: true }).click()
  return page.getByRole('dialog', { name: 'Edit budget', exact: true })
}

/** How far a row's colour on screen steps under the pointer, which is 1 when the row does not react */
async function stepUnderPointer(page: Page, element: Locator, options: { force?: boolean } = {}): Promise<number> {
  await page.mouse.move(0, 0)
  const rest = await shownFill(element)
  await element.hover(options)
  return contrastRatio(rest, await shownFill(element))
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`tints an untracked Edit budget category row under the pointer and leaves a tracked one in the ${colorScheme} theme`, async ({ page, request }) => {
    const edit = await openEditBudget(page, request, colorScheme, false)
    const untracked = edit.getByRole('button', { name: /Dining/ })
    const tracked = edit.getByRole('button', { name: /Groceries/ })
    await expect(tracked).toHaveClass(/app-selection-option-active/)
    await expect(untracked).not.toHaveClass(/app-selection-option-active/)

    expect(await hoverStep(page, untracked)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)

    // The label stays readable on the tint it hovers over
    const label = await untracked.evaluate((node) => {
      const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
      context.fillStyle = getComputedStyle(node.lastElementChild!).color
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3) as Rgb
    })
    expect(contrastRatio(label, await shownFill(untracked))).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST)

    // A tracked row is already in its chosen look, so the pointer over it changes nothing
    expect(await stepUnderPointer(page, tracked)).toBeLessThan(1.01)
  })

  test(`leaves a disabled Edit budget category row without a hover in the ${colorScheme} theme`, async ({ page, request }) => {
    const edit = await openEditBudget(page, request, colorScheme, true)
    const row = edit.getByRole('button', { name: /Dining/ })
    await expect(row).toBeDisabled()

    expect(await stepUnderPointer(page, row, { force: true })).toBeLessThan(1.01)
    expect(await row.evaluate((node) => getComputedStyle(node).cursor)).toBe('not-allowed')
  })

  test(`tints a credit account left out of the chooser under the pointer in the ${colorScheme} theme`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme })
    const user = await signUpUser(request)
    await createAccount(request, user, { name: 'Card A', accountKind: 'revolving', accountType: 'credit_card', startingBalance: -50_000, creditLimit: 500_000 })
    await logInViaApi(page, user)
    await openPage(page, '/dashboard')
    await page.getByRole('button', { name: 'Choose credit accounts' }).click()

    const row = page.getByRole('dialog', { name: 'Credit utilization' }).getByRole('checkbox', { name: 'Card A' })
    await row.click()
    await expect(row).toHaveAttribute('aria-checked', 'false')
    await row.blur()
    expect(await hoverStep(page, row)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })
}

// The room the collapsible headers keep between their hover tint's edges and their icon and arrow
const HEADER_SIDE_ROOM = 12

/**
 * Signs up a user with archived accounts and archived budgets, one of each unless asked for more, beside one
 * of each in use, and opens a page, so its Archived section shows
 */
async function openWithArchived(
  page: Page,
  request: Parameters<typeof signUpUser>[0],
  colorScheme: 'light' | 'dark',
  url: string,
  archivedCount = 1,
) {
  await page.emulateMedia({ colorScheme })
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  const budget = { categoryNames: ['Groceries'], overallLimit: 50_000, periodStart: budgetPeriodStart() }
  await createMonthlyBudget(request, user, { name: 'Groceries budget', ...budget })
  for (let index = 1; index <= archivedCount; index += 1) {
    const old = await createAccount(request, user, { name: `Old savings ${index}` })
    const account = await request.patch(`${API_BASE_URL}/accounts/${old.id}`, { headers: asUser(user), data: { is_archived: true } })
    expect(account.status()).toBe(200)
    const oldBudget = await createMonthlyBudget(request, user, { name: `Old budget ${index}`, ...budget })
    const archived = await request.patch(`${API_BASE_URL}/base-budgets/${oldBudget}`, { headers: asUser(user), data: { is_archived: true } })
    expect(archived.status()).toBe(200)
  }
  await logInViaApi(page, user)
  await page.addInitScript((key) => localStorage.setItem(key, 'true'), NAV_EXPANDED_KEY)
  await openPage(page, url)
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
}

/** Signs up a user with a transaction three days ahead and opens Transactions, so the Upcoming section shows */
async function openWithUpcoming(page: Page, request: Parameters<typeof signUpUser>[0], colorScheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -100, date: daysFromTodayInTestTimezone(3) })
  await logInViaApi(page, user)
  await page.addInitScript((key) => localStorage.setItem(key, 'true'), NAV_EXPANDED_KEY)
  await openPage(page, '/transactions')
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
}

/** Focuses a header from the keyboard and waits for its ring to finish fading in */
async function focusFromKeyboard(header: Locator) {
  await header.page().keyboard.press('Tab')
  await header.focus()
  await expect.poll(() => header.evaluate((node) => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--app-focus-ring)'
    document.body.append(probe)
    const ring = getComputedStyle(probe).color
    probe.remove()
    return getComputedStyle(node).outlineColor === ring
  })).toBe(true)
}

/**
 * The sides of an element's focus ring that show on screen. It reads a screenshot across the middle of
 * each side, so a ring a parent clips or a strip above covers counts as missing there. Polled, since the
 * page can still be settling when the ring's colour arrives
 */
async function ringSidesShown(page: Page, element: Locator): Promise<string[]> {
  const { ring, sides } = await element.evaluate((node) => {
    const probe = document.createElement('i')
    probe.style.color = 'var(--app-focus-ring)'
    document.body.append(probe)
    const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    canvas.fillStyle = getComputedStyle(probe).color
    probe.remove()
    canvas.fillRect(0, 0, 1, 1)
    const ring = [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3)

    // Each side's run of pixels from the ring's outer edge to its inner edge, through the middle of the side
    const style = getComputedStyle(node)
    const outer = parseFloat(style.outlineOffset) + parseFloat(style.outlineWidth)
    const inner = parseFloat(style.outlineOffset)
    const box = node.getBoundingClientRect()
    const x = Math.round((box.left + box.right) / 2)
    const y = Math.round((box.top + box.bottom) / 2)
    return {
      ring,
      sides: {
        top: { x, y, from: [x, box.top - outer], to: [x, box.top - inner] },
        bottom: { x, y, from: [x, box.bottom + inner], to: [x, box.bottom + outer] },
        left: { x, y, from: [box.left - outer, y], to: [box.left - inner, y] },
        right: { x, y, from: [box.right + inner, y], to: [box.right + outer, y] },
      },
    }
  })
  const shot = (await page.screenshot({ scale: 'css' })).toString('base64')
  return page.evaluate(async ({ shot, ring, sides }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${shot}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    const near = (x: number, y: number) => {
      const pixel = context.getImageData(Math.floor(x), Math.floor(y), 1, 1).data
      return ring.every((channel, index) => Math.abs(channel - pixel[index]) <= 24)
    }
    return Object.entries(sides).filter(([, { from, to }]) => {
      for (let step = 0; step <= 4; step += 1) {
        if (near(from[0] + ((to[0] - from[0]) * step) / 4, from[1] + ((to[1] - from[1]) * step) / 4)) return true
      }
      return false
    }).map(([side]) => side)
  }, { shot, ring, sides })
}

/** Clicks a header and records its body's height every frame until well after the motion should end */
async function heightsAfterClick(header: Locator): Promise<number[]> {
  return header.evaluate((node) => new Promise<number[]>((resolve) => {
    const body = document.getElementById(node.getAttribute('aria-controls')!)!
    const heights: number[] = []
    const start = performance.now()
    ;(node as HTMLButtonElement).click()
    const tick = () => {
      heights.push(body.getBoundingClientRect().height)
      if (performance.now() - start < 800) requestAnimationFrame(tick)
      else resolve(heights)
    }
    requestAnimationFrame(tick)
  }))
}

for (const { url, name } of [
  { url: '/accounts', name: 'Archived accounts' },
  { url: '/budgets', name: 'Archived budgets' },
]) {
  test(`keeps the ${name} hover tint clear of the header's icon and arrow`, async ({ page, request }) => {
    await openWithArchived(page, request, 'light', url)
    const header = page.getByRole('button', { name: new RegExp(name) })
    expect(await hoverStep(page, header)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)

    // The tint fills the header's box, so the room is from the box's edges to the first and last icons
    const room = await header.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const icons = node.querySelectorAll('svg')
      return { start: icons[0].getBoundingClientRect().left - box.left, end: box.right - icons[icons.length - 1].getBoundingClientRect().right }
    })
    expect(room.start, 'before the icon').toBeGreaterThanOrEqual(HEADER_SIDE_ROOM)
    expect(room.end, 'after the arrow').toBeGreaterThanOrEqual(HEADER_SIDE_ROOM)
  })
}

test('keeps an archived account row faded under keyboard focus, ringed, as only a hover lifts it', async ({ page, request }) => {
  await openWithArchived(page, request, 'light', '/accounts')
  const header = page.getByRole('button', { name: /Archived accounts/ })
  await header.click()
  const row = page.locator('[data-testid^="account-row-"]').filter({ hasText: 'Old savings 1' })
  await expect(row).toBeVisible()

  await header.focus()
  await page.keyboard.press('Tab')
  await expect(row.getByRole('link')).toBeFocused()
  await expect(row).toHaveCSS('outline-style', 'solid')
  // Read once the row's own transitions have ended, since one caught before it starts would pass either way
  const settledOpacity = await row.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((animation) => animation.finished))
    return getComputedStyle(node).opacity
  })
  expect(settledOpacity).toBe('0.75')
})

test('eases the Archived accounts list open and closed, without overshooting', async ({ page, request }) => {
  await openWithArchived(page, request, 'light', '/accounts')
  const header = page.getByRole('button', { name: /Archived accounts/ })
  const body = page.locator(`[id="${await header.getAttribute('aria-controls')}"]`)

  const opening = await heightsAfterClick(header)
  const open = opening.at(-1)!
  expect(open).toBeGreaterThan(0)
  expect(opening.some((height) => height > 1 && height < open - 1), `partway heights in ${opening.join(', ')}`).toBe(true)
  expect(opening.every((height, index) => index === 0 || height >= opening[index - 1] - 0.5), `rising heights in ${opening.join(', ')}`).toBe(true)
  await expect(body).toHaveCSS('opacity', '1')

  const closing = await heightsAfterClick(header)
  expect(closing.at(-1)).toBe(0)
  expect(closing.some((height) => height > 1 && height < open - 1), `partway heights in ${closing.join(', ')}`).toBe(true)
  expect(closing.every((height, index) => index === 0 || height <= closing[index - 1] + 0.5), `falling heights in ${closing.join(', ')}`).toBe(true)
})

for (const { url, name } of [
  { url: '/accounts', name: 'Archived accounts' },
  { url: '/budgets', name: 'Archived budgets' },
]) {
  test(`eases the page up as the ${name} list closes at the page bottom`, async ({ page, request }) => {
    // Enough archived items that the open list runs below the window, so opening it scrolls the page down
    await page.setViewportSize({ width: 1280, height: 800 })
    await openWithArchived(page, request, 'light', url, 4)
    const header = page.getByRole('button', { name: new RegExp(name) })
    await header.click()
    // The list has finished opening once it is fully shown and the page holds still for two frames after scrolling
    // it into view
    const body = page.locator(`#${await header.getAttribute('aria-controls')}`)
    await expect(body).toHaveCSS('opacity', '1')
    await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
      const scrollY = window.scrollY
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(scrollY > 0 && window.scrollY === scrollY)))
    }))).toBe(true)

    // Each frame the page may only scroll up as far as its shrinking height forces it to
    const frames = await header.evaluate((node) => new Promise<number[][]>((resolve) => {
      const frames = [[window.scrollY, document.documentElement.scrollHeight - window.innerHeight]]
      const start = performance.now()
      ;(node as HTMLButtonElement).click()
      const tick = () => {
        frames.push([window.scrollY, document.documentElement.scrollHeight - window.innerHeight])
        if (performance.now() - start < 800) requestAnimationFrame(tick)
        else resolve(frames)
      }
      requestAnimationFrame(tick)
    }))
    const jumps = frames.filter(([scrollY, maxScroll], index) => index > 0 && scrollY < Math.min(frames[index - 1][0], maxScroll) - 1)
    expect(jumps, `scroll and its limit each frame: ${JSON.stringify(frames)}`).toEqual([])
  })
}

test('shows the whole focus ring around the Archived budgets header', async ({ page, request }) => {
  await openWithArchived(page, request, 'light', '/budgets')
  const header = page.getByRole('button', { name: /Archived budgets/ })
  await focusFromKeyboard(header)
  await expect.poll(() => ringSidesShown(page, header)).toEqual(['top', 'bottom', 'left', 'right'])
})

for (const colorScheme of ['light', 'dark'] as const) {
  test(`shows a hover on the Upcoming header in the ${colorScheme} theme`, async ({ page, request }) => {
    await openWithUpcoming(page, request, colorScheme)
    const header = page.getByRole('button', { name: /Upcoming/ })
    expect(await hoverStep(page, header)).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
  })

  test(`shows the whole focus ring around the Upcoming header in the ${colorScheme} theme`, async ({ page, request }) => {
    await openWithUpcoming(page, request, colorScheme)
    const header = page.getByRole('button', { name: /Upcoming/ })
    await focusFromKeyboard(header)
    await expect.poll(() => ringSidesShown(page, header)).toEqual(['top', 'bottom', 'left', 'right'])
  })
}
