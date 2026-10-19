import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page } from '@playwright/test'

import { signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage, showImportSetup, typeDate } from '../support/app'

// Runs on desktop only: each test sets the width it checks itself, since the setup panel collapses
// by itself only beside the steps and by its caret alone below them

// How long the setup panel's collapse and expand take, as the page has it, which a spec cannot import
const IMPORT_SETUP_MOTION_MS = 240

// Two rows, so Skip last rows can be raised to one without emptying the file
const CSV = Buffer.from(['Date,Amount,Merchant', '2024-03-15,-12.34,Market', '2024-03-16,-5.00,Market'].join('\n'))

// The sizes the import page lays out differently at: the 1280px it goes side by side at, and the
// tablet and phone widths it stacks at
const DESKTOP = { width: 1920, height: 1080 }
const SIDE_BY_SIDE = { width: 1280, height: 800 }
const TABLET = { width: 1194, height: 834 }
const PORTRAIT_TABLET = { width: 768, height: 1024 }
const PHONE = { width: 390, height: 844 }

/**
 * Opens the CSV import for a new user at the given size
 */
async function openImport(page: Page, request: Parameters<typeof signUpUser>[0], size: { width: number; height: number }) {
  await page.setViewportSize(size)
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await expect(page.locator('input[type="file"][accept=".csv,text/csv"]')).toBeEnabled()
  return page.getByText('Data source', { exact: true })
}

/**
 * Chooses a file through the upload card, as a user does, so the pointer is on the card
 */
async function chooseFile(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Upload CSV file/ }).click()
  await (await chooser).setFiles({ name: 'march.csv', mimeType: 'text/csv', buffer: CSV })
}

/**
 * Reads an element's box once it has stopped moving, since the steps slide as the panel collapses
 */
async function settledBox(locator: Locator) {
  let previous: { x: number; y: number } | null = null
  await expect.poll(async () => {
    const box = await locator.boundingBox()
    const isSettled = box !== null && previous !== null && box.x === previous.x && box.y === previous.y
    previous = box
    return isSettled
  }).toBe(true)
  return previous!
}

// The width of the collapsed strip, the height of the bar it is below desktop, and the gap the steps
// keep from either, which is narrower than the page's usual 32px between its columns and rows
const STRIP_WIDTH = 28
const BAR_HEIGHT = 36
const COLLAPSED_GAP = 16

// The width of the open panel's header, which the strip grows to while the sections show
const OPEN_WIDTH = 340

/**
 * Waits on the page's own frames for longer than a collapse takes, so a panel that was going to
 * collapse has done so, which a wait for the panel to stay would not otherwise tell
 */
async function waitPastMotion(page: Page) {
  await page.evaluate((motionMs) => new Promise<void>((done) => {
    const start = performance.now()
    const tick = () => (performance.now() - start >= 2 * motionMs ? done() : requestAnimationFrame(tick))
    tick()
  }), IMPORT_SETUP_MOTION_MS)
}

// The least a control's hit target is, and the room the label and caret keep from each side of the strip
const MIN_HIT_TARGET = 24
const MIN_SIDE_PADDING = 4

/**
 * Expects the steps column to start one collapsed gap after the strip, beside it
 */
async function expectColumnGapAfter(page: Page, strip: Locator) {
  // Polled, since the steps are still widening into the room when the strip has its width
  await expect.poll(async () => {
    const stripBox = (await strip.boundingBox())!
    const stepsColumn = (await steps(page).boundingBox())!
    return stepsColumn.x - (stripBox.x + stripBox.width)
  }).toBe(COLLAPSED_GAP)
}

/**
 * Expects the steps to start beside the open setup panel, or below it when the page stacks them,
 * never underneath it
 */
async function expectStepsClearOfPanel(page: Page) {
  const panel = page.getByRole('complementary', { name: 'Import setup' })
  const dataSource = page.getByRole('combobox', { name: 'Data source' })
  await expect.poll(async () => {
    const panelBox = (await panel.boundingBox())!
    // The sections reach past the column when the panel lies over the steps, so their edge counts too
    const sectionsRight = (await dataSource.boundingBox())!.x + (await dataSource.boundingBox())!.width
    const stepsBox = (await steps(page).boundingBox())!
    return stepsBox.x >= Math.max(panelBox.x + panelBox.width, sectionsRight) || stepsBox.y >= panelBox.y + panelBox.height
  }).toBe(true)
}

