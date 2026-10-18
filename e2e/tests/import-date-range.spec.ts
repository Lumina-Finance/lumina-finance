import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, createTransaction, signUpUser } from '../support/api'
import { commitImport, logInViaApi, openPage, showImportSetup, typeDate } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, except the section test, which runs at every size because the File section
// sits in a narrow sidebar on a wide screen and stacks above the steps on a phone

// One row in the middle of each month of 2025, plus the first and last day of March, so each end of
// a March range has a row on it, and a row with a date that doesn't exist, which keeps the import's
// record on screen once it is done. Travel is filed only in July
const MONTH_ROWS = Array.from({ length: 12 }, (_, month) => {
  const date = `2025-${String(month + 1).padStart(2, '0')}-15`
  return `${date},-10.00,${month === 6 ? 'Travel' : 'Groceries'},Market`
})
const CSV = ['Date,Amount,Category,Merchant', '2025-03-01,-10.00,Groceries,Market', ...MONTH_ROWS, '2025-03-31,-10.00,Groceries,Market', '2025-02-31,-10.00,Groceries,Market'].join('\n')

/**
 * Opens the CSV import for a new user's account with the year of rows uploaded
 *
 * @param latestRecordedDate - A transaction already recorded on the account, which offers the day after it as the start
 */
async function uploadYear(page: Page, request: Parameters<typeof signUpUser>[0], latestRecordedDate?: string) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  if (latestRecordedDate) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -1000, date: latestRecordedDate })
  }
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'year.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })

  // The dates are in the setup panel, which collapses once the file is read, so the pointer is held
  // on it until the test is done there
  await showImportSetup(page)
  return { user, account }
}

