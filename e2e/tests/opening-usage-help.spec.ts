import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTaxAdvantagedCategory, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: each test sets every size it checks itself

/**
 * Guards where an info note opens. The Opening usage note opened below its label, straight over the
 * field it explains. It could not open above instead, since a dialog's scrolling body cut off a note
 * drawn past its top, so the tooltip now floats free of that body, and every other note must still
 * open on the side it did. Floating free, an open note must follow its trigger as the body scrolls and the
 * window resizes, and hide while the trigger is scrolled out of the body rather than float over the rest
 */

type Box = { x: number; y: number; width: number; height: number }

// The issue's wide and phone screens, two common laptops, where the dialog's top sits close above the
// lifetime figure, a tablet, where the edit dialog's body scrolls, and a common phone
const SIZES = [
  { width: 2200, height: 1322 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 768, height: 1024 },
  { width: 393, height: 852 },
  { width: 390, height: 844 },
]

// The table that labels its column with the note shows from this width, and rows stack as cards below it
const TABLE_MIN_WIDTH = 750

// Rounding in the layout puts edges that meet up to a pixel apart
const EDGE_TOLERANCE = 1

// How long a trial press waits for nothing to lie over its target before counting it as covered
const PRESS_TIMEOUT = 2000

/** Loads the page afresh at the size, so no dialog an earlier size left open carries over */
async function openPageAt(page: Page, size: { width: number; height: number }, url: string) {
  await page.setViewportSize(size)
  await page.goto('about:blank')
  await openPage(page, url)
}

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function contains(outer: Box, inner: Box) {
  return inner.x >= outer.x - EDGE_TOLERANCE
    && inner.y >= outer.y - EDGE_TOLERANCE
    && inner.x + inner.width <= outer.x + outer.width + EDGE_TOLERANCE
    && inner.y + inner.height <= outer.y + outer.height + EDGE_TOLERANCE
}

// The text each note opens with, which names it
const OPENING_USAGE_NOTE = /^Opening usage is the amount/

/** The box of the note's visible panel, without the clear gap around it that joins it to the trigger */
function readPanel(note: Locator): Promise<Box> {
  return note.evaluate((node) => {
    const { x, y, width, height } = node.firstElementChild!.getBoundingClientRect()
    return { x, y, width, height }
  })
}

/** Where the note's panel sits against its trigger, read together so neither moves between the two */
async function readPlacement(trigger: Locator, note: Locator) {
  const [panel, from] = [await readPanel(note), (await trigger.boundingBox())!]
  const centre = from.x + from.width / 2
  return {
    above: panel.y + panel.height <= from.y + EDGE_TOLERANCE,
    below: panel.y >= from.y + from.height - EDGE_TOLERANCE,
    across: panel.x <= centre && centre <= panel.x + panel.width,
    gap: Math.round(panel.y >= from.y ? panel.y - (from.y + from.height) : from.y - (panel.y + panel.height)),
  }
}

/**
 * Opens the note from its trigger and, once it has faded in, runs the check while it shows. Returns the
 * box of the note's visible panel and the trigger's box
 */
async function openNote(page: Page, trigger: Locator, note: Locator, whileOpen?: () => Promise<void>): Promise<{ note: Box; trigger: Box }> {
  await trigger.click()
  await expect(note).toHaveCSS('opacity', '1')
  const boxes = { note: await readPanel(note), trigger: (await trigger.boundingBox())! }
  await whileOpen?.()

  // A second press closes it, and the pointer leaves so hovering doesn't keep it showing
  await trigger.click()
  await page.mouse.move(0, 0)
  await expect(note).toHaveCSS('opacity', '0')
  return boxes
}

/** Signs up a user with a category holding a limit for each of the given years, and signs them in */
async function seedCategory(page: Page, request: APIRequestContext, years: number[]) {
  const user = await signUpUser(request)
  const categoryId = await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
  for (const year of years) {
    const limit = await request.post(`${API_BASE_URL}/tax-advantaged-categories/${categoryId}/limits`, {
      headers: asUser(user),
      data: { year, contribution_limit: 700000 },
    })
    expect(limit.status()).toBe(201)
  }
  await logInViaApi(page, user)
}

async function openCategoryDialog(page: Page) {
  await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
  return page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
}