/**
 * Expects the open setup panel to lie over the steps, which stay where the collapsed strip left them
 * rather than making room for it
 */
async function expectPanelOverUnmovedSteps(page: Page, resting: { x: number; y: number }) {
  const dataSource = page.getByRole('combobox', { name: 'Data source' })
  await expect(dataSource).toBeVisible()
  const sections = (await dataSource.boundingBox())!
  const stepsBox = await settledBox(steps(page))
  expect(stepsBox).toMatchObject(resting)
  expect(sections.x + sections.width).toBeGreaterThan(stepsBox.x)
}

const remove = (page: Page) => page.getByRole('button', { name: 'Remove march.csv', exact: true })
const steps = (page: Page) => page.getByRole('region', { name: 'Import steps' })

/**
 * Expects the header's label and caret to sit on the collapsed strip, centred on it and turned to
 * read upwards, with the caret above the label
 */
async function expectLabelAndCaretOnStrip(strip: Locator) {
  // Polled, since the label and caret are still travelling in when the strip itself has its width
  await expect.poll(async () => {
    const stripBox = (await strip.boundingBox())!
    const label = (await strip.getByText('Import setup', { exact: true }).boundingBox())!
    const caret = (await strip.locator('svg').boundingBox())!
    const stripCenter = stripBox.x + stripBox.width / 2
    // The label's line and the caret fit the strip with the same room on both sides, and the strip
    // itself is a hit target of at least 24px
    return stripBox.width >= MIN_HIT_TARGET && label.width <= stripBox.width - 2 * MIN_SIDE_PADDING
      && caret.width <= stripBox.width - 2 * MIN_SIDE_PADDING && Math.abs(label.x + label.width / 2 - stripCenter) < 0.5
      && Math.abs(caret.x + caret.width / 2 - stripCenter) < 0.5
      && label.height > label.width
      && caret.y + caret.height <= label.y
  }).toBe(true)
}

test('collapses the setup sections to a strip once a file is added, shows them while hovered and brings them back when the file goes', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  await expect(dataSource).toBeVisible()
  const collapse = page.getByRole('button', { name: 'Collapse import setup', exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await expectStepsClearOfPanel(page)
  const home = { sections: (await dataSource.boundingBox())!, header: (await collapse.boundingBox())!, steps: (await steps(page).boundingBox())! }

  await chooseFile(page)
  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })
  await expect(strip).toHaveAttribute('aria-expanded', 'false')

  // The mouse click that chose the file left focus on the upload button, which does not hold the panel
  await expect(dataSource).toBeHidden()
  await expect(remove(page)).toBeHidden()

  // The drawn strip, not just the column holding it, is the full 28px
  await expect.poll(async () => (await strip.boundingBox())!.width).toBe(STRIP_WIDTH)
  await expectColumnGapAfter(page, strip)

  // The steps took the room the sections left, and the label and caret came to rest on the strip
  expect((await steps(page).boundingBox())!.width).toBeGreaterThan(home.steps.width)
  await expectLabelAndCaretOnStrip(strip)

  // Over the strip the sections come back to the place and width they had, over the steps, which
  // stay where they are, with the label and caret back in their row above the sections
  const stepsBox = await settledBox(page.getByText('Column mapping', { exact: true }))
  await strip.hover()
  await expect(dataSource).toBeVisible()
  await expect(remove(page)).toBeVisible()
  await expect.poll(async () => {
    const [sections, header] = await Promise.all([dataSource.boundingBox(), strip.boundingBox()])
    return [sections!.x, sections!.y, header!.x, header!.y, header!.width, header!.height]
  }).toEqual([home.sections.x, home.sections.y, home.header.x, home.header.y, home.header.width, home.header.height])
  const label = (await strip.getByText('Import setup', { exact: true }).boundingBox())!
  expect(label.width).toBeGreaterThan(label.height)
  expect((await settledBox(page.getByText('Column mapping', { exact: true }))).x).toBe(stepsBox.x)

  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
  await expect(dataSource).toBeHidden()
  await expect.poll(async () => (await strip.boundingBox())!.width).toBe(STRIP_WIDTH)
  await expectLabelAndCaretOnStrip(strip)

  // Shown only because the pointer is on it, the caret still reads collapsed. Clicking it pins the
  // sections open, so they stay when the pointer leaves
  await strip.hover()
  await expect(dataSource).toBeVisible()
  await expect(strip).toHaveAttribute('aria-expanded', 'false')
  await strip.click()
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
  await expect(dataSource).toBeVisible()
  await remove(page).click()
  await expect(page.getByRole('button', { name: 'Collapse import setup', exact: true })).toBeVisible()
  await expectStepsClearOfPanel(page)
  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
  await expect(dataSource).toBeVisible()
})

