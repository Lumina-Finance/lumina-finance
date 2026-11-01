import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs at every size where the button's name, its confirmation or the selection row it joins lay out
// differently on a phone. The tests that only watch which rows are saved run on desktop alone, and the two
// toolbar layout tests run on desktop alone too, since they set each width they check themselves

const EXPORT_ALL = { name: 'Export all', exact: true } as const
const EXPORT_FILTERED = { name: 'Export filtered', exact: true } as const
const EXPORT_SELECTED = { name: 'Export selected', exact: true } as const
const SELECT_MODE = { name: 'Select transactions', exact: true } as const
const FAILURE_TOAST = 'Oops, something went wrong and nothing was downloaded. Please try again.'

/** Counts every download the page starts, which a press that must not download is held against */
function countDownloads(page: Page) {
  const counter = { count: 0 }
  page.on('download', () => (counter.count += 1))
  return counter
}

/** The rows of a saved file after its header, split into cells by simple commas */
async function readExportRows(path: string) {
  const lines = (await readFile(path, 'utf8')).replace(/^﻿/, '').trim().split('\r\n')
  expect(lines[0]).toBe('Date,Merchant,Category,Account,Tags,Amount,Currency,Notes')
  return lines.slice(1)
}

/** Ticks the row dated on the given day, which each seeded row has to itself */
async function tickRow(page: Page, date: string) {
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${date}$`) }).check()
}

/** Submits a search the way a person does */
async function search(page: Page, text: string) {
  const field = page.getByPlaceholder('Search transactions...', { exact: true })
  await field.fill(text)
  await field.press('Enter')
}

/** Submits a search and waits for the list's answer to it, which a press made before it must have come ahead of */
async function searchAndWaitForAnswer(page: Page, text: string) {
  const answered = page.waitForResponse((response) => response.url().includes('/transactions?') && response.url().includes(`q=${text}`))
  await search(page, text)
  await answered
}

/** Seeds an account with one old and one recent expense, each on a day of its own */
async function seedTwoTransactions(request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250, date: daysFromTodayInTestTimezone(0), notes: 'Coffee today' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -90000, date: daysFromTodayInTestTimezone(-400), notes: 'Old rent' })
  return user
}

// Nothing narrows the list, so the button says Export all and asks first. Cancel, Escape and a press
// outside download nothing, Download all saves every date, and the list behind never changes
test('asks before downloading every transaction and saves them all when confirmed', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // A phone's rows leave their notes out, so the rows are counted
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const downloads = countDownloads(page)
  const button = page.getByRole('button', EXPORT_ALL)

  // The word shows from the tablet width up, and the icon-only phone button carries the same name
  if (page.viewportSize()!.width >= 750) await expect(button).toContainText('Export all')

  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Download all your transactions?', exact: true })
  await expect(dialog.getByText('To export only some, cancel and search or filter the list first.', { exact: true })).toBeVisible()
  expect(downloads.count).toBe(0)

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()

  await button.click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(downloads.count).toBe(0)

  await button.click()
  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download all', exact: true }).click()
  const download = await downloadStarted

  expect(download.suggestedFilename()).toBe(`lumina-finance-transactions-${todayInTestTimezone()}.csv`)
  expect(await readExportRows((await download.path())!)).toEqual([
    expect.stringMatching(/^\d{4}-\d{2}-\d{2},.+,Groceries,Everyday,,-42\.50,CAD,Coffee today$/),
    expect.stringMatching(/^\d{4}-\d{2}-\d{2},.+,Groceries,Everyday,,-900\.00,CAD,Old rent$/),
  ])
  await expect(dialog).toBeHidden()
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
})

// A submitted search turns the word to Export filtered, and the press saves what it matches straight
// away with no confirmation. A search that is only typed has not narrowed the list yet
test('exports what a submitted search keeps without asking', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const downloads = countDownloads(page)

  const field = page.getByPlaceholder('Search transactions...', { exact: true })
  await field.fill('Coffee')
  await expect(page.getByRole('button', EXPORT_ALL)).toBeVisible()
  await field.press('Enter')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(1)

  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', EXPORT_FILTERED).click()
  const rows = await readExportRows((await (await downloadStarted).path())!)

  expect(rows).toEqual([expect.stringMatching(/,Groceries,Everyday,,-42\.50,CAD,Coffee today$/)])
  expect(downloads.count).toBe(1)
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

// The file holds every matching row, not the page the list has loaded and not the fifty a list request can
// return, for the export of everything and for the export of what a search keeps
test('saves every row when there are more than one list page of them', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  for (let index = 0; index < 55; index += 1) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -(index + 1) * 100, date: daysFromTodayInTestTimezone(-index), notes: `Bulk ${index}` })
  }
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  expect(await page.getByTestId(/^transaction-row-/).count()).toBeLessThan(55)

  await page.getByRole('button', EXPORT_ALL).click()
  const everythingStarted = page.waitForEvent('download')
  await page.getByRole('dialog').getByRole('button', { name: 'Download all', exact: true }).click()
  expect(await readExportRows((await (await everythingStarted).path())!)).toHaveLength(55)

  await search(page, 'Bulk')
  const filteredStarted = page.waitForEvent('download')
  await page.getByRole('button', EXPORT_FILTERED).click()
  expect(await readExportRows((await (await filteredStarted).path())!)).toHaveLength(55)
})

// The button is held off while the file is being prepared, so pressing again saves one file, not two
test('saves one file when the export button is pressed again while it is working', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  await search(page, 'Coffee')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(1)

  let exportRequests = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/transactions/export*', async (route) => {
    exportRequests += 1
    await held
    await route.continue()
  })
  const downloads = countDownloads(page)
  const button = page.getByRole('button', EXPORT_FILTERED)
  await button.click()
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await button.click({ force: true })
  await button.press('Enter')

  const downloadStarted = page.waitForEvent('download')
  release()
  await readExportRows((await (await downloadStarted).path())!)
  await expect(button).toHaveAttribute('aria-busy', 'false')
  expect(exportRequests).toBe(1)
  expect(downloads.count).toBe(1)
})

// A date filter alone is a filter, so the word says Export filtered and the file keeps to the range
test('counts a date filter as narrowing the export', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, `/transactions?from_date=${daysFromTodayInTestTimezone(-30)}&to_date=${daysFromTodayInTestTimezone(0)}`)
  await expect(page.getByText('Coffee today', { exact: true })).toBeVisible()
  await expect(page.getByText('Old rent', { exact: true })).toHaveCount(0)

  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', EXPORT_FILTERED).click()

  expect(await readExportRows((await (await downloadStarted).path())!)).toEqual([expect.stringMatching(/,Coffee today$/)])
})

// Select mode keeps the button reachable beside Edit and Delete. Ticked rows turn the word to Export
// selected and save only those rows, newest first, with no confirmation
test('exports only the ticked rows from select mode', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const dates = [0, -1, -2].map(daysFromTodayInTestTimezone)
  for (const [index, date] of dates.entries()) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -(index + 1) * 1000, date, notes: `Row ${index}` })
  }

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(3)
  const downloads = countDownloads(page)

  await page.getByRole('button', SELECT_MODE).click()
  await expect(page.getByRole('button', { name: 'Edit the selected transactions', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete the selected transactions', exact: true })).toBeVisible()
  await expect(page.getByRole('button', EXPORT_ALL)).toBeVisible()

  await tickRow(page, dates[2])
  await tickRow(page, dates[0])
  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', EXPORT_SELECTED).click()
  const rows = await readExportRows((await (await downloadStarted).path())!)

  expect(rows).toEqual([expect.stringMatching(/,-10\.00,CAD,Row 0$/), expect.stringMatching(/,-30\.00,CAD,Row 2$/)])
  expect(downloads.count).toBe(1)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  // The ticks stay, so the same rows can be saved again or edited next
  await expect(page.getByRole('button', EXPORT_SELECTED)).toBeVisible()
})

// The Export icon button joins the selection row and tightens it, which must not squeeze the Edit pencil
// narrower than the 18px it is drawn at, to a sliver at 390 and to nothing at 320
test('keeps the Edit pencil its full size beside the Export button on a phone', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', SELECT_MODE).click()
    await expect(page.getByRole('button', EXPORT_ALL)).toBeVisible()
    const pencil = page.getByRole('button', { name: 'Edit the selected transactions', exact: true }).locator('svg')
    await expect.poll(async () => (await pencil.boundingBox())?.width, { message: `Pencil width at ${width}px` }).toBe(18)
    await page.getByRole('button', { name: 'Stop selecting transactions', exact: true }).click()
  }
})

// Ticked rows win over a filter that is also on: the word stays Export selected and the file holds the
// ticked rows and not everything the filter keeps
test('exports only the ticked rows when a filter is also on', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  const dates = [0, -1, -2].map(daysFromTodayInTestTimezone)
  for (const [index, date] of dates.entries()) {
    await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -(index + 1) * 1000, date, notes: `Row ${index}` })
  }
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -77700, date: daysFromTodayInTestTimezone(-400), notes: 'Outside the filter' })

  await logInViaApi(page, user)
  await openPage(page, `/transactions?from_date=${dates[2]}&to_date=${dates[0]}`)
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(3)
  await expect(page.getByRole('button', EXPORT_FILTERED)).toBeVisible()

  await page.getByRole('button', SELECT_MODE).click()
  await tickRow(page, dates[1])
  await expect(page.getByRole('button', EXPORT_FILTERED)).toHaveCount(0)

  const downloadStarted = page.waitForEvent('download')
  await page.getByRole('button', EXPORT_SELECTED).click()

  expect(await readExportRows((await (await downloadStarted).path())!)).toEqual([expect.stringMatching(/,-20\.00,CAD,Row 1$/)])
})

// Unticking the last row turns the word back to what the list is showing
test('goes back to the list wording when the last tick is removed', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)

  await page.getByRole('button', SELECT_MODE).click()
  await tickRow(page, daysFromTodayInTestTimezone(0))
  await expect(page.getByRole('button', EXPORT_SELECTED)).toBeVisible()
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${daysFromTodayInTestTimezone(0)}$`) }).uncheck()

  await expect(page.getByRole('button', EXPORT_ALL)).toBeVisible()
})

