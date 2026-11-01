import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { measureFit, measureOwnScroll, measureRows } from '../support/layout'

// Runs on desktop only: it sets the window sizes it checks itself

/**
 * Guards the CSV import's Column mapping, Category matching, Merchant matching and Tag matching tables, which share
 * their layout with the Firefly III and Actual Budget importers. Each held a fixed minimum width, so on
 * a 1280px window the matching tables scrolled sideways inside a clipping box, and the column mapping
 * table pushed the whole pane sideways. The same clipping box cut off a row's help where it reached past
 * the table. Below the desktop layout the tables still scroll sideways, but only inside their own box
 */

// From the desktop layout's first width, so a switch that drifts wider fails here
const DESKTOP_WIDTHS = [1920, 1280, 1050]

const NARROW_WIDTHS = [1024, 768, 390]

// Reports every width and step that fails, rather than stopping at the first
const soft = expect.configure({ soft: true })

// Two categories with names, one of which the user already holds as income while its amount reads as an
// expense, so creating it as a new category proposes a new name with a note on why. The two tags sit past
// the first five rows, which are the ones the preview shows, because a previewed row with a tag lets the
// tag panel's blur reach 2px past the steps column at 1920px, which is not about these tables
const CSV = [
  'Date,Amount,Category,Merchant,Tags',
  '2024-03-15,-42.50,Groceries,Corner Market,',
  '2024-03-17,-30.00,Salary,Studio,',
  '2024-03-18,-12.00,Groceries,Corner Market,',
  '2024-03-19,-8.00,Groceries,Corner Market,',
  '2024-03-20,-9.00,Groceries,Corner Market,',
  '2024-03-21,-7.00,Groceries,Corner Market,Weekend',
  '2024-03-22,-6.00,Groceries,Corner Market,Trip',
].join('\n')

const STEPS = ['Column mapping', 'Category matching', 'Merchant matching', 'Tag matching']

async function openMatchingSteps(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'categories.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await expect(page.getByRole('combobox', { name: 'Existing category Salary', exact: true })).toBeVisible()
}

/** Each step's table */
function tableOf(page: Page, step: string) {
  return page.locator('section').filter({ has: page.getByText(step, { exact: true }) }).getByRole('table')
}

/** The boxes from the table up to the page that scroll up and down */
function scrollingAround(table: Locator) {
  return table.evaluate((node) => {
    const scrolling: string[] = []
    for (let box: Element | null = node; box; box = box.parentElement) {
      if (box.scrollHeight > box.clientHeight + 1 && getComputedStyle(box).overflowY !== 'visible') {
        scrolling.push(`${box.tagName.toLowerCase()}.${box.className}`)
      }
    }
    return scrolling
  })
}

test('fits each import table to a desktop window, with every row\'s controls on screen', async ({ page, request }) => {
  await openMatchingSteps(page, request)

  for (const width of DESKTOP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const step of STEPS) {
      const table = tableOf(page, step)
      await expect(table).toBeVisible()
      await soft.poll(() => measureFit(table), { message: `${step} at ${width}px` }).toEqual({ scrolling: [], clipped: [] })
    }

    // A row's dropdown opens against where its field sat, without scrolling anything sideways first. The
    // field moves with the open list, so its place is read before it opens
    const field = page.getByRole('combobox', { name: 'Existing category Groceries', exact: true })
    await field.scrollIntoViewIfNeeded()
    const fieldBox = await field.boundingBox()
    await field.click()
    const list = page.getByRole('listbox')
    await expect(list).toBeInViewport({ ratio: 1 })
    const listBox = await list.boundingBox()
    const gap = Math.min(Math.abs(listBox!.y - (fieldBox!.y + fieldBox!.height)), Math.abs(fieldBox!.y - (listBox!.y + listBox!.height)))
    // The open box grows away from whichever side it is pinned by, so one of its edges stays with the field
    const pinned = Math.abs(listBox!.x - fieldBox!.x) <= 16
      || Math.abs(listBox!.x + listBox!.width - (fieldBox!.x + fieldBox!.width)) <= 16
    expect({ gap: gap <= 16, pinned }, `dropdown at ${width}px`).toEqual({ gap: true, pinned: true })
    await page.keyboard.press('Escape')
    await expect(list).toHaveCount(0)
  }
})