/**
 * Removes the staged file and reports, for every frame of the motion that follows, whether the page
 * has reacted yet, which is when the caret reads "Collapse", and whether the steps then start past
 * the sections' right edge. The click is the first frame, before the page has reacted to it
 */
async function removeFileAndSampleFrames(page: Page) {
  type Frame = { at: number; hasReacted: boolean; isClear: boolean }
  const sampling = page.evaluate((motionMs) => new Promise<Frame[]>((resolve) => {
    const read = (at: number): Frame => {
      const sections = document.querySelector('aside[aria-label="Import setup"] [role="combobox"]')!.getBoundingClientRect()
      const stepsColumn = document.querySelector('[role="region"][aria-label="Import steps"]')!.getBoundingClientRect()
      const caret = document.querySelector('aside[aria-label="Import setup"] button[aria-expanded]')!
      return { at, hasReacted: caret.getAttribute('aria-expanded') === 'true', isClear: stepsColumn.left >= sections.right }
    }
    document.addEventListener('click', () => {
      const frames: Frame[] = []
      const started = performance.now()
      const sample = () => {
        const at = performance.now() - started
        frames.push(read(at))
        if (at < 2 * motionMs) requestAnimationFrame(sample)
        else resolve(frames)
      }
      sample()
    }, { capture: true, once: true })
  }), IMPORT_SETUP_MOTION_MS)
  await remove(page).click()
  return sampling
}

/**
 * Runs an action and reports, for every frame until it has finished, how far the panel's sheet, the
 * opaque page-coloured box that parts the sections from the steps, reaches past the sections' right
 * edge, and whether it has a fill at all
 */
async function sampleSheetRoom(page: Page, act: () => Promise<void>) {
  type Frame = { room: number; comboRight: number; isFilled: boolean }
  const sampling = page.evaluate(() => new Promise<Frame[]>((resolve) => {
    const frames: Frame[] = []
    let isStopped = false
    const read = (): Frame => {
      const aside = document.querySelector('aside[aria-label="Import setup"]')!
      const sheet = document.getElementById(aside.querySelector('button[aria-expanded]')!.getAttribute('aria-controls')!)!
      const comboRight = aside.querySelector('[role="combobox"]')!.getBoundingClientRect().right
      return {
        room: sheet.getBoundingClientRect().right - comboRight,
        comboRight,
        isFilled: getComputedStyle(sheet).backgroundColor !== 'rgba(0, 0, 0, 0)',
      }
    }
    const sample = () => {
      frames.push(read())
      if (isStopped) resolve(frames)
      else requestAnimationFrame(sample)
    }
    const sampler = window as unknown as { stopSampling: () => void }
    sampler.stopSampling = () => { isStopped = true }
    sample()
  }))
  await act()
  await page.evaluate(() => (window as unknown as { stopSampling: () => void }).stopSampling())
  return sampling
}

test('keeps the setup sheet opaque and one collapsed gap past the sections at every frame of collapsing, hovering open and leaving', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })

  // What the sections show keeps the room the strip leaves the steps from the sheet's edge, so no
  // shape other than the panel itself shows as it moves and the content never touches its edge. The
  // Data Source dropdown ends a pixel inside the cards below it, which have the room exactly
  const dropdownInset = 1
  const expectRoomThroughout = (frames: Awaited<ReturnType<typeof sampleSheetRoom>>) => {
    expect(new Set(frames.map((frame) => Math.round(frame.comboRight))).size).toBeGreaterThan(2)
    expect(frames.filter((frame) => !frame.isFilled || Math.abs(frame.room - (COLLAPSED_GAP + dropdownInset)) > 0.5)).toEqual([])
  }

  expectRoomThroughout(await sampleSheetRoom(page, async () => {
    await chooseFile(page)
    await expect(dataSource).toBeHidden()
  }))
  expectRoomThroughout(await sampleSheetRoom(page, async () => {
    await strip.hover()
    await expect(dataSource).toBeVisible()
    await settledBox(dataSource)
  }))
  expectRoomThroughout(await sampleSheetRoom(page, async () => {
    await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
    await expect(dataSource).toBeHidden()
  }))
})