// A failed export says so in a toast and saves nothing, and the button is usable again for a retry
test('shows a toast when the export fails and lets the person try again', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  await search(page, 'Coffee')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(1)
  const downloads = countDownloads(page)

  await page.route('**/transactions/export*', (route) => route.fulfill({ status: 500, body: 'boom' }))
  const button = page.getByRole('button', EXPORT_FILTERED)
  await button.click()

  await expect(page.getByText(FAILURE_TOAST, { exact: true })).toBeVisible()
  expect(downloads.count).toBe(0)
  await expect(button).toBeEnabled()

  await page.unroute('**/transactions/export*')
  const downloadStarted = page.waitForEvent('download')
  await button.click()
  expect(await readExportRows((await (await downloadStarted).path())!)).toHaveLength(1)
})

// The same toast covers a selected export, which is sent another way
test('shows a toast when a selected export fails', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const downloads = countDownloads(page)

  await page.route('**/transactions/export', (route) => route.fulfill({ status: 500, body: 'boom' }))
  await page.getByRole('button', SELECT_MODE).click()
  await tickRow(page, daysFromTodayInTestTimezone(0))
  await page.getByRole('button', EXPORT_SELECTED).click()

  await expect(page.getByText(FAILURE_TOAST, { exact: true })).toBeVisible()
  expect(downloads.count).toBe(0)
})