async function expectNoteClear(page: Page, trigger: Locator, noteLocator: Locator, labelled: Locator, dialog: Locator, where: string) {
  // What it labels takes a press with the note open, so nothing of the note lies over it
  let isPressable = false
  const { note, trigger: from } = await openNote(page, trigger, noteLocator, async () => {
    isPressable = await labelled.click({ trial: true, timeout: PRESS_TIMEOUT }).then(() => true, () => false)
  })
  const [field, panel] = [(await labelled.boundingBox())!, (await dialog.boundingBox())!]
  const boxes = JSON.stringify({ note, trigger: from, field, panel })
  expect.soft(isPressable, `what the note labels takes no press while it shows ${where}`).toBe(true)
  expect.soft(overlaps(note, field), `the note covers what it labels ${where}: ${boxes}`).toBe(false)
  // Above its trigger, since what it labels sits beneath. Floating over everything, it may rise past the
  // dialog's top, but it stays within the dialog's sides
  expect.soft(note.y + note.height, `the note opens above its trigger ${where}: ${boxes}`).toBeLessThanOrEqual(from.y + EDGE_TOLERANCE)
  expect.soft(
    contains({ ...panel, y: note.y, height: note.height }, note),
    `the note runs past the dialog's sides ${where}: ${boxes}`,
  ).toBe(true)
}