// The two ways a collapsed panel is held over the steps on desktop that a file's removal can happen in
for (const hold of ['hovered', 'held by a field error'] as const) {
  test(`puts the setup sections in their place at once when the last file is removed while they are ${hold} over the steps`, async ({ page, request }) => {
    const dataSource = await openImport(page, request, DESKTOP)
    await chooseFile(page)
    await showImportSetup(page)
    if (hold === 'held by a field error') {
      await typeDate(page, 'Start date', '2024-03-20')
      await typeDate(page, 'End date', '2024-03-10')
      await expect(page.getByText('Must be on or before the end date', { exact: true })).toBeVisible()
    }
    await expect(dataSource).toBeVisible()

    const frames = await removeFileAndSampleFrames(page)

    // The sections lay over the steps when the file went. The first frame after the page reacts has
    // them in their place with the steps beside them, not still over them while the panel's width
    // slides out, so they are clear well inside the one motion
    expect(frames[0]).toMatchObject({ hasReacted: false, isClear: false })
    const reacted = frames.find((frame) => frame.hasReacted)
    expect(reacted?.isClear).toBe(true)
    expect(reacted!.at).toBeLessThan(IMPORT_SETUP_MOTION_MS)
    await expectStepsClearOfPanel(page)
  })
}

test('keeps the setup sections showing for focus inside them until focus leaves', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  const uploadCard = page.getByRole('button', { name: /^Upload CSV file/ })
  await uploadCard.focus()
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Enter')
  await (await chooser).setFiles({ name: 'march.csv', mimeType: 'text/csv', buffer: CSV })

  await expect(remove(page)).toBeFocused()
  await expect(dataSource).toBeVisible()

  await page.getByRole('button', { name: 'Close import workflow', exact: true }).focus()
  await expect(dataSource).toBeHidden()

  // The strip is a button, so the keyboard reaches the sections again through it
  await page.getByRole('button', { name: 'Expand import setup', exact: true }).focus()
  await expect(dataSource).toBeVisible()
})

test('keeps the setup sections showing while a field in them has focus, and closes them once focus leaves', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  await chooseFile(page)
  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })
  await expect(dataSource).toBeHidden()
  const resting = await settledBox(steps(page))

  await showImportSetup(page)
  await expect(dataSource).toBeVisible()
  const skipLastRows = page.getByLabel('Skip last rows', { exact: true })
  await skipLastRows.fill('1')
  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
  await expect(strip).toHaveAttribute('aria-expanded', 'false')
  await expect(dataSource).toBeVisible()

  // Held open by focus it lies over the steps as it does for the pointer, which stay where they were
  await expectPanelOverUnmovedSteps(page, resting)

  await page.getByRole('heading', { name: 'Import transactions' }).click()
  await expect(dataSource).toBeHidden()

  // What was typed is still there when the sections come back
  await showImportSetup(page)
  await expect(skipLastRows).toHaveValue('1')
})

