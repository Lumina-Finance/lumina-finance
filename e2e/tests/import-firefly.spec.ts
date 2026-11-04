import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { commitImport, logInViaApi } from '../support/app'
import { stageFireflyExport } from '../support/firefly'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: what the import writes is the same at every size

test('imports a Firefly III export with only the budgets left ticked', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await stageFireflyExport(page)

  // Category matching explains how the import files transfers once the transactions are staged
  await expect(page.getByText('Transfers and debt payments', { exact: true })).toBeVisible()

  const budgets = page.getByRole('table').filter({ has: page.getByRole('checkbox', { name: 'Import Food' }) })
  await expect(budgets.getByRole('columnheader')).toHaveText([/.*/, 'Budget', 'Cadence', 'Latest amount', 'Categories', 'First period', 'Changes'])

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
  const response = await commitImport(page)
  expect(response.status()).toBe(201)
  expect((await opened).postDataJSON()).toMatchObject({ file_name: 'transactions.csv' })

  const result = await response.json() as { budgets: { name: string }[] }
  expect(result.budgets.map((budget) => budget.name).sort()).toEqual(ticked.sort())
  expect(ticked).not.toContain('Travel')
})

test('a committed Firefly III import asks no account question while the account list reloads', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await stageFireflyExport(page)

  // The commit makes the page read the accounts again. Holding that answer keeps the list reloading for
  // as long as the test looks, where a fast server would show it for only a moment
  let isHolding = false
  let release!: () => void
  const released = new Promise<void>((resolve) => { release = resolve })
  await page.route(`${API_BASE_URL}/accounts`, async (route) => {
    if (isHolding && route.request().method() === 'GET') await released
    await route.continue()
  })

  // Every account is new and answered by default, so nothing is asked before the commit either
  const question = page.getByText(/^Choose an account for/)
  await expect(page.getByRole('button', { name: 'Commit import', exact: true })).toBeEnabled()
  await expect(question).toHaveCount(0)

  isHolding = true
  const response = await commitImport(page)
  expect(response.status()).toBe(201)

  // The finished button is the fence: the question, if it was coming, comes with the finished state
  await expect(page.getByRole('button', { name: 'Imported', exact: true })).toBeDisabled()
  await expect(question).toHaveCount(0)
  await expect(page.getByText('No preview rows', { exact: true })).toHaveCount(0)
  release()
})