// A person with no transactions at all has nothing to export, so the button stays on the toolbar, held
// off with why
test('holds Export all off with its reason while there are no transactions', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const exportAction = page.getByRole('button', EXPORT_ALL)
  await expect(page.getByText('No transactions yet.', { exact: true })).toBeVisible()
  await expect(exportAction).toHaveAccessibleDescription('There are no transactions to export')

  // Playwright treats a button held off with aria-disabled as one it cannot click, and a real user can
  const downloads = countDownloads(page)
  await exportAction.click({ force: true })
  await exportAction.press('Enter')

  // A dialogue or download follows a press that runs, so one still absent once a later search has been
  // answered is a press that did nothing
  await searchAndWaitForAnswer(page, 'fence')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(downloads.count).toBe(0)
})

// A search that keeps nothing leaves nothing to save, so the button is held off with its own reason
// rather than saving a file of one header row
test('holds Export filtered off with its reason while the search keeps nothing', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const downloads = countDownloads(page)

  await search(page, 'nothing-matches-this')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(0)

  const exportAction = page.getByRole('button', EXPORT_FILTERED)
  await expect(exportAction).toHaveAccessibleDescription('No transactions match the search or filters')
  await exportAction.click({ force: true })
  await exportAction.press('Enter')

  // Widening the search is the later request that fences the presses, and it brings the button back
  await searchAndWaitForAnswer(page, 'Coffee')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(downloads.count).toBe(0)
  await expect(page.getByRole('button', EXPORT_FILTERED)).not.toHaveAccessibleDescription('No transactions match the search or filters')
})