test('opens the Opening usage note clear of what it labels', async ({ page, request }) => {
  await seedCategory(page, request, [2026])

  for (const size of SIZES) {
    const at = `at ${size.width}×${size.height}`
    await openPageAt(page, size, '/settings#tax-advantaged-categories')
    const category = await openCategoryDialog(page)
    const triggers = category.getByRole('button', { name: 'Opening usage info', exact: true })
    const notes = category.getByRole('tooltip', { name: OPENING_USAGE_NOTE })

    // The annual limits panel labels the lifetime figure, and from 750px wide the column of each year's figure
    await expectNoteClear(page, triggers.first(), notes.first(), category.getByText('None', { exact: true }), category, `in the limits panel ${at}`)
    if (size.width >= TABLE_MIN_WIDTH) {
      const column = category.getByRole('cell', { name: 'No opening usage', exact: true })
      await expectNoteClear(page, triggers.nth(1), notes.nth(1), column, category, `in the limits table ${at}`)
    }

    await category.getByRole('button', { name: 'Edit', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Category details', exact: true })
    const field = details.getByRole('textbox', { name: 'Opening usage', exact: true })
    await expect(field).toBeVisible()
    const trigger = details.getByRole('button', { name: 'Opening usage info', exact: true })
    await expectNoteClear(page, trigger, details.getByRole('tooltip', { name: OPENING_USAGE_NOTE }), field, details, `in the edit dialog ${at}`)
  }
})

test('opens other notes on the side they always have', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
  await logInViaApi(page, user)

  for (const size of SIZES) {
    const at = `at ${size.width}×${size.height}`
    // The runway help opens below its trigger
    await openPageAt(page, size, '/accounts')
    const runway = await openNote(
      page,
      page.getByRole('button', { name: 'How runway is calculated', exact: true }),
      page.getByRole('tooltip', { name: /^Runway estimates/ }),
    )
    expect.soft(runway.note.y, `the runway note opens below its trigger ${at}`).toBeGreaterThanOrEqual(runway.trigger.y + runway.trigger.height - EDGE_TOLERANCE)

    // The currency warning beside the edit dialog's first fields opens above its trigger
    await openPage(page, '/settings#tax-advantaged-categories')
    await (await openCategoryDialog(page)).getByRole('button', { name: 'Edit', exact: true }).click()
    const details = page.getByRole('dialog', { name: 'Category details', exact: true })
    const warning = await openNote(
      page,
      details.getByRole('button', { name: 'Tax-advantaged category currency limitation', exact: true }),
      details.getByRole('tooltip', { name: /^Tax-advantaged categories currently link/ }),
    )
    expect.soft(warning.note.y + warning.note.height, `the currency note opens above its trigger ${at}`).toBeLessThanOrEqual(warning.trigger.y + EDGE_TOLERANCE)

    // Each still spans its trigger, unless the edge of the screen pushes it aside
    for (const [name, boxes] of [['runway', runway], ['currency', warning]] as const) {
      const centre = boxes.trigger.x + boxes.trigger.width / 2
      expect.soft(boxes.note.x <= centre && centre <= boxes.note.x + boxes.note.width, `the ${name} note sits across its trigger ${at}`).toBe(true)
    }
  }
})

// Enough years of limits that the category dialog's body scrolls on a phone
const LONG_HISTORY = Array.from({ length: 17 }, (_, index) => 2010 + index)

// How far past the top of its scrolling body the figure is taken to be wholly out of view
const PAST_BODY_TOP = 40

// A wheel turn longer than the dialog's body ever scrolls, which takes it back to its top
const TO_BODY_TOP = 5000

/** Scrolls the dialog's body by a wheel turn over its lower half, clear of any note open above */
async function scrollDialog(page: Page, dialog: Locator, distance: number) {
  const box = (await dialog.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.75)
  await page.mouse.wheel(0, distance)
}

test('keeps an open note on its figure as the dialog scrolls, and hides it while the figure is scrolled away', async ({ page, request }) => {
  await seedCategory(page, request, LONG_HISTORY)
  await openPageAt(page, { width: 390, height: 667 }, '/settings#tax-advantaged-categories')
  const category = await openCategoryDialog(page)
  const trigger = category.getByRole('button', { name: 'Opening usage info', exact: true }).first()
  const note = category.getByRole('tooltip', { name: OPENING_USAGE_NOTE }).first()
  const readTop = async () => Math.round((await trigger.boundingBox())!.y)

  // The body can open scrolled a little, so it goes back to its top first
  await expect(trigger).toBeVisible()
  await scrollDialog(page, category, -TO_BODY_TOP)
  let settled = await readTop()
  await expect.poll(async () => settled === (settled = await readTop())).toBe(true)
  await trigger.click()
  await expect(note).toHaveCSS('opacity', '1')
  const opened = await readPlacement(trigger, note)
  expect(opened).toMatchObject({ above: true, across: true })

  // Half the way to the top of the body that scrolls it keeps the figure in view, and past that top takes
  // it out of view
  const start = await readTop()
  const bodyTop = await trigger.evaluate((node) => {
    let box = node.parentElement!
    while (!['auto', 'scroll'].includes(getComputedStyle(box).overflowY) || box.scrollHeight <= box.clientHeight) box = box.parentElement!
    return Math.round(box.getBoundingClientRect().top)
  })
  const inView = Math.floor((start - bodyTop) / 2)
  const outOfView = start - bodyTop + PAST_BODY_TOP
  expect(inView).toBeGreaterThan(0)

  await scrollDialog(page, category, inView)
  await expect.poll(readTop).toBe(start - inView)
  await expect.poll(() => readPlacement(trigger, note)).toEqual(opened)

  await scrollDialog(page, category, outOfView)
  await expect(note).toBeHidden()
  await scrollDialog(page, category, -outOfView)
  await expect(note).toBeVisible()
  await expect.poll(() => readPlacement(trigger, note)).toEqual(opened)
})

// A phone turned on its side, where the edit dialog's body scrolls a little and the note only just fits
// above its field
const PHONE_ON_ITS_SIDE = { width: 667, height: 375 }

test('keeps an open note on the side it opened on as its field scrolls up the dialog', async ({ page, request }) => {
  await seedCategory(page, request, [2026])
  await openPageAt(page, PHONE_ON_ITS_SIDE, '/settings#tax-advantaged-categories')
  await (await openCategoryDialog(page)).getByRole('button', { name: 'Edit', exact: true }).click()
  const details = page.getByRole('dialog', { name: 'Category details', exact: true })
  const trigger = details.getByRole('button', { name: 'Opening usage info', exact: true })
  const note = details.getByRole('tooltip', { name: OPENING_USAGE_NOTE })
  const field = details.getByRole('textbox', { name: 'Opening usage', exact: true })
  const readTop = async () => Math.round((await trigger.boundingBox())!.y)

  // The body can open scrolled a little, so it goes back to its top first
  await expect(trigger).toBeVisible()
  await scrollDialog(page, details, -TO_BODY_TOP)
  let settled = await readTop()
  await expect.poll(async () => settled === (settled = await readTop())).toBe(true)
  const start = settled
  await trigger.click()
  await expect(note).toHaveCSS('opacity', '1')
  expect(await readPlacement(trigger, note)).toMatchObject({ above: true, across: true })

  // Scrolled to the end of the body, the figure is still in view with less room above it than the note
  // needs, and the note keeps to its side of the figure, off the field it explains
  await scrollDialog(page, details, TO_BODY_TOP)
  await expect.poll(readTop).toBeLessThan(start)
  await expect(note).toBeVisible()
  await expect.poll(() => readPlacement(trigger, note)).toMatchObject({ above: true, across: true })
  expect(overlaps(await readPanel(note), (await field.boundingBox())!)).toBe(false)
})

test('keeps an open note on its figure as the window resizes', async ({ page, request }) => {
  await seedCategory(page, request, [2026])
  await openPageAt(page, { width: 1280, height: 800 }, '/settings#tax-advantaged-categories')
  const category = await openCategoryDialog(page)
  const trigger = category.getByRole('button', { name: 'Opening usage info', exact: true }).first()
  const note = category.getByRole('tooltip', { name: OPENING_USAGE_NOTE }).first()
  await trigger.click()
  await expect(note).toHaveCSS('opacity', '1')
  const opened = await readPlacement(trigger, note)
  expect(opened.across && (opened.above || opened.below)).toBe(true)

  // The dialog stays centred, so a larger window moves the figure under the open note
  const before = (await trigger.boundingBox())!
  await page.setViewportSize({ width: 1920, height: 1080 })
  await expect.poll(async () => (await trigger.boundingBox())!.x).not.toBe(before.x)
  await expect.poll(() => readPlacement(trigger, note)).toEqual(opened)
})
