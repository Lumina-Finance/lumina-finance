import { expect, test, type Locator, type Page } from '@playwright/test'

import { asUser, createAccount, signUpUser } from '../support/api'
import { commitImport, logInViaApi, openPage, typeDate } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only, except the section test, which runs at every size because the File section
// sits in a narrow sidebar on a wide screen and stacks above the steps on a phone

// One row in the middle of each month of 2025, plus the first and last day of March, so each end of
// a March range has a row on it. Travel is filed only in July
const MONTH_ROWS = Array.from({ length: 12 }, (_, month) => {
  const date = `2025-${String(month + 1).padStart(2, '0')}-15`
  return `${date},-10.00,${month === 6 ? 'Travel' : 'Groceries'},Market`
})
const CSV = ['Date,Amount,Category,Merchant', '2025-03-01,-10.00,Groceries,Market', ...MONTH_ROWS, '2025-03-31,-10.00,Groceries,Market'].join('\n')

/**
 * Opens the CSV import for a new user's account with the year of rows uploaded
 */
async function uploadYear(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'year.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  return { user, account }
}

// The dates decide which rows the questions, the preview and the import read, and the rows left out
// are counted apart from skipped ones
test('imports only the rows from the start date to the end date', async ({ page, request }) => {
  const { user, account } = await uploadYear(page, request)
  const travel = page.getByRole('combobox', { name: 'Existing Category Travel', exact: true })
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
  const preview = page.locator('section').filter({ has: page.getByText('Preview and Commit', { exact: true }) })
  await expect(preview.getByRole('paragraph').filter({ hasText: /^(Rows|Will Create|New Accounts|New Categories|\d+)$/ }))
    .toHaveText(['Rows', '14', 'Will Create', '3', 'New Accounts', '0', 'New Categories', '0'])
  await expect(preview.getByText('Rows outside the chosen dates', { exact: true })).toBeVisible()
  await expect(preview.getByText('11 rows are dated outside the chosen dates, so they won\'t be imported.', { exact: true })).toBeVisible()

  await commitImport(page)
  await expect(page.getByRole('dialog').getByText(
    '3 transactions imported · 0 accounts created · 0 categories created · 11 outside the chosen dates',
    { exact: true },
  )).toBeVisible()

  const stored = await request.get(`${API_BASE_URL}/transactions?account_id=${account.id}`, { headers: asUser(user) })
  expect(stored.status()).toBe(200)
  const dates = (await stored.json() as { dt: string }[]).map((row) => row.dt).sort()
  expect(dates).toEqual(['2025-03-01', '2025-03-15', '2025-03-31'])
})

// The dates sit in the File section beside the other reading choices, not in Column Mapping, and
// show only once a column is mapped as the date
test('puts the dates in the File section after Skip last rows and blocks the import while they are crossed', AT_EVERY_SIZE, async ({ page, request }) => {
  await uploadYear(page, request)
  const fileSection = page.locator('section').filter({ has: page.getByText('Upload one CSV transaction file, or several with the same columns.', { exact: true }) })
  const columnMapping = page.locator('section').filter({ has: page.getByText('Specify what each column in this import holds.', { exact: true }) })
  await expect(fileSection.getByText('Dates to import', { exact: true })).toBeVisible()
  await expect(columnMapping.getByText('Dates to import', { exact: true })).toHaveCount(0)

  const start = await typeDate(page, 'Start date', '2025-04-01')
  const end = await typeDate(page, 'End date', '2025-03-01')
  await expect(fileSection.getByRole('group', { name: 'Start date', exact: true })).toBeVisible()
  await expect(fileSection.getByRole('group', { name: 'End date', exact: true })).toBeVisible()

  await expect(page.getByText('Must be on or before the end date', { exact: true })).toBeVisible()
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
  await checkLayoutAtEveryWidth(page, page.getByText('Must be on or before the end date', { exact: true }))

  await end.getByRole('textbox', { name: 'Day', exact: true }).fill('')
  await checkLayoutAtEveryWidth(page, page.getByText('Enter the whole date, or clear it', { exact: true }))
})