// The export word changes with the list, and the button is only as wide as its current word needs, with
// nothing in the toolbar overlapping or reaching past the viewport. Both tests set every width they check
// themselves, so they run on the desktop project alone
const TOOLBAR_WIDTHS = [768, 800, 900, 1000, 1049, 1050, 1100, 1150, 1200, 1250, 1280]

/** The toolbar's controls and the export button's fit to its word, read once the row stops moving */
async function readToolbar(page: Page) {
  const read = () =>
    page.evaluate(() => {
      const named = (pattern: RegExp) =>
        [...document.querySelectorAll('button')].find(
          (node) => pattern.test(node.getAttribute('aria-label') ?? node.textContent?.trim() ?? '') && node.getBoundingClientRect().width > 0,
        )
      const search = document.querySelector('input[placeholder="Search transactions..."]')!
      const top = search.getBoundingClientRect().y
      const box = (node: Element | undefined) => {
        const { x, y, width } = node!.getBoundingClientRect()
        return { x: Math.round(x * 10) / 10, y: Math.round(y - top), width: Math.round(width * 10) / 10 }
      }

      // The toolbar's own controls and the filter pill that wraps its button. The pill is measured whole,
      // since its chevron sits at the far end. A closed panel's footer buttons are clipped inside it
      const toolbarControls = [...document.querySelectorAll('button, input, .app-range-glass')].filter(
        (node) => !node.closest('.app-range-glass') || node.matches('.app-range-glass'),
      )
      const spilling = toolbarControls
        .map((node) => ({ name: node.getAttribute('aria-label') ?? (node.matches('.app-range-glass') ? 'Filters pill' : node.textContent?.trim() ?? ''), ...node.getBoundingClientRect().toJSON() }))
        .filter((item) => item.width > 0 && (item.right > window.innerWidth + 0.5 || item.x < -0.5))
        .map((item) => `${item.name} ${Math.round(item.x)}-${Math.round(item.right)}`)

      // Every control of the toolbar against every other: two that share more than a pixel of area overlap
      const row = [
        search,
        named(/^(Select|Stop selecting) transactions$/),
        named(/^Edit the selected transactions$/),
        named(/^Delete the selected transactions$/),
        named(/^Import transactions/),
        named(/^Export /),
        document.querySelector('.app-range-glass'),
        named(/^Add transaction$/),
      ].filter((node): node is Element => !!node && node.getBoundingClientRect().width > 0)
      const label = (node: Element) => {
        const { x, y, right, bottom } = node.getBoundingClientRect()
        const name = node.getAttribute('aria-label') ?? (node.matches('.app-range-glass') ? 'Filters pill' : node.getAttribute('placeholder') ?? node.textContent?.trim() ?? '')
        return `${name} (${Math.round(x)},${Math.round(y)} to ${Math.round(right)},${Math.round(bottom)})`
      }
      const overlapping: string[] = []
      for (const [index, first] of row.entries()) {
        for (const second of row.slice(index + 1)) {
          const a = first.getBoundingClientRect()
          const b = second.getBoundingClientRect()
          const shared = Math.min(a.right, b.right) - Math.max(a.left, b.left)
          const sharedHeight = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
          if (shared > 1 && sharedHeight > 1) overlapping.push(`${label(first)} with ${label(second)}`)
        }
      }

      // The button's width against what its word needs: the word's own text width, the icon, the gap
      // between them, the padding and the border. Taken from the layer on show, not one fading out
      const exportNode = named(/^Export /)!
      const layer = exportNode.querySelector(':scope > div:not([aria-hidden="true"])')!
      const word = layer.querySelector('span')!
      const range = document.createRange()
      range.selectNodeContents(word)
      const style = getComputedStyle(exportNode)
      const needed =
        range.getBoundingClientRect().width +
        layer.querySelector('svg')!.getBoundingClientRect().width +
        (parseFloat(getComputedStyle(layer).columnGap) || 0) +
        parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
        parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth)
      return {
        search: box(search),
        filters: box(named(/^(Transaction filters|Filters)/)),
        add: box(named(/^Add transaction$/)),
        exportButton: box(exportNode),
        exportNeeds: Math.round(needed * 10) / 10,
        // Which row each control sits on, and how wide Add transaction is, which is what a row change moves
        rows: Object.fromEntries(
          row.map((node) => [
            (node.getAttribute('aria-label') ?? (node.matches('.app-range-glass') ? 'Filters' : node.getAttribute('placeholder') ?? node.textContent?.trim() ?? '')).replace(/^Export .*/, 'Export'),
            Math.round(node.getBoundingClientRect().y - top),
          ]),
        ),
        addWidth: Math.round(named(/^Add transaction$/)!.getBoundingClientRect().width),
        overlapping,
        spilling,
        scrollWidth: document.documentElement.scrollWidth,
      }
    })
  let previous = ''
  let settled = await read()
  await expect
    .poll(async () => {
      settled = await read()
      const serial = JSON.stringify(settled)
      const same = serial === previous
      previous = serial
      return same
    })
    .toBe(true)
  return settled
}