test('keeps the setup sections open, with the calendar beside its field, while a date calendar is open wherever the pointer goes, and collapses them once it closes', async ({ page, request }) => {
  const dataSource = await openImport(page, request, SIDE_BY_SIDE)
  await chooseFile(page)
  await showImportSetup(page)
  await expect(dataSource).toBeVisible()
  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })
  await expect.poll(async () => (await strip.boundingBox())!.width).toBe(OPEN_WIDTH)
  const start = page.getByRole('group', { name: 'Start date', exact: true })
  const startButton = start.getByRole('button', { name: 'Open calendar', exact: true })
  await startButton.click()
  const calendar = page.getByRole('dialog', { name: 'Choose date', exact: true })
  await expect(calendar).toBeVisible()
  const attached = async () => {
    const field = (await start.boundingBox())!
    const box = (await calendar.boundingBox())!
    // It opens under its field, or over it when the window has no room below, and never covers it
    return { left: Math.abs(box.x - field.x) <= 1, isClear: box.y >= field.y + field.height || box.y + box.height <= field.y }
  }
  await expect.poll(attached).toEqual({ left: true, isClear: true })

  // The pointer goes onto the steps, well clear of the panel and the calendar, and the motion of a collapse would be over
  await page.mouse.move(SIDE_BY_SIDE.width - 100, SIDE_BY_SIDE.height / 2)
  await waitPastMotion(page)
  await expect(dataSource).toBeVisible()
  expect((await strip.boundingBox())!.width).toBe(OPEN_WIDTH)
  await expect(calendar).toBeVisible()
  expect(await attached()).toEqual({ left: true, isClear: true })

  // A picked day fills the field and closes the calendar. Focus returns to the field, which holds the sections as any focused field does
  await page.mouse.move(SIDE_BY_SIDE.width / 2, SIDE_BY_SIDE.height / 2)
  await calendar.getByRole('button', { name: '15', exact: true }).click()
  await expect(calendar).toBeHidden()
  await expect(start.getByRole('textbox', { name: 'Day', exact: true })).toHaveValue('15')
  await expect(dataSource).toBeVisible()

  // With the pointer and focus off them they go back to the strip
  await page.getByRole('heading', { name: 'Import Transactions' }).click()
  await expect(dataSource).toBeHidden()
  await expect.poll(async () => (await strip.boundingBox())!.width).toBe(STRIP_WIDTH)
})

test('keeps the setup sections open while a date calendar is open, and closes the calendar by Escape with focus back on its field', async ({ page, request }) => {
  const dataSource = await openImport(page, request, SIDE_BY_SIDE)
  await chooseFile(page)
  await showImportSetup(page)
  const start = page.getByRole('group', { name: 'Start date', exact: true })
  await start.getByRole('button', { name: 'Open calendar', exact: true }).click()
  const calendar = page.getByRole('dialog', { name: 'Choose date', exact: true })
  await expect(calendar).toBeVisible()
  await page.mouse.move(SIDE_BY_SIDE.width - 100, SIDE_BY_SIDE.height / 2)
  await waitPastMotion(page)
  await expect(dataSource).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(calendar).toBeHidden()
  await expect(start.getByRole('textbox').first()).toBeFocused()
  await page.getByRole('heading', { name: 'Import Transactions' }).click()
  await expect(dataSource).toBeHidden()
})

