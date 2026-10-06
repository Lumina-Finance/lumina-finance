import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'

// Copies of the export the frontend's unit tests read, written by a local Firefly III server from
// the weekly check's seed. The suite runs from its own directory alone, so it holds the copies
// rather than reaching into the frontend's
const EXPORT_FILES = ['transactions.csv', 'budgets.csv', 'accounts.csv']
  .map((name) => fileURLToPath(new URL(`../fixtures/firefly-export/${name}`, import.meta.url)))

test('imports a Firefly III export with only the budgets left ticked', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data Source', /^Firefly III/)

  // The screen reads one file at a time and refuses another meanwhile, so each lands before the next
  const uploads = page.locator('input[type="file"][accept=".csv,text/csv"]')
  for (const [index, file] of EXPORT_FILES.entries()) {
    await expect(uploads.nth(index)).toBeEnabled()
    await uploads.nth(index).setInputFiles(file)
    await expect(page.getByText(file.split('/').at(-1)!, { exact: true })).toBeVisible()
  }

  // Category Matching explains how the import files transfers once the transactions are staged
  await expect(page.getByText('Transfers and debt payments', { exact: true })).toBeVisible()

  const budgets = page.getByRole('table').filter({ has: page.getByRole('checkbox', { name: 'Import Food' }) })
  await expect(budgets.getByRole('columnheader')).toHaveText([/.*/, 'Budget', 'Cadence', 'Latest Amount', 'Categories', 'First Period', 'Changes'])

  // The header box clears every budget and then brings them all back
  const rows = budgets.getByRole('checkbox', { name: /^Import / })
  await budgets.getByRole('checkbox', { name: 'Deselect all budgets' }).click()
  for (const box of await rows.all()) await expect(box).not.toBeChecked()
  await budgets.getByRole('checkbox', { name: 'Select all budgets' }).click()
  for (const box of await rows.all()) await expect(box).toBeChecked()

  // A budget left out stays in the list, crossed off and tagged
  await budgets.getByRole('checkbox', { name: 'Import Travel' }).click()
  await expect(budgets.getByRole('checkbox', { name: 'Import Travel' })).not.toBeChecked()
  await expect(budgets.getByRole('checkbox', { name: 'Import Food' })).toBeChecked()
  await expect(budgets.getByText('Not imported', { exact: true })).toHaveCount(1)
  const rowOf = (name: string) => budgets.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Import ${name}` }) })
  await expect(rowOf('Travel').getByText('Travel', { exact: true }).first()).toHaveCSS('text-decoration-line', 'line-through')
  const shading = (name: string) => rowOf(name).evaluate((row) => getComputedStyle(row).backgroundColor)
  expect(await shading('Travel')).not.toBe(await shading('Food'))

  // Every budget still ticked is created, not just the first
  const ticked: string[] = []
  for (const box of await rows.all()) {
    if (await box.isChecked()) ticked.push((await box.getAttribute('aria-label') ?? '').replace(/^Import /, ''))
  }
  expect(ticked.length).toBeGreaterThan(1)

  // The run is named for the export's transactions file, which is how the last import shows it
  const opened = page.waitForRequest((sent) => sent.method() === 'POST' && /\/transactions\/import\/runs$/.test(sent.url()))
  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/journal\/commit$/.test(response.url()))
  await commit.click()
  const response = await committed
  expect(response.status()).toBe(201)
  expect((await opened).postDataJSON()).toMatchObject({ file_name: 'transactions.csv' })

  const result = await response.json() as { budgets: { name: string }[] }
  expect(result.budgets.map((budget) => budget.name).sort()).toEqual(ticked.sort())
  expect(ticked).not.toContain('Travel')
})