/**
 * Shows each word the button can have in turn and reads the toolbar for each: Export all, then
 * Export filtered once a search narrows the list, then Export selected once a row is ticked, which needs
 * select mode and so adds Edit and Delete to the row
 */
async function readEveryWord(page: Page, selecting: boolean) {
  const readings: Record<string, Awaited<ReturnType<typeof readToolbar>>> = {}
  if (selecting) await page.getByRole('button', SELECT_MODE).click()
  await expect(page.getByRole('button', EXPORT_ALL)).toBeVisible()
  readings.all = await readToolbar(page)

  await search(page, 'Coffee')
  await expect(page.getByRole('button', EXPORT_FILTERED)).toBeVisible()
  readings.filtered = await readToolbar(page)

  if (selecting) {
    await tickRow(page, daysFromTodayInTestTimezone(0))
    await expect(page.getByRole('button', EXPORT_SELECTED)).toBeVisible()
    readings.selected = await readToolbar(page)
  }
  return readings
}

// The button is as wide as its word needs and no wider, so Export all is narrower than the other two, and
// no control of the toolbar overlaps another, browsing and selecting, at every width the layout changes across
test('fits the export button to its word with nothing overlapping from 768 to 1280', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)

  for (const width of TOOLBAR_WIDTHS) {
    for (const selecting of [false, true]) {
      await page.setViewportSize({ width, height: 800 })
      await openPage(page, '/transactions')
      await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
      const readings = await readEveryWord(page, selecting)
      for (const [word, reading] of Object.entries(readings)) {
        const where = `at ${width}px ${selecting ? 'selecting' : 'browsing'} with ${word}`
        expect(Math.abs(reading.exportButton.width - reading.exportNeeds), `Export width ${where}`).toBeLessThanOrEqual(1)
        expect(reading.overlapping, `Overlapping controls ${where}`).toEqual([])
      }
      expect(readings.all.exportButton.width, `Export all against Export filtered at ${width}px`).toBeLessThan(readings.filtered.exportButton.width)
    }
  }
})