// The dates decide which rows the questions, the preview and the import read, and the rows left out
// are counted apart from skipped ones
test('imports only the rows from the start date to the end date', async ({ page, request }) => {
  const { user, account } = await uploadYear(page, request)
  const travel = page.getByRole('combobox', { name: 'Existing category Travel', exact: true })
  await expect(travel).toBeVisible()

  // A date only begun limits nothing yet, so it blocks the import rather than importing every row
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const start = page.getByRole('group', { name: 'Start date', exact: true })
  await start.getByRole('textbox', { name: 'Year', exact: true }).fill('2025')
  await expect(page.getByText('Enter the whole date, or clear it', { exact: true })).toBeVisible()
  await expect(start.getByRole('textbox', { name: 'Year', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(commit).toBeDisabled()

  await typeDate(page, 'Start date', '2025-03-01')
  await typeDate(page, 'End date', '2025-03-31')
  await expect(travel).toHaveCount(0)

  // Held to the preview step, since the file panel beside the steps also counts its rows under Rows
  const preview = page.locator('section').filter({ has: page.getByText('Preview and commit', { exact: true }) })
  await expect(preview.getByRole('paragraph').filter({ hasText: /^(Rows|Will create|New accounts|New categories|\d+)$/ }))
    .toHaveText(['Rows', '15', 'Will create', '3', 'New accounts', '0', 'New categories', '0'])
  await expect(preview.getByText('Rows outside the chosen dates', { exact: true })).toBeVisible()
  await expect(preview.getByText('11 rows are dated outside the chosen dates, so they won\'t be imported.', { exact: true })).toBeVisible()

  await commitImport(page)
  await expect(page.getByRole('dialog').getByText(
    '3 transactions imported · 0 accounts created · 0 categories created · 1 skipped · 11 outside the chosen dates',
    { exact: true },
  )).toBeVisible()

  const stored = await request.get(`${API_BASE_URL}/transactions?account_id=${account.id}`, { headers: asUser(user) })
  expect(stored.status()).toBe(200)
  const dates = (await stored.json() as { dt: string }[]).map((row) => row.dt).sort()
  expect(dates).toEqual(['2025-03-01', '2025-03-15', '2025-03-31'])

  // The finished import's dates stay on its record, held as they were and offering no way to clear them
  await page.getByRole('dialog').getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  for (const label of ['Start date', 'End date']) {
    const field = page.getByRole('group', { name: label, exact: true })
    await expect(field.getByRole('textbox', { name: 'Year', exact: true })).toBeDisabled()
    await expect(field.getByRole('textbox', { name: 'Year', exact: true })).toHaveValue('2025')
  }
  await expect(page.getByRole('button', { name: /^Clear (start|end) date$/ })).toHaveCount(0)
})

/**
 * Waits for a clear button to finish growing in, which its box sets to unclipped only at the end of
 * the motion. Its opacity can read 1 while the width is still a pixel or two short, since the two run
 * on different clocks
 */
async function expectGrownIn(clear: Locator) {
  await expect.poll(() => clear.evaluate((button) => getComputedStyle(button.parentElement!.parentElement!).overflow)).toBe('visible')
}

// The clear button empties only its own date, puts focus on that date's year so keyboard users stay
// in place, and is there only while the date holds something. It takes its room from its own date's
// field alone, so neither field's height nor the other date's field changes
test('clears a date with its clear button and stops limiting the rows', AT_EVERY_SIZE, async ({ page, request }) => {
  await uploadYear(page, request)
  const travel = page.getByRole('combobox', { name: 'Existing category Travel', exact: true })
  await expect(travel).toBeVisible()
  const clearStart = page.getByRole('button', { name: 'Clear start date', exact: true })
  await expect(clearStart).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear end date', exact: true })).toHaveCount(0)
  const startField = page.getByRole('group', { name: 'Start date', exact: true })
  const endField = page.getByRole('group', { name: 'End date', exact: true })
  const startBefore = (await startField.boundingBox())!

  // Where the end date's field is, taken from the start date's so a page that scrolls does not count
  const readEnd = async () => {
    const end = (await endField.boundingBox())!
    return { x: end.x, width: end.width, height: end.height, belowStart: end.y - (await startField.boundingBox())!.y }
  }
  const endBefore = await readEnd()

  // A start date after July leaves the July row out
  const start = await typeDate(page, 'Start date', '2025-08-01')
  await expect(travel).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear end date', exact: true })).toHaveCount(0)

  // Once it has grown in, the button sits right of the field, which has narrowed by its room and kept
  // its height, and the other date's field has not moved
  await expectGrownIn(clearStart)
  const startWith = (await startField.boundingBox())!
  const clearBox = (await clearStart.boundingBox())!
  expect(startWith.height).toBe(startBefore.height)
  expect(startWith.width).toBeLessThan(startBefore.width)
  expect(clearBox.x).toBeGreaterThanOrEqual(startWith.x + startWith.width)
  expect(clearBox.x + clearBox.width).toBeLessThanOrEqual(startBefore.x + startBefore.width)
  expect(await readEnd()).toEqual(endBefore)

  await clearStart.click()
  for (const segment of ['Year', 'Month', 'Day']) {
    await expect(start.getByRole('textbox', { name: segment, exact: true })).toHaveValue('')
  }
  await expect(start.getByRole('textbox', { name: 'Year', exact: true })).toBeFocused()
  await expect(clearStart).toHaveCount(0)

  // The field widens back to where it was as the button goes
  await expect.poll(async () => (await startField.boundingBox())!.width).toBe(startBefore.width)
  expect(await readEnd()).toEqual(endBefore)
  await expect(travel).toBeVisible()
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()

  // A date only begun counts as holding something, and the button empties it too
  await start.getByRole('textbox', { name: 'Year', exact: true }).fill('2025')
  await expect(page.getByText('Enter the whole date, or clear it', { exact: true })).toBeVisible()
  await clearStart.click()
  await expect(start.getByRole('textbox', { name: 'Year', exact: true })).toHaveValue('')
  await expect(page.getByText('Enter the whole date, or clear it', { exact: true })).toHaveCount(0)

  // The end date has its own button, which empties only the end date. The start date is filled again
  // so it can be seen to stay
  const clearEnd = page.getByRole('button', { name: 'Clear end date', exact: true })
  await expect(clearEnd).toHaveCount(0)
  await typeDate(page, 'Start date', '2025-02-01')
  const end = await typeDate(page, 'End date', '2025-09-30')
  await expectGrownIn(clearEnd)
  await expectGrownIn(clearStart)
  await clearEnd.click()
  for (const segment of ['Year', 'Month', 'Day']) {
    await expect(end.getByRole('textbox', { name: segment, exact: true })).toHaveValue('')
  }
  await expect(end.getByRole('textbox', { name: 'Year', exact: true })).toBeFocused()
  await expect(clearEnd).toHaveCount(0)
  await expect(start.getByRole('textbox', { name: 'Year', exact: true })).toHaveValue('2025')
  await expect(start.getByRole('textbox', { name: 'Month', exact: true })).toHaveValue(/^0?2$/)
  await expect(clearStart).toBeVisible()

  // A date the dates come back holding, as when the date column is unmapped and mapped again, draws its
  // button already at rest, with no motion to unclip it, so it must not be left clipped
  const dateColumn = page.getByRole('combobox', { name: 'Match to app field Date', exact: true })
  await dateColumn.click()
  await page.getByRole('option', { name: /^Currency\b/ }).click()
  await showImportSetup(page)
  await expect(start).toHaveCount(0)
  await dateColumn.click()
  await page.getByRole('option', { name: /^Date\b/ }).click()
  await showImportSetup(page)
  await expect(start).toBeVisible()
  await expect(start.getByRole('textbox', { name: 'Year', exact: true })).toHaveValue('2025')
  await expect(clearStart).toBeVisible()
  await expectGrownIn(clearStart)
})

// The dates sit in the File section beside the other reading choices, not in Column mapping, and
// show only once a column is mapped as the date
test('puts the dates in the File section after Skip last rows and blocks the import while they are crossed', AT_EVERY_SIZE, async ({ page, request }) => {
  await uploadYear(page, request, '2024-12-31')
  const fileSection = page.locator('section').filter({ has: page.getByText('Upload one CSV transaction file, or several with the same columns.', { exact: true }) })
  const columnMapping = page.locator('section').filter({ has: page.getByText('Specify what each column in this import holds.', { exact: true }) })
  await expect(fileSection.getByText('Dates to import', { exact: true })).toBeVisible()
  await expect(columnMapping.getByText('Dates to import', { exact: true })).toHaveCount(0)

  const start = await typeDate(page, 'Start date', '2025-04-01')
  const end = await typeDate(page, 'End date', '2025-03-01')
  await expect(fileSection.getByRole('group', { name: 'Start date', exact: true })).toBeVisible()
  await expect(fileSection.getByRole('group', { name: 'End date', exact: true })).toBeVisible()

  // On the start date's label row, which alone is marked invalid and points at it
  const crossed = page.getByText('Must be on or before the end date', { exact: true })
  await expect(crossed).toBeVisible()
  const crossedBox = (await crossed.boundingBox())!
  expect(crossedBox.y).toBeLessThan((await start.boundingBox())!.y)
  await expect(start.getByRole('textbox', { name: 'Day', exact: true })).toHaveAttribute('aria-invalid', 'true')
  await expect(end.getByRole('textbox', { name: 'Day', exact: true })).toHaveAttribute('aria-invalid', 'false')
  await expect(start.getByRole('textbox', { name: 'Day', exact: true })).toHaveAccessibleDescription('Must be on or before the end date')

  // The message and the suggestion beside it leave the start date's label on one line, as the end date's is
  await expect(fileSection.getByRole('button', { name: 'Latest recorded transaction', exact: true })).toBeVisible()
  const startLabelBox = (await fileSection.getByText('Start date', { exact: true }).boundingBox())!
  const endLabelBox = (await fileSection.getByText('End date', { exact: true }).boundingBox())!
  expect(startLabelBox.height).toBe(endLabelBox.height)
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeDisabled()
  await expect(page.getByText('No rows in this import fall within the chosen dates.', { exact: true })).toHaveCount(0)

  // Under Skip last rows, and neither date runs out of the section at any size
  const sectionBox = (await fileSection.boundingBox())!
  const startBox = (await start.boundingBox())!
  const endBox = (await end.boundingBox())!
  const skipBox = (await fileSection.getByLabel('Skip last rows', { exact: true }).boundingBox())!
  expect(startBox.y).toBeGreaterThanOrEqual(skipBox.y + skipBox.height)
  for (const box of [startBox, endBox]) {
    expect(box.x).toBeGreaterThanOrEqual(sectionBox.x)
    expect(box.x + box.width).toBeLessThanOrEqual(sectionBox.x + sectionBox.width)
  }
})

// The widths the messages were seen to wrap at, and the ones either side of them
const LAYOUT_WIDTHS = [375, 390, 768, 1024, 1280]

/**
 * Reads the width of each line a message wraps to
 */
async function readLineWidths(message: Locator) {
  return message.evaluate((element) => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const widths = new Map<number, number>()
    for (const rect of range.getClientRects()) {
      const top = Math.round(rect.top)
      widths.set(top, (widths.get(top) ?? 0) + rect.width)
    }
    return [...widths.values()]
  })
}

/**
 * Checks at every width that the message stays inside the screen and wraps without stranding a word
 * on a line of its own
 */
async function checkLayoutAtEveryWidth(page: Page, message: Locator) {
  const height = page.viewportSize()!.height
  for (const width of LAYOUT_WIDTHS) {
    await page.setViewportSize({ width, height })
    await expect(message).toBeVisible()
    const messageBox = (await message.boundingBox())!
    expect.soft(messageBox.x + messageBox.width, `message right edge at ${width}px`).toBeLessThanOrEqual(width)
    const lines = await readLineWidths(message)
    expect.soft(Math.min(...lines) / Math.max(...lines), `shortest line against longest at ${width}px`).toBeGreaterThan(0.4)
  }
}

// Desktop only, since it sets each width itself rather than relying on the size projects
test('keeps the dates\' messages whole at every width', async ({ page, request }) => {
  await uploadYear(page, request)
  await typeDate(page, 'Start date', '2025-04-01')
  const end = await typeDate(page, 'End date', '2025-03-01')

  // The setup panel the messages are in stays collapsed through a resize, so its strip is pinned open
  const strip = page.getByRole('button', { name: 'Expand import setup', exact: true })
  await expect(strip).toBeVisible()
  await strip.click()
  await checkLayoutAtEveryWidth(page, page.getByText('Must be on or before the end date', { exact: true }))

  await end.getByRole('textbox', { name: 'Day', exact: true }).fill('')
  await checkLayoutAtEveryWidth(page, page.getByText('Enter the whole date, or clear it', { exact: true }))
})

// A unit test can't click, and the empty space is only reachable by a real click at a point inside the
// field's box that is on no segment or button. Reduced motion is on, so the field takes the width the
// clear button leaves it at once and its box can be read as soon as a date is entered
test('focuses the year when the empty space of a date field is clicked, empty or filled', async ({ page, request }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await uploadYear(page, request)
  const start = page.getByRole('group', { name: 'Start date', exact: true })
  const year = start.getByRole('textbox', { name: 'Year', exact: true })
  const month = start.getByRole('textbox', { name: 'Month', exact: true })
  const emptyWidth = (await start.boundingBox())!.width

  // Read from the field's box as it stands, since the clear button narrows a filled field
  const findEmptySpace = async () => {
    const box = await start.boundingBox()
    const monthBox = await month.boundingBox()
    if (!box || !monthBox) throw new Error('The start date field has no box')

    // Well right of the segments and well left of the calendar button
    const emptySpace = { x: box.width - 60, y: box.height / 2 }
    expect(box.x + emptySpace.x).toBeGreaterThan(monthBox.x + monthBox.width + 60)
    return emptySpace
  }

  let emptySpace = await findEmptySpace()
  await month.click()
  await expect(month).toBeFocused()
  await start.click({ position: emptySpace })
  await expect(year).toBeFocused()

  // Read the moment the button is in the page, where a width animation would still be moving
  await year.fill('2025')
  const clearStart = page.getByRole('button', { name: 'Clear start date', exact: true })
  await expect(clearStart).toBeVisible()
  const narrowedWidth = (await start.boundingBox())!.width
  expect(narrowedWidth).toBeLessThan(emptyWidth)
  await expect(clearStart).toHaveCSS('opacity', '1')
  expect((await start.boundingBox())!.width).toBe(narrowedWidth)
  await typeDate(page, 'Start date', '2025-03-01')
  emptySpace = await findEmptySpace()
  await month.click()
  await expect(month).toBeFocused()
  await start.click({ position: emptySpace })
  await expect(year).toBeFocused()
})

// The calendar opens outside the field and takes focus, so only the field's own styling can keep its
// focused look, and the look is read from a focused field rather than copied into the test
test('keeps the focused look on a date field while its calendar is open', async ({ page, request }) => {
  await uploadYear(page, request)
  const start = page.getByRole('group', { name: 'Start date', exact: true })
  const year = start.getByRole('textbox', { name: 'Year', exact: true })
  const settledLook = () =>
    start.evaluate(async (field) => {
      await Promise.all(field.getAnimations().map((animation) => animation.finished))
      const style = getComputedStyle(field)
      return { borderColor: style.borderColor, boxShadow: style.boxShadow }
    })

  const resting = await settledLook()
  await year.click()
  await expect(year).toBeFocused()
  const focused = await settledLook()
  expect(focused.boxShadow).not.toBe(resting.boxShadow)
  expect(focused.borderColor).not.toBe(resting.borderColor)

  await start.getByRole('button', { name: 'Open calendar', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(year).not.toBeFocused()
  await expect.poll(settledLook).toEqual(focused)
})