// The widths the controls are checked at, wide and the desktop layout's common narrow window
const CONTROL_EDGE_WIDTHS = [1920, 1280]

// The room an error icon needs beside a row's controls, in pixels: the icon's 16px and the gap before it
const ICON_ROOM = 24

/**
 * How much room each row leaves between its last field and the table's right edge, in pixels, which
 * is none unless the row's table holds room for an icon
 */
function measureRoomAfterControls(table: Locator) {
  return table.evaluate((node) => [...node.querySelectorAll('tbody tr')].map((row) => {
    const controls = [...row.lastElementChild!.querySelectorAll('[role="combobox"]')]
    return {
      name: row.firstElementChild!.textContent!.trim(),
      room: Math.round(node.getBoundingClientRect().right - Math.max(...controls.map((control) => control.getBoundingClientRect().right))),
    }
  }))
}

// Column mapping kept room for a row's error or help icon whether a row showed one or not, so its
// controls ended 24px short of every other step's. Lining the others up with it instead cut "Create new
// merchant" off on a 1280px window
test('ends every step\'s controls at the table\'s edge, making room for an icon only while a row shows one', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()

  // One account the user has and one the import creates, whose row offers an institution to choose
  const csv = [
    'Date,Amount,Category,Merchant,Account,Reference,Tags',
    '2024-03-15,-42.50,Pottery,Corner Market,Everyday chequing,R-1,Weekend',
    '2024-03-16,-17.25,Pottery,Bakery,Visa,R-2,Trip',
  ].join('\n')
  await upload.setInputFiles({ name: 'edges.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await expect(page.getByRole('combobox', { name: 'Existing account Visa', exact: true })).toHaveText('Create new account')
  const category = page.getByRole('combobox', { name: 'Existing category Pottery', exact: true })
  await category.click()
  await page.getByRole('option', { name: 'Create new category', exact: true }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
  const steps = ['Account mapping', ...STEPS]
  const answers = [
    category.getByTitle('Create new category', { exact: true }),
    page.getByRole('combobox', { name: 'Merchant Corner Market', exact: true }).getByTitle('Create new merchant', { exact: true }),
    page.getByRole('combobox', { name: 'Tag Weekend', exact: true }).getByTitle('Create new tag', { exact: true }),
  ]

  for (const width of CONTROL_EDGE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const step of steps) {
      const rooms = (await measureRoomAfterControls(tableOf(page, step))).map(({ room }) => room)
      soft(rooms.length, `${step} rows at ${width}px`).toBeGreaterThan(0)
      soft(rooms.every((room) => Math.abs(room) <= 1), `${step} at ${width}px leaves ${rooms.join(', ')}px`).toBe(true)
    }
    for (const answer of answers) {
      await expect(answer).toBeVisible()
      soft(await answer.evaluate((node) => node.scrollWidth - node.clientWidth), `${await answer.getAttribute('title')} at ${width}px`)
        .toBeLessThanOrEqual(0)
    }
  }

  // A column whose values the field it is matched to can't read shows its error beside its field, and
  // only that row makes room for it, and every other row's controls still end at the table's edge
  const columnMapping = tableOf(page, 'Column mapping')
  const referenceField = page.getByRole('combobox', { name: 'Match to app field Reference', exact: true })
  await referenceField.click()
  await page.getByRole('option', { name: /^Currency\b/ }).click()
  await expect(referenceField).toHaveAttribute('aria-invalid', 'true')
  const icon = columnMapping.getByRole('row', { name: /^Reference\b/ }).getByRole('button')
  for (const width of CONTROL_EDGE_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await icon.scrollIntoViewIfNeeded()
    await expect(icon).toBeInViewport({ ratio: 1 })
    await expectRoomInRows(columnMapping, { Reference: ICON_ROOM }, `Column mapping at ${width}px with an error`)
  }
})

/**
 * Waits for the rows named in `rooms` to leave that room after their controls, and every other row to
 * leave none, within a pixel
 */
async function expectRoomInRows(table: Locator, rooms: Record<string, number>, message: string) {
  // Polled, since a field's list closes into it after a choice, and a row's room eases in and out
  await soft.poll(async () => {
    const measured = await measureRoomAfterControls(table)
    return measured.length > 0 && measured.every(({ name, room }) => {
      const expected = Object.entries(rooms).find(([row]) => name.startsWith(row))?.[1] ?? 0
      return Math.abs(room - expected) <= 1
    })
  }, { message }).toBe(true)
}

// The note on how timestamp dates are imported needs the same room as an error, in the Date row only,
// and gives it back once the row stops showing it
test('makes room in Column mapping for the note on timestamp dates only while it shows', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  const csv = ['Date,Amount,Notes', '2024-03-15T00:30:00Z,-12.34,Coffee', '2024-03-16T08:00:00-04:00,-5.00,Bread'].join('\n')
  await upload.setInputFiles({ name: 'timestamps.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  const columnMapping = tableOf(page, 'Column mapping')
  const note = page.getByRole('button', { name: 'How timestamp dates are imported', exact: true })
  await expect(note).toBeVisible()
  await expectRoomInRows(columnMapping, { Date: ICON_ROOM }, 'Column mapping beside the timestamp note')

  const dateField = page.getByRole('combobox', { name: 'Match to app field Date', exact: true })
  await dateField.click()
  await page.getByRole('option', { name: 'Do not import', exact: true }).click()
  await expect(dateField).toContainText('Do not import')
  await expect(note).toHaveCount(0)
  await expectRoomInRows(columnMapping, {}, 'Column mapping once the note has gone')
})

test('keeps a narrow window\'s sideways scroll inside each import table\'s own box', async ({ page, request }) => {
  await openMatchingSteps(page, request)

  for (const width of NARROW_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    for (const step of STEPS) {
      const table = tableOf(page, step)
      await expect(table).toBeVisible()
      // The table keeps its columns' width, so a phone or tablet scrolls the box right around it, and
      // nothing past that box, up to the page
      await soft.poll(() => measureOwnScroll(table), { message: `${step} at ${width}px` })
        .toEqual({ scrolls: width <= 768 ? true : expect.any(Boolean), outside: [] })
    }
  }
})

test('opens the note on a renamed category in full in a short table', async ({ page, request }) => {
  await openMatchingSteps(page, request)
  await page.getByRole('combobox', { name: 'Existing category Salary', exact: true }).click()
  await page.getByRole('option', { name: 'Create new category' }).click()
  const trigger = page.getByRole('button', { name: 'Why Salary has a new name', exact: true })
  const table = tableOf(page, 'Category matching')

  for (const width of DESKTOP_WIDTHS) {
    await page.setViewportSize({ width, height: 900 })
    await trigger.scrollIntoViewIfNeeded()
    const scrollingBefore = await scrollingAround(table)
    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const note = page.getByText('"Salary" is already an income category')
    await expect(note).toBeInViewport({ ratio: 1 })

    // Nothing covers or cuts off any corner of the note, and opening it doesn't make a box scroll that
    // didn't before
    const hiddenCorners = await note.evaluate((panel) => {
      const rect = panel.getBoundingClientRect()
      return [[rect.left + 2, rect.top + 2], [rect.right - 2, rect.top + 2], [rect.left + 2, rect.bottom - 2], [rect.right - 2, rect.bottom - 2]]
        .filter(([x, y]) => !panel.contains(document.elementFromPoint(x, y))).length
    })
    expect({ hiddenCorners, scrolling: await scrollingAround(table) }, `at ${width}px`)
      .toEqual({ hiddenCorners: 0, scrolling: scrollingBefore })

    await trigger.press('Enter')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  }
})

// A long heading ran out of its cell with the Ignored badge over the examples, a heading that wrapped
// made its row taller than the rest, and the date format dropdown squeezed to a letter beside its tag
test('keeps every Column mapping row one height with its content inside its cell', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()

  // No date format reads the dates, so the Date row shows its error
  const csv = [
    'Date,Amount,Transactionreferencenumber,Balance after transaction,Notes',
    '2024-13-45,"1,234",R-1,10.00,Coffee',
    '99/99/2024,5.678,R-2,20.00,Bread',
  ].join('\n')
  await upload.setInputFiles({ name: 'long-headings.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const table = tableOf(page, 'Column mapping')
  await expect(table).toBeVisible()
  await page.getByRole('combobox', { name: 'Match to app field Date', exact: true }).click()
  await page.getByRole('option', { name: /^Date\b/ }).click()
  const dateFormat = page.getByRole('combobox', { name: 'Date format', exact: true })
  await expect(dateFormat).toHaveText('Choose the date format')
  await expect(table.getByRole('button', { name: /is not a valid date/ })).toBeVisible()

  await expect(page.getByRole('combobox', { name: 'Amount format', exact: true })).toHaveText('Choose the amount format')

  // At 1280px the long heading is really shortened, with its Ignored badge beside it and its full text
  // on hover
  await page.setViewportSize({ width: 1280, height: 800 })
  await expect(table.getByRole('row', { name: /^Transactionreferencenumber\s*Ignored/ })).toBeVisible()
  const heading = table.getByTitle('Transactionreferencenumber', { exact: true })
  await expect.poll(() => heading.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)

  // A chosen format may end in an ellipsis beside its tag, which its hover title completes. Its entry
  // is the label alone, since the tag sits in a box of its own
  const expectIntact = async (message: string, shortenedText = '') => {
    await soft.poll(async () => {
      const rows = await measureRows(table)
      const spill = rows.flatMap((row) => row.spill).filter((entry) => entry !== `dropdown text ${shortenedText}`)
      return { heights: new Set(rows.map(({ height }) => height)).size, spill }
    }, { message }).toEqual({ heights: 1, spill: [] })
  }

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await expectIntact(`placeholders at ${width}px`)
  }

  // A format that does not fit shows its tag, and the dropdown still shows more than a letter
  await dateFormat.click()
  await page.getByRole('option', { name: /^Day first/ }).click()
  await expect(dateFormat).toContainText('Does not fit')
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    await expectIntact(`a format that does not fit at ${width}px`, 'Day first (30/04/2026)')
    soft(await dateFormat.locator('.truncate').evaluate((text) => text.clientWidth), `the format's text at ${width}px`).toBeGreaterThan(60)
  }
})

// A row's icon took its room from the whole Match to app field cell, so the Date row's field came out
// narrower than the Amount row's, and the two no longer lined up
test('keeps the Date row\'s field as wide as the Amount row\'s while its icon takes room from the date format', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  const csv = ['Date,Amount', '2024-13-45,"1,234"', '99/99/2024,5.678'].join('\n')
  await upload.setInputFiles({ name: 'dates.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })

  const table = tableOf(page, 'Column mapping')
  await expect(table).toBeVisible()
  const dateField = page.getByRole('combobox', { name: 'Match to app field Date', exact: true })
  const amountField = page.getByRole('combobox', { name: 'Match to app field Amount', exact: true })
  const dateFormat = page.getByRole('combobox', { name: 'Date format', exact: true })
  const amountFormat = page.getByRole('combobox', { name: 'Amount format', exact: true })
  await dateField.click()
  await page.getByRole('option', { name: /^Date\b/ }).click()
  await dateFormat.click()
  await page.getByRole('option', { name: /^Day first/ }).click()
  await expect(dateFormat).toContainText('Does not fit')
  await expect(table.getByRole('row', { name: /^Date\b/ }).getByRole('button')).toBeVisible()

  const measure = async (control: Locator) => {
    const box = (await control.boundingBox())!
    return { x: box.x, width: box.width }
  }

  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 })
    // Polled, since the icon's room eases in
    await expect.poll(async () => {
      const [date, amount] = await Promise.all([measure(dateField), measure(amountField)])
      return Math.abs(date.x - amount.x) <= 1 && Math.abs(date.width - amount.width) <= 1
        ? 'aligned'
        : `Date field at ${date.x} by ${date.width}, Amount field at ${amount.x} by ${amount.width}`
    }, { message: `the fields at ${width}px` }).toBe('aligned')

    // The room came out of the date format, which is narrower than the amount format by the icon's room
    await expect.poll(async () => {
      const [date, amount] = await Promise.all([measure(dateFormat), measure(amountFormat)])
      return Math.round(amount.width - date.width)
    }, { message: `the formats at ${width}px` }).toBe(ICON_ROOM)
  }
})
