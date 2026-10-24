import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage, showImportSetup } from '../support/app'
import { contrastRatio, shownFill, type Rgb } from '../support/paint'

// Runs on desktop only: hover and press are pointer states, and the fills they change don't vary with width

const STATEMENT = { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from('Date,Memo,Amount\n2026-03-01,Lunch,-12.00\n') }

// The smallest step between a control at rest and under the pointer that shows
const MINIMUM_HOVER_STEP = 1.05

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
  test(`shades the CSV upload card and the remove button visibly under the pointer in the ${colorScheme} theme`, async ({ page, request }) => {
    await openImports(page, request, colorScheme)
    const card = page.getByRole('button', { name: /^Upload CSV file/ })
    await expect(card).toBeVisible()

    await page.mouse.move(0, 0)
    const rest = await declaredFill(card)
    const restShown = await shownFill(card)
    await card.hover()
    await expect.poll(() => declaredFill(card)).not.toBe(rest)
    const hovered = await declaredFill(card)
    expect(contrastRatio(restShown, await shownFill(card))).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)

    // The same card is there to add more files once one is staged, and the remove button on a staged file
    // shades under the pointer too, in its own hover colour, which suits the page it sits on
    await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles(STATEMENT)
    // The file collapses the setup panel holding both, which stays out while the pointer is on its strip,
    // off them
    await showImportSetup(page)
    const addMore = page.getByRole('button', { name: /^Add more CSV file/ })
    const remove = page.getByRole('button', { name: /^Remove / })
    await expect(remove).toBeVisible()
    await expect.poll(() => declaredFill(addMore)).toBe(rest)

    await addMore.hover()
    await expect.poll(() => declaredFill(addMore)).toBe(hovered)
    // The page puts focus on the staged file's remove button, which shows the hover look until it is let go
    await remove.blur()
    const removeRest = await shownFill(remove)
    await remove.hover()
    await expect.poll(async () => contrastRatio(removeRest, await shownFill(remove))).toBeGreaterThanOrEqual(MINIMUM_HOVER_STEP)
    await addMore.hover()

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
