import { expect, test, type Locator, type Page } from '@playwright/test'
import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { openFilters, selectFacet } from '../support/filters'

// Runs on desktop only: the pinned heading sits on the translucent desktop panel, and the phone sheet and
// the dropdown draw it on the plain input background, which the unit tests and other specs already cover

/**
 * Guards the pinned group heading in the Filters panel's checklist. It sat on a solid strip of the
 * input background, a plain white band in the light theme and a darker brown one in the dark theme, on a
 * panel that is translucent and tinted, and it has to keep hiding the rows that scroll under it
 */

const CHANNEL_TOLERANCE = 4

type Rgb = [number, number, number]

/** Reads the colour on screen at a point, through a canvas, once the page has stopped moving */
async function pixelAt(page: Page, x: number, y: number): Promise<Rgb> {
  const png = await page.screenshot({ clip: { x: Math.floor(x), y: Math.floor(y), width: 1, height: 1 }, animations: 'disabled' })
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d')!
    context.drawImage(image, 0, 0)
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data
    return [red, green, blue] as Rgb
  }, png.toString('base64'))
}

function expectSameColour(actual: Rgb, expected: Rgb, message: string) {
  actual.forEach((channel, index) => {
    expect.soft(Math.abs(channel - expected[index]), `${message}: ${actual} against ${expected}`).toBeLessThanOrEqual(CHANNEL_TOLERANCE)
  })
}

async function boxOf(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box).not.toBeNull()
  return box!
}

async function openTypeChecklist(page: Page, request: Parameters<typeof signUpUser>[0], colorScheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
  const user = await signUpUser(request)
  // The Type tab lists only the types the user has accounts of, enough here to scroll past the first heading
  for (const accountType of ['checking', 'savings', 'cash', 'investment', 'term_deposit']) {
    await createAccount(request, user, { name: `Seeded ${accountType}`, accountType })
  }
  for (const accountType of ['credit_card', 'line_of_credit', 'heloc']) {
    await createAccount(request, user, {
      name: `Seeded ${accountType}`, accountKind: 'revolving', accountType, startingBalance: -50_000, creditLimit: 500_000,
    })
  }
  await logInViaApi(page, user)
  await openPage(page, '/accounts')
  await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)

  const panel = await openFilters(page, 'Account')
  await selectFacet(page, panel, 'Type')
  const heading = panel.getByText('Assets', { exact: true })
  await expect(heading).toBeVisible()
  return { panel, heading, list: heading.locator('xpath=ancestor::ul[1]') }
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`draws the pinned group heading in the ${colorScheme} theme in the colour of the panel around it`, async ({ page, request }) => {
    const { heading, list } = await openTypeChecklist(page, request, colorScheme)
    const headingBox = await boxOf(heading)
    const listBox = await boxOf(list)

    // Beside the list the panel has only its own padding, on the same row of the page as the heading
    const y = headingBox.y + headingBox.height / 2
    const onHeading = await pixelAt(page, headingBox.x + headingBox.width * 0.6, y)
    const onPanel = await pixelAt(page, listBox.x + listBox.width + 6, y)
    expectSameColour(onHeading, onPanel, 'the heading band against the panel')
  })

  test(`keeps the pinned group heading hiding the rows scrolled under it in the ${colorScheme} theme`, async ({ page, request }) => {
    const { panel, heading, list } = await openTypeChecklist(page, request, colorScheme)

    // A chosen row rests in the accent tint, so one passing under a see-through heading shows plainly
    await panel.getByRole('checkbox', { name: 'Checking', exact: true }).click()
    await panel.getByRole('checkbox', { name: 'Savings', exact: true }).click()

    const headingBox = await boxOf(heading)
    const probe = { x: headingBox.x + headingBox.width * 0.6, y: headingBox.y + headingBox.height / 2 }
    const resting = await pixelAt(page, probe.x, probe.y)
    // Just above the heading, where a row scrolled past it would otherwise show in the list's own padding
    const above = { x: probe.x, y: headingBox.y - 3 }
    const restingAbove = await pixelAt(page, above.x, above.y)

    await list.evaluate((element) => { element.scrollTop = 34 })
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(34)
    const scrolledBox = await boxOf(heading)
    const checking = await boxOf(panel.getByRole('checkbox', { name: 'Checking', exact: true }))
    expect(scrolledBox.y, 'the heading stays pinned at the top of the list').toBeCloseTo(headingBox.y, 0)
    expect(checking.y, 'the chosen row passes under the heading').toBeLessThan(probe.y)
    expect(checking.y + checking.height, 'the chosen row reaches the probe point').toBeGreaterThan(probe.y)

    expectSameColour(await pixelAt(page, probe.x, probe.y), resting, 'the heading over a chosen row')
    expectSameColour(await pixelAt(page, above.x, above.y), restingAbove, 'above the heading beside a chosen row')
  })
}