// No control reaches past the viewport and the page never scrolls sideways, browsing or selecting, with
// each word, at every width from the tablet to the widest desktop
test('keeps every toolbar control inside the viewport from 768 to 1280', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)

  for (const width of TOOLBAR_WIDTHS) {
    for (const selecting of [false, true]) {
      await page.setViewportSize({ width, height: 800 })
      await openPage(page, '/transactions')
      await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
      for (const [word, reading] of Object.entries(await readEveryWord(page, selecting))) {
        const where = `at ${width}px ${selecting ? 'selecting' : 'browsing'} with ${word}`
        expect(reading.spilling, `Controls past the viewport ${where}`).toEqual([])
        expect(reading.scrollWidth, `Page width ${where}`).toBeLessThanOrEqual(width)
      }
    }
  }
})

// On a phone the word is hidden, so the button looks the same whichever scope it has. Ticking a row must not
// replay the icon's crossfade, which would dim it for nothing: the icon stays the same node, with no second layer
test('keeps the phone export icon still when a row is ticked', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 390, height: 844 })
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  await page.getByRole('button', SELECT_MODE).click()

  const exportButton = page.getByRole('button', { name: /^Export / }).filter({ visible: true }).first()
  await expect(exportButton).toHaveAccessibleName('Export all')
  await exportButton.evaluate((button) => {
    ;(button.querySelector('svg') as unknown as { marked: boolean }).marked = true
  })
  await tickRow(page, daysFromTodayInTestTimezone(0))
  await expect(exportButton).toHaveAccessibleName('Export selected')
  // Once every animation in the button has ended, a replay would have finished replacing the node
  await expect.poll(() => exportButton.evaluate((button) => button.getAnimations({ subtree: true }).length)).toBe(0)
  const state = await exportButton.evaluate((button) => ({
    kept: (button.querySelector('svg') as unknown as { marked?: boolean }).marked === true,
    layers: button.querySelectorAll(':scope > div').length,
  }))
  expect(state).toEqual({ kept: true, layers: 1 })
})

// Which row each control sits on, and the width of Add transaction, is the same for every word the button
// can have. Deciding the rows from the word on show moved Add transaction between beside the controls and a
// row of its own, and Edit and Delete between one row with the rest and a row above it, when the word changed
test('keeps every toolbar control on the same row whichever export word shows', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)

  for (const width of [900, 1050, 1150, 1250]) {
    for (const selecting of [false, true]) {
      await page.setViewportSize({ width, height: 800 })
      await openPage(page, '/transactions')
      await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
      const readings = Object.entries(await readEveryWord(page, selecting))
      const [, first] = readings[0]
      for (const [word, reading] of readings) {
        const where = `at ${width}px ${selecting ? 'selecting' : 'browsing'} with ${word}`
        expect(reading.rows, `Rows ${where}`).toEqual(first.rows)
        expect(reading.addWidth, `Add transaction width ${where}`).toBe(first.addWidth)
      }
    }
  }
})

/**
 * Pauses every animation on the first frame of the width ease that `trigger` starts, then reads the page at
 * each of the given times into it. The export button's layers are read at each: their opacity, and how far
 * their icon and word reach past the button's own ends and past the layer's own box
 */
