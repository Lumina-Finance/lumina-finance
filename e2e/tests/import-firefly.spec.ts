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

  const budgets = page.getByRole('table').filter({ has: page.getByRole('checkbox', { name: 'Import Food' }) })
  await expect(budgets.getByRole('columnheader')).toHaveText([/.*/, 'Budget', 'Cadence', 'Latest Amount', 'Categories', 'First Period', 'Changes'])

  // A budget left out stays in the list, crossed off and tagged
  await budgets.getByRole('checkbox', { name: 'Import Travel' }).click()
  await expect(budgets.getByRole('checkbox', { name: 'Import Travel' })).not.toBeChecked()
  await expect(budgets.getByRole('checkbox', { name: 'Import Food' })).toBeChecked()
  await expect(budgets.getByText('Not imported', { exact: true })).toHaveCount(1)

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  const committed = page.waitForResponse((response) => response.request().method() === 'POST'
    && /\/transactions\/import\/runs\/[^/]+\/journal\/commit$/.test(response.url()))
  await commit.click()
  const response = await committed
  expect(response.status()).toBe(201)

  const result = await response.json() as { budgets: { name: string }[] }
  const created = result.budgets.map((budget) => budget.name)
  expect(created).toContain('Food')
  expect(created).not.toContain('Travel')
})
