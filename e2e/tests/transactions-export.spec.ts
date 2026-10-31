import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

import { createAccount, createTransaction, daysFromTodayInTestTimezone, signUpUser, todayInTestTimezone } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { AT_EVERY_SIZE } from '../support/sizes'

// Runs on desktop and at every size where the dialogue's buttons and confirmation are reached by tap.
// The tests that pick filters in the panel run on desktop only, since a phone reaches the same panel
// through its full-screen sheet

const EXPORT_BUTTON = { name: 'Export transactions as CSV', exact: true } as const

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

// With no date filter on the page the list shows every date, and the dialogue starts on every date too,
// with no date counted as a filter. Export asks first, and Cancel, Back and the first press download nothing
test('asks before downloading and saves every date when the page has no date filter', AT_EVERY_SIZE, async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250, date: daysFromTodayInTestTimezone(0), notes: 'Coffee today' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -90000, date: daysFromTodayInTestTimezone(-400), notes: 'Old rent' })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  // A phone's rows leave their notes out, so the rows are counted
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
  const downloads = countDownloads(page)

  await page.getByRole('button', EXPORT_BUTTON).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: 'Export transactions', exact: true })).toBeVisible()
  await expect(dialog.getByText("You'll get transactions from every date.", { exact: true })).toBeVisible()
  // No page filter means no count on the phone's Filters button, which a prefilled range used to raise to 1
  await expect(dialog.getByRole('button', { name: /^Filters, \d+ active$/ })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()

  // The confirmation says in words what the file holds, and the press that reached it saved nothing
  await expect(dialog.getByRole('heading', { name: 'Download this file?', exact: true })).toBeVisible()
  await expect(
    dialog.getByText('The file will hold all your transactions, whatever their date. No search or filters are applied.', { exact: true }),
  ).toBeVisible()
  expect(downloads.count).toBe(0)

  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(dialog).toBeHidden()
  expect(downloads.count).toBe(0)

  // Escape leaves things as they were too
  await page.getByRole('button', EXPORT_BUTTON).click()
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  expect(downloads.count).toBe(0)

  await page.getByRole('button', EXPORT_BUTTON).click()
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download CSV', exact: true }).click()
  const download = await downloadStarted

  expect(download.suggestedFilename()).toBe(`lumina-finance-transactions-${todayInTestTimezone()}.csv`)
  const rows = await readExportRows((await download.path())!)
  expect(rows).toEqual([
    expect.stringMatching(/^\d{4}-\d{2}-\d{2},.+,Groceries,Everyday,,-42\.50,CAD,Coffee today$/),
    expect.stringMatching(/^\d{4}-\d{2}-\d{2},.+,Groceries,Everyday,,-900\.00,CAD,Old rent$/),
  ])
  await expect(dialog).toBeHidden()

  // The list behind the dialogue never changed
  await expect(page.getByTestId(/^transaction-row-/)).toHaveCount(2)
})

