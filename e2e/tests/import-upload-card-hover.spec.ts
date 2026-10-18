import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage, showImportSetup } from '../support/app'

// Runs on desktop only: hover and press are pointer states, and the fills they change don't vary with width

type Rgb = [number, number, number]

const STATEMENT = { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Memo,Amount\n2026-03-01,Lunch,-12.00\n') }

/**
 * The colour on screen at an element's box once its transitions have ended: every background from the
 * page down to the element, laid over one another, so a translucent fill counts as the colour it makes
 */
async function shownFill(element: Locator): Promise<Rgb> {
  return element.evaluate(async (node) => {
    const ending = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)))

    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const read = (colour: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = colour
      context.fillRect(0, 0, 1, 1)
      const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
      return [red, green, blue, alpha / 255]
    }

    const layers: Element[] = []
    for (let layer: Element | null = node; layer; layer = layer.parentElement) layers.push(layer)
    let shown = [255, 255, 255]
    for (const layer of layers.reverse()) {
      const [red, green, blue, alpha] = read(getComputedStyle(layer).backgroundColor)
      shown = [red, green, blue].map((channel, index) => channel * alpha + shown[index] * (1 - alpha))
    }
    return shown as Rgb
  })
}

/** The background colour an element declares once its transitions have ended, so a colour partway between two is never read */
function declaredFill(element: Locator): Promise<string> {
  return element.evaluate(async (node) => {
    const ending = node.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)))
    return getComputedStyle(node).backgroundColor
  })
}

/** The properties an element's computed transition list eases, each with its duration in seconds */
function easedProperties(element: Locator): Promise<Record<string, number>> {
  return element.evaluate((node) => {
    const style = getComputedStyle(node)
    const durations = style.transitionDuration.split(',').map((value) => parseFloat(value))
    const eased: Record<string, number> = {}
    style.transitionProperty.split(',').forEach((property, index) => {
      if (property.trim() !== 'none') eased[property.trim()] = durations[index % durations.length]
    })
    return eased
  })
}

/** Opens the Imports page in a theme, into one of the new user's accounts for a CSV import or on the data source choice without one */
async function openImports(page: Page, request: APIRequestContext, colorScheme: 'light' | 'dark', hasAccount = true) {
  await page.emulateMedia({ colorScheme })
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, hasAccount ? `/settings/imports?account=${account.id}` : '/settings/imports')
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
}

/** Moves the pointer onto an element and returns what it shows there, once the change has settled */
async function hoveredFill(element: Locator): Promise<Rgb> {
  await element.hover()
  return shownFill(element)
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`turns the CSV upload card the remove button's hover colour under the pointer in the ${colorScheme} theme`, async ({ page, request }) => {
    await openImports(page, request, colorScheme)
    const card = page.getByRole('button', { name: /^Upload CSV file/ })
    await expect(card).toBeVisible()

    await page.mouse.move(0, 0)
    const rest = await declaredFill(card)
    await card.hover()
    await expect.poll(() => declaredFill(card)).not.toBe(rest)
    const hovered = await declaredFill(card)

    // The same card is there to add more files once one is staged, and the remove button on a staged file
    // takes the colour the card does
    await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles(STATEMENT)
    // The file collapses the setup panel holding both, which stays out while the pointer is on its strip,
    // off them
    await showImportSetup(page)
    const addMore = page.getByRole('button', { name: /^Add more CSV file/ })
    const remove = page.getByRole('button', { name: /^Remove / })
    await expect(remove).toBeVisible()
    await expect.poll(() => declaredFill(addMore)).toBe(rest)

    await remove.hover()
    await expect.poll(() => declaredFill(remove)).toBe(hovered)
    await addMore.hover()
    await expect.poll(() => declaredFill(addMore)).toBe(hovered)

    // Both ease their fill, rather than switching at once
    expect((await easedProperties(addMore))['background-color']).toBeGreaterThan(0)
    expect((await easedProperties(remove))['background-color']).toBeGreaterThan(0)

    // Pressed, it sits down a pixel as the buttons beside it do. The button goes up away from the card,
    // so no click opens the file chooser
    await page.mouse.down()
    await expect.poll(() => addMore.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42)).toBe(1)
    await page.mouse.move(0, 0)
    await page.mouse.up()
  })

  test(`turns the OFX upload card to the hover colour under the pointer in the ${colorScheme} theme`, async ({ page, request }) => {
    await openImports(page, request, colorScheme, false)
    await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
    const card = page.getByRole('button', { name: /^Upload statements/ })
    await expect(card).toBeVisible()

    await page.mouse.move(0, 0)
    const rest = await declaredFill(card)
    await card.hover()
    await expect.poll(() => declaredFill(card)).not.toBe(rest)
    expect((await easedProperties(card))['background-color']).toBeGreaterThan(0)
  })
}

test('lets the upload card and the remove button change at once when motion is reduced', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openImports(page, request, 'light')
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles(STATEMENT)
  await showImportSetup(page)
  await expect(page.getByRole('button', { name: /^Remove / })).toBeVisible()
  for (const control of [page.getByRole('button', { name: /^Add more CSV file/ }), page.getByRole('button', { name: /^Remove / })]) {
    expect(await easedProperties(control)).toEqual({})
  }
})

test('leaves the upload card unshaded under the pointer while it reads a file', async ({ page, request }) => {
  // The card refuses presses while a file is read, and a read lasts at least as long as the loading animation,
  // which the paused clock never lets end. The fake clock holds the browser's own fades, so motion is reduced
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await openImports(page, request, 'light')
  await expect(page.getByRole('button', { name: /^Upload CSV file/ })).toHaveAttribute('aria-disabled', 'false')
  await page.clock.install()
  await page.clock.pauseAt(new Date(Date.now() + 60_000))
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles(STATEMENT)
  // Found by what it is doing, since the card's name changes to say it is reading
  const card = page.locator('button[aria-busy="true"]')
  await expect(card).toHaveAttribute('aria-disabled', 'true')

  await page.mouse.move(0, 0)
  const rest = await shownFill(card)
  expect(await hoveredFill(card)).toEqual(rest)
  expect(await card.evaluate((node) => getComputedStyle(node).cursor)).toBe('wait')

  // Pressed, it stays where it is. The button goes up away from the card, so nothing is clicked
  await page.mouse.down()
  expect(await card.evaluate((node) => new DOMMatrix(getComputedStyle(node).transform).m42)).toBe(0)
  await page.mouse.move(0, 0)
  await page.mouse.up()
})