async function scrubExportEase(page: Page, trigger: () => Promise<void>, times: number[]) {
  await page.evaluate(() => {
    const frozen = new Promise<void>((resolve) => {
      const tick = () => {
        if (document.getAnimations().some((animation) => animation.id === 'eased-width')) {
          for (const animation of document.getAnimations()) animation.pause()
          resolve()
        } else requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    ;(window as unknown as { frozen: Promise<void> }).frozen = frozen
  })
  await trigger()
  await page.evaluate(() => (window as unknown as { frozen: Promise<void> }).frozen)
  const frames = []
  for (const time of times) {
    frames.push({
      time,
      ...(await page.evaluate((t) => {
        for (const animation of document.getAnimations()) {
          if (Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.currentTime = t
        }
        const button = [...document.querySelectorAll('button')].find(
          (node) => /^Export /.test(node.getAttribute('aria-label') ?? '') && node.getBoundingClientRect().width > 0,
        )!
        const edges = button.getBoundingClientRect()
        const layers = [...button.querySelectorAll(':scope > div')].map((layer) => {
          const box = layer.getBoundingClientRect()
          const parts = [layer.querySelector('svg')!, layer.querySelector('span')!].map((part) => {
            const range = document.createRange()
            range.selectNodeContents(part)
            return part.tagName === 'svg' ? part.getBoundingClientRect() : range.getBoundingClientRect()
          })
          const left = Math.min(...parts.map((part) => part.left))
          const right = Math.max(...parts.map((part) => part.right))
          const icon = layer.querySelector('svg')!
          // What the eye gets of the icon: its own and its layer's opacity multiplied, and nothing when hidden
          const iconStyle = getComputedStyle(icon)
          return {
            outgoing: layer.getAttribute('aria-hidden') === 'true',
            // What the eye gets of the word: its own opacity and its layer's multiplied
            opacity: Number(getComputedStyle(layer.querySelector('span')!).opacity) * Number(getComputedStyle(layer).opacity),
            iconOpacity: iconStyle.visibility === 'hidden' ? 0 : Number(iconStyle.opacity) * Number(getComputedStyle(layer).opacity),
            iconLeft: icon.getBoundingClientRect().left,
            pastButton: Math.max(edges.left - left, right - edges.right),
            pastLayer: Math.max(box.left - left, right - box.right),
          }
        })
        return { width: edges.width, layers }
      }, time)),
    })
  }
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      try {
        animation.finish()
      } catch {
        animation.play()
      }
    }
  })
  return frames
}

// While the word changes, neither the old word nor the new one, nor the icon in front of it, is cut by the
// button's ends or by the layer holding it, at any frame in which it can be seen. Both fade partway rather
// than at once, in both directions
test('never cuts the export word or its icon while the word changes', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const times = [0, 5, 10, 15, 20, 30, 40, 50, 60, 80, 100, 150, 200, 250, 300]

  for (const [text, expected] of [
    ['Coffee', 'Export filtered'],
    ['', 'Export all'],
  ] as const) {
    const frames = await scrubExportEase(page, () => search(page, text), times)
    await expect(page.getByRole('button', { name: expected, exact: true })).toBeVisible()
    for (const { time, layers } of frames) {
      for (const layer of layers.filter((item) => item.opacity > 0.01)) {
        const where = `${layer.outgoing ? 'outgoing' : 'incoming'} layer at ${time}ms going to ${expected}`
        expect(layer.pastLayer, `Content cut by its layer, ${where}`).toBeLessThanOrEqual(0.5)
        expect(layer.pastButton, `Content past the button's ends, ${where}`).toBeLessThanOrEqual(-3)
      }
    }
    const opacities = frames.flatMap(({ layers }) => layers.map((layer) => layer.opacity))
    expect(opacities.some((opacity) => opacity > 0.1 && opacity < 0.9), 'A fade caught partway').toBe(true)
  }
})