// A date filter set on the page carries into the dialogue and the file, and the dialogue's own dates can
// be chosen from there without touching the list
test('carries a page date filter over and lets the dialogue choose its own dates', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250, date: daysFromTodayInTestTimezone(0), notes: 'Coffee today' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -90000, date: daysFromTodayInTestTimezone(-400), notes: 'Old rent' })

  await logInViaApi(page, user)
  await openPage(page, `/transactions?from_date=${daysFromTodayInTestTimezone(-30)}&to_date=${daysFromTodayInTestTimezone(0)}`)
  await expect(page.getByText('Coffee today', { exact: true })).toBeVisible()
  await expect(page.getByText('Old rent', { exact: true })).toHaveCount(0)
  const downloads = countDownloads(page)

  await page.getByRole('button', EXPORT_BUTTON).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText(/^You'll get transactions dated /)).toBeVisible()
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await expect(dialog.getByText(/^The file will hold all your transactions dated /)).toBeVisible()
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()

  // Clearing the dates in the dialogue widens the file to every date, and the list stays as it was
  await dialog.getByRole('button', { name: 'Transaction filters', exact: true }).click()
  await dialog.getByRole('tab', { name: /^Date/ }).click()
  for (const label of ['From', 'To']) {
    const date = dialog.getByRole('group', { name: label, exact: true })
    for (const part of ['Year', 'Month', 'Day']) await date.getByRole('textbox', { name: part, exact: true }).fill('')
  }
  await dialog.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await expect(dialog.getByText("You'll get transactions from every date.", { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()

  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download CSV', exact: true }).click()
  expect(await readExportRows((await (await downloadStarted).path())!)).toHaveLength(2)
  expect(downloads.count).toBe(1)
  await expect(page.getByText('Old rent', { exact: true })).toHaveCount(0)
})

// The dialogue starts from the page's search, takes its own search and filters without touching the
// list, names every choice in words, and Back returns to the choices as they were
test('describes a search and a filter in words, keeps them on Back and saves only what they match', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250, date: daysFromTodayInTestTimezone(0), notes: 'Coffee today' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Dining', amount: -1800, date: daysFromTodayInTestTimezone(0), notes: 'Coffee beans' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -700, date: daysFromTodayInTestTimezone(0), notes: 'Bread' })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  await expect(page.getByText('Bread', { exact: true })).toBeVisible()
  const downloads = countDownloads(page)

  // Clicking the page outside the dialogue leaves things as they were
  await page.getByRole('button', EXPORT_BUTTON).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await page.mouse.click(4, 4)
  await expect(dialog).toBeHidden()
  expect(downloads.count).toBe(0)

  await page.getByRole('button', EXPORT_BUTTON).click()
  await dialog.getByPlaceholder('Search transactions...', { exact: true }).fill('Coffee')
  await dialog.getByRole('button', { name: 'Transaction filters', exact: true }).click()
  await dialog.getByRole('tab', { name: 'Category', exact: true }).click()
  await dialog.getByRole('checkbox', { name: 'Groceries', exact: true }).click()
  await dialog.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()

  await expect(dialog.getByText(/^The file will hold your transactions that match everything below, whatever their date\.$/)).toBeVisible()
  await expect(dialog.getByText('Merchant or notes containing', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Coffee', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Category', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Groceries', { exact: true })).toBeVisible()

  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(dialog.getByPlaceholder('Search transactions...', { exact: true })).toHaveValue('Coffee')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  expect(downloads.count).toBe(0)

  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download CSV', exact: true }).click()
  const rows = await readExportRows((await (await downloadStarted).path())!)
  expect(rows).toEqual([expect.stringMatching(/,Groceries,Everyday,,-42\.50,CAD,Coffee today$/)])

  // Nothing chosen in the dialogue reached the list behind it
  await expect(page.getByPlaceholder('Search transactions...', { exact: true })).toHaveValue('')
  await expect(page.getByText('Bread', { exact: true })).toBeVisible()
  await expect(page.getByText('Coffee beans', { exact: true })).toBeVisible()
})

// Conditions that match nothing are refused at the confirmation, in words, with no file saved. The
// page's own search emptying the list leaves Export on, since the dialogue can widen the search
test('says nothing matches instead of saving an empty file, and starts from the page search', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await createTransaction(request, user, { accountId: account.id, categoryName: 'Groceries', amount: -4250, date: daysFromTodayInTestTimezone(0), notes: 'Coffee today' })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const search = page.getByPlaceholder('Search transactions...', { exact: true })
  await search.fill('nothing-matches-this')
  await search.press('Enter')
  await expect(page.getByText('Coffee today', { exact: true })).toHaveCount(0)
  const downloads = countDownloads(page)

  await expect(page.getByRole('button', EXPORT_BUTTON)).not.toHaveAccessibleDescription('There are no transactions to export')
  await page.getByRole('button', EXPORT_BUTTON).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByPlaceholder('Search transactions...', { exact: true })).toHaveValue('nothing-matches-this')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  await dialog.getByRole('button', { name: 'Download CSV', exact: true }).click()

  await expect(dialog.getByText('Nothing was downloaded: no transactions match these choices. Go back to change them.')).toBeVisible()
  expect(downloads.count).toBe(0)

  // Widening the search from the same dialogue saves the row
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await dialog.getByPlaceholder('Search transactions...', { exact: true }).fill('Coffee')
  await dialog.getByRole('button', { name: 'Download', exact: true }).click()
  const downloadStarted = page.waitForEvent('download')
  await dialog.getByRole('button', { name: 'Download CSV', exact: true }).click()
  expect(await readExportRows((await (await downloadStarted).path())!)).toHaveLength(1)
})

// A person with no transactions at all has nothing to export, so the button stays on the toolbar, held
// off with why
test('holds Export off with its reason while there are no transactions', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })

  await logInViaApi(page, user)
  await openPage(page, '/transactions')

  const exportAction = page.getByRole('button', EXPORT_BUTTON)
  await expect(page.getByText('No transactions yet.', { exact: true })).toBeVisible()
  await expect(exportAction).toHaveAccessibleDescription('There are no transactions to export')

  // Playwright treats a button held off with aria-disabled as one it cannot click, and a real user can
  await exportAction.click({ force: true })
  await exportAction.press('Enter')

  // A dialogue opens within moments of a press that runs, so one still absent after the later press is a
  // press that did nothing
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