test('keeps the setup sections open when a date calendar opens in a panel the caret pinned', async ({ page, request }) => {
  const dataSource = await openImport(page, request, SIDE_BY_SIDE)
  await chooseFile(page)
  await showImportSetup(page)
  await page.getByRole('button', { name: 'Expand import setup', exact: true }).click()
  await page.getByRole('group', { name: 'Start date', exact: true }).getByRole('button', { name: 'Open calendar', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Choose date', exact: true })).toBeVisible()
  await expect(dataSource).toBeVisible()
})

test('keeps the setup sections open, with the reason and no strip, while a file is refused', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  const odd = { name: 'april.csv', mimeType: 'text/csv', buffer: Buffer.from(['Date,Amount,Merchant,Balance', '2024-04-15,-1.00,Market,5.00'].join('\n')) }
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles([{ name: 'march.csv', mimeType: 'text/csv', buffer: CSV }, odd])

  await expect(page.getByText('"april.csv" was not added. Its columns don\'t match the first file.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Collapse import setup', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand import setup', exact: true })).toHaveCount(0)
  await expect(dataSource).toBeVisible()
})

test('keeps the setup sections showing while a field in them has an error, however the pointer and focus move', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  await chooseFile(page)
  await expect(dataSource).toBeHidden()
  const resting = await settledBox(steps(page))
  await showImportSetup(page)
  await typeDate(page, 'Start date', '2024-03-20')
  await typeDate(page, 'End date', '2024-03-10')
  const message = page.getByText('Must be on or before the end date', { exact: true })
  await expect(message).toBeVisible()

  await page.getByRole('heading', { name: 'Import transactions' }).click()
  await expect(message).toBeVisible()
  await expect(dataSource).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand import setup', exact: true })).toHaveAttribute('aria-expanded', 'false')
  await expectPanelOverUnmovedSteps(page, resting)

  await showImportSetup(page)
  await typeDate(page, 'Start date', '2024-03-01')
  await typeDate(page, 'End date', '2024-03-31')
  await page.getByRole('heading', { name: 'Import transactions' }).click()
  await expect(message).toBeHidden()
  await expect(dataSource).toBeHidden()
})

test('keeps an open dropdown, and the setup sections with it, open when the pointer leaves them', async ({ page, request }) => {
  const dataSource = await openImport(page, request, DESKTOP)
  await chooseFile(page)
  await page.getByRole('button', { name: 'Expand import setup', exact: true }).hover()
  const dropdown = page.getByRole('combobox', { name: 'Data source' })
  await dropdown.click()
  const options = page.getByRole('option', { name: /^Firefly III/ })
  await expect(options).toBeVisible()

  await page.mouse.move(DESKTOP.width / 2, DESKTOP.height / 2)
  await expect(options).toBeVisible()
  await expect(dataSource).toBeVisible()

  // Once it closes nothing holds the panel, so it goes too
  await page.keyboard.press('Escape')
  await expect(dropdown).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('heading', { name: 'Import transactions' }).click()
  await expect(dataSource).toBeHidden()
})

test('scrolls the field with an error into view when it holds the setup sections open in a short window', async ({ page, request }) => {
  const dataSource = await openImport(page, request, { width: 1920, height: 640 })
  await chooseFile(page)
  await showImportSetup(page)
  await typeDate(page, 'Start date', '2024-03-20')
  await typeDate(page, 'End date', '2024-03-10')
  const message = page.getByText('Must be on or before the end date', { exact: true })
  await expect(message).toBeVisible()
  await page.getByRole('heading', { name: 'Import transactions' }).click()
  await expect(dataSource).toBeVisible()

  // Inside the panel's own box, not just inside the window
  const panel = page.getByRole('complementary', { name: 'Import setup' })
  await expect.poll(async () => {
    const panelBox = (await panel.boundingBox())!
    const messageBox = (await message.boundingBox())!
    return messageBox.y >= panelBox.y && messageBox.y + messageBox.height <= panelBox.y + panelBox.height
  }).toBe(true)
})

// Firefly takes three files, so the panel stays until the last has landed rather than hiding the
// cards for the files still to come
test('keeps the Firefly upload cards in view until all three files are staged', async ({ page, request }) => {
  await openImport(page, request, DESKTOP)
  await chooseFromDropdown(page.locator('body'), 'Data source', /^Firefly III/)
  const files = ['transactions.csv', 'budgets.csv', 'accounts.csv']
    .map((name) => fileURLToPath(new URL(`../fixtures/firefly-export/${name}`, import.meta.url)))
  const uploads = page.locator('input[type="file"][accept=".csv,text/csv"]')

  await uploads.nth(0).setInputFiles(files[0])
  await expect(page.getByText('transactions.csv', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Upload budgets CSV/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Upload accounts CSV/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Expand import setup', exact: true })).toHaveCount(0)

  await expect(uploads.nth(1)).toBeEnabled()
  await uploads.nth(1).setInputFiles(files[1])
  await expect(uploads.nth(2)).toBeEnabled()
  await uploads.nth(2).setInputFiles(files[2])
  await expect(page.getByRole('button', { name: 'Expand import setup', exact: true })).toBeVisible()
})

const hasSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)

// The widths below the 1280px the page goes side by side at, where it stacks the steps under the setup: a
// phone, a tablet upright, and a tablet on its side at the widest, just under it
for (const [name, size] of [['phone', PHONE], ['tablet', PORTRAIT_TABLET], ['wide tablet', TABLET]] as const) {
  test(`collapses the setup sections upwards into a bar on a ${name}, by the caret alone, whatever the file or the pointer does`, async ({ page, request }) => {
    const dataSource = await openImport(page, request, size)
    await expectStepsClearOfPanel(page)
    await chooseFile(page)
    await expect(remove(page)).toBeVisible()
    await expect(dataSource).toBeVisible()

    const caret = page.getByRole('button', { name: 'Collapse import setup', exact: true })

    // The header bar runs from the column's left edge to its right, in line with the cards below
    const column = (await page.getByRole('complementary', { name: 'Import setup' }).boundingBox())!
    const bar = (await caret.boundingBox())!
    expect(bar.x).toBe(column.x)
    expect(bar.width).toBe(column.width)
    const openSteps = await settledBox(steps(page))
    // Hidden ones included, since collapsed the sections are out of the accessibility tree but still there
    const dropdown = page.getByRole('combobox', { name: 'Data source', includeHidden: true })
    const dropdownWidth = (await dropdown.boundingBox())!.width
    const skipLastRows = page.getByLabel('Skip last rows', { exact: true })
    await skipLastRows.fill('1')
    await caret.click()
    const expand = page.getByRole('button', { name: 'Expand import setup', exact: true })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    await expect(dataSource).toBeHidden()
    await expect(remove(page)).toBeHidden()

    // Collapsed it is a thin bar across the whole width above the steps, which moved up into the room
    // the sections left and sit directly under it, rather than beside a strip. Polled, since the
    // steps are still rising when the caret has flipped
    await expect.poll(async () => (await steps(page).boundingBox())!.y - ((await expand.boundingBox())!.y + BAR_HEIGHT)).toBe(COLLAPSED_GAP)
    const barBox = (await expand.boundingBox())!
    const stepsBox = (await steps(page).boundingBox())!
    expect(barBox).toMatchObject({ x: column.x, width: column.width, height: BAR_HEIGHT })
    expect(stepsBox.x).toBe(barBox.x)
    expect(stepsBox.width).toBe(barBox.width)
    expect(stepsBox.y).toBeLessThan(openSteps.y)

    // The sections kept their width as they closed up, and the label reads across beside the caret
    expect((await dropdown.boundingBox())!.width).toBeCloseTo(dropdownWidth, 0)
    const label = (await expand.getByText('Import setup', { exact: true }).boundingBox())!
    const caretIcon = (await expand.locator('svg').boundingBox())!
    expect(label.width).toBeGreaterThan(label.height)
    expect(label.x + label.width).toBeLessThanOrEqual(caretIcon.x)
    expect(Math.abs(label.y + label.height / 2 - (barBox.y + barBox.height / 2))).toBeLessThan(1)
    expect(await hasSidewaysScroll(page)).toBe(false)

    // Hovering over what is collapsed shows nothing. Two frames is the fence: an opening panel is
    // visible from its first frame, so one that were going to open has done so by then
    await expand.hover()
    await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
    await expect(dataSource).toBeHidden()

    await expand.click()
    await expect(dataSource).toBeVisible()
    await expect(remove(page)).toBeVisible()
    await expectStepsClearOfPanel(page)
    expect(await hasSidewaysScroll(page)).toBe(false)

    // What was typed before collapsing is still there
    await expect(skipLastRows).toHaveValue('1')
  })
}

// Without motion the bar is there the moment the caret is clicked, with the steps already under it and
// nothing left to settle, at a place no animation could have reached yet
test('swaps the setup sections and the bar at once when motion is reduced', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const dataSource = await openImport(page, request, PORTRAIT_TABLET)
  await chooseFile(page)
  await expect(remove(page)).toBeVisible()
  await page.getByRole('button', { name: 'Collapse import setup', exact: true }).click()

  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })
  // Waits for the collapse to have happened, then reads the bar once, with no polling: an
  // animation would not have brought the steps up to it by then
  await expect(strip).toHaveAttribute('aria-expanded', 'false')
  await expect(dataSource).toBeHidden()
  const barBox = (await strip.boundingBox())!
  expect(barBox.height).toBe(BAR_HEIGHT)
  const stepsColumn = (await steps(page).boundingBox())!
  expect(stepsColumn.y - (barBox.y + barBox.height)).toBe(COLLAPSED_GAP)

  await strip.click()
  const collapse = page.getByRole('button', { name: 'Collapse import setup', exact: true })
  await expect(collapse).toHaveAttribute('aria-expanded', 'true')
  expect((await collapse.boundingBox())!.height).toBe(36)
  await expect(dataSource).toBeVisible()
})