// The two words never overlap, which read as garbled text when both sat at half strength, and the icon stays
// whole and in one place throughout. The old word is gone before the new one shows, in both directions
test('fades the export words one after the other with the icon whole throughout', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const times = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 70, 80, 100, 150, 200, 300]
  const SMALL_OPACITY = 0.02

  for (const [text, expected] of [
    ['Coffee', 'Export filtered'],
    ['', 'Export all'],
  ] as const) {
    const frames = await scrubExportEase(page, () => search(page, text), times)
    await expect(page.getByRole('button', { name: expected, exact: true })).toBeVisible()
    const restingIconLeft = frames[0].layers.find((layer) => !layer.outgoing)!.iconLeft
    let sawOutgoing = false
    let sawIncoming = false
    for (const { time, layers } of frames) {
      const where = `at ${time}ms going to ${expected}`
      const shown = layers.filter((layer) => layer.opacity > SMALL_OPACITY)
      expect(shown.length, `Two words showing ${where}: ${shown.map((layer) => layer.opacity.toFixed(2)).join(' and ')}`).toBeLessThanOrEqual(1)
      sawOutgoing ||= shown.some((layer) => layer.outgoing)
      sawIncoming ||= shown.some((layer) => !layer.outgoing && layer.opacity > 0.5)
      expect(layers.find((layer) => !layer.outgoing)!.iconOpacity, `Icon not whole ${where}`).toBe(1)
      for (const layer of layers.filter((item) => item.iconOpacity > 0)) {
        expect(Math.abs(layer.iconLeft - restingIconLeft), `Icon moved ${where}`).toBeLessThanOrEqual(0.5)
      }
    }
    expect(sawOutgoing, 'The old word is seen fading').toBe(true)
    expect(sawIncoming, 'The new word is seen').toBe(true)
  }
})

// A row ticked and unticked before the word has finished changing leaves the button as it began, with its
// word showing and its icon drawn, rather than blank until the next change
test('restores the export word and icon when a tick is removed within the fade', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  await page.getByRole('button', SELECT_MODE).click()
  const button = page.getByRole('button', EXPORT_ALL)
  await expect(button.getByText('Export all', { exact: true })).toHaveCSS('opacity', '1')

  // Both clicks run inside the page, 100ms apart, which is well inside the 300ms the words take to change
  await page.getByRole('checkbox', { name: new RegExp(`^Select .+ on ${daysFromTodayInTestTimezone(0)}$`) }).evaluate(async (box: HTMLElement) => {
    box.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    box.click()
  })

  await expect(button).toBeVisible()
  await expect(button.getByText('Export all', { exact: true })).toHaveCSS('opacity', '1')
  // The word that left is gone once its fade ends, which leaves the one icon to be drawn
  await expect(button.locator('svg')).toHaveCount(1)
  await expect(button.locator('svg')).toBeVisible()
})

// Pressed is the hover look with the button pushed in by a pixel, which is what the Import button beside it
// does. The export button's own transition list must not drop it
test('presses the export button in exactly as the Import button beside it is', async ({ page, request }) => {
  const user = await seedTwoTransactions(request)
  await logInViaApi(page, user)
  await page.setViewportSize({ width: 1280, height: 800 })
  await openPage(page, '/transactions')
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)

  // A hovered glass button takes the text colour, read from the token rather than copied from its value
  const hoverColor = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--app-text)'
    document.body.append(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })

  const looks = []
  for (const name of [/^Import transactions/, /^Export all$/]) {
    const button = page.getByRole('button', { name }).filter({ visible: true }).first()
    const read = () =>
      button.evaluate((node) => {
        const style = getComputedStyle(node)
        return { background: style.backgroundColor, color: style.color, border: style.borderTopColor, transform: style.transform }
      })
    const settled = () => expect.poll(() => button.evaluate((node) => node.getAnimations().length)).toBe(0)
    await button.hover()
    await expect.poll(async () => (await read()).color).toBe(hoverColor)
    await settled()
    const hover = await read()
    await page.mouse.down()
    await expect.poll(async () => (await read()).transform).toBe('matrix(1, 0, 0, 1, 0, 1)')
    await settled()
    const pressed = await read()
    // Released off the button, so the press is not a click that leaves the page or opens a dialogue
    await page.mouse.move(2, 2)
    await page.mouse.up()
    looks.push({ hover, pressed })
  }
  const [importLook, exportLook] = looks
  expect(exportLook.pressed).toEqual(importLook.pressed)
  expect(exportLook.hover).toEqual(importLook.hover)
  expect(exportLook.pressed.transform).not.toBe(exportLook.hover.transform)
})
