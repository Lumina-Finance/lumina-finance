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
  await exportAction.click({ force: true })
  await exportAction.press('Enter')

  // A dialogue opens within moments of a press that runs, so one still absent after the later press is a
  // press that did nothing
  await expect(page.getByRole('dialog')).toHaveCount(0)
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
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(downloads.count).toBe(0)

  // Widening the search brings the button back
  await search(page, 'Coffee')
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
