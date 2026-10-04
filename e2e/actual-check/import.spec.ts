/**
 * Imports each seeded Actual Budget export through the real import screen as a new user, then
 * compares what Lumina holds with what Actual's own API said about the same budget and with the
 * budget figures the seed declared, which it confirmed the export holds
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

import { TEST_CURRENCY, TEST_TIMEZONE, signUpUser, todayInTestTimezone, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { checkExpected } from '../support/import-check/compare.ts'
import { readLumina } from '../support/import-check/lumina.ts'
import { API_BASE_URL } from '../support/target'
import { compareImport, compareSkippedRows, type ActualDifference, type SkippedRowCells } from './compare.ts'
import { getExpectedDifferences } from './expected-differences.ts'
import { readImportMappings, type CapturedUpload } from './lumina.ts'
import type { ActualManifest, ActualRunInfo } from './manifest.ts'

const OUTPUT_DIR = join(import.meta.dirname, 'output')

const BUDGETS = ['envelope', 'edges', 'tracking', 'yen']

// Actual records no currency for a budget whose currency feature is off, so the check answers the
// one its user signed up with
const CHOSEN_CURRENCY = TEST_CURRENCY

// What the table of rows left out shows in a blank cell
const EMPTY_CELL = '–'

let runInfo: ActualRunInfo

test.beforeAll(async () => {
  runInfo = JSON.parse(await readOutput('run.json')) as ActualRunInfo

  // The datasets date everything from the run date, and Lumina counts a row from its date in the
  // user's own timezone, so a seed from another day compares against the wrong balances and totals
  const today = todayInTestTimezone()
  if (runInfo.asOf !== today || runInfo.timezone !== TEST_TIMEZONE) {
    throw new Error(`The output is stale, re-seed: it was measured on ${runInfo.asOf} in ${runInfo.timezone}, and today is ${today} in ${TEST_TIMEZONE}`)
  }
})

test('Actual still keeps currencies the way the importer reads them', () => {
  // Either change would import a budget in such a currency with every amount 100 times off
  expect(
    runInfo.actual.zeroDecimalCurrencies,
    "Actual's currencies without decimal places, against ACTUAL_ZERO_DECIMAL_CURRENCIES in the importer",
  ).toEqual(runInfo.importer.zeroDecimalCurrencies)
  expect(runInfo.actual.currencyIsFeatureFlag, 'whether currency is still one of Actual\'s feature flags, which the importer reads').toBe(true)
})

for (const budget of BUDGETS) {
  test(`the ${budget} budget imports to the balances, totals and budgets Actual reports`, async ({ page, request }, testInfo) => {
    const manifest = await readManifest(budget)
    await importAndCompare(page, request, testInfo, manifest, await startImport(page, request, manifest))
  })
}

async function readOutput(path: string) {
  return readFile(join(OUTPUT_DIR, path), 'utf8').catch(() => {
    throw new Error(`${path} is missing from ${OUTPUT_DIR}. Run actual-check/seed.sh first`)
  })
}

async function readManifest(budget: string) {
  return JSON.parse(await readOutput(join(budget, 'manifest.json'))) as ActualManifest
}

/** A new user's import screen with an export uploaded to it */
interface StartedImport {
  user: TestUser

  /**
   * Every request of the import run with what the server answered, filled in as the run goes,
   * kept in the results beside the comparison and read for the mappings it reports
   */
  uploads: CapturedUpload[]
}

/**
 * Signs up a new user, opens the Actual import and uploads the budget's export. A refusal fails the
 * test with the screen's own words
 */
async function startImport(page: Page, request: APIRequestContext, manifest: ActualManifest): Promise<StartedImport> {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data Source', 'Actual Budget')

  const uploads: CapturedUpload[] = []
  page.on('response', async (response) => {
    const path = response.url().slice(API_BASE_URL.length)
    const method = response.request().method()
    if (!['POST', 'PUT'].includes(method) || !path.startsWith('/transactions/import/runs')) return
    uploads.push({ method, path, body: response.request().postDataJSON(), response: await response.json().catch(() => null) })
  })

  const input = page.locator('input[type="file"][accept=".zip,.sqlite,application/zip"]')
  await expect(input).toBeEnabled()
  await input.setInputFiles(join(OUTPUT_DIR, manifest.budget, 'export.zip'))

  try {
    await expect(page.getByText('export.zip', { exact: true })).toBeVisible()
  } catch {
    const card = page.getByRole('button', { name: /Upload budget export/ })
    throw new Error(`The import screen didn't stage the ${manifest.budget} export: ${await card.innerText().catch(() => 'no upload card')}`)
  }
  return { user, uploads }
}

/**
 * Answers what Actual doesn't record, commits the staged import with every other proposed answer,
 * then reads Lumina back and compares it with the manifest
 */
async function importAndCompare(
  page: Page,
  request: APIRequestContext,
  testInfo: TestInfo,
  manifest: ActualManifest,
  { user, uploads }: StartedImport,
) {
  const currency = manifest.currency ?? CHOSEN_CURRENCY
  if (!manifest.currency) {
    const selectAll = page.locator('[aria-label="Select all accounts"]')
    await expect(selectAll).toBeEnabled()
    await selectAll.click()
    await chooseFromDropdown(page.locator('body'), 'Batch Edit Accounts Currency', new RegExp(`^${CHOSEN_CURRENCY}\\b`))
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
  }

  // Budgets compare with what Actual counted against them, which takes each category's payments to
  // off-budget accounts filed in the category rather than kept as the transfers they start as
  for (const paymentMode of await page.getByRole('radiogroup', { name: /^Import .* \(transfers in Actual\) as$/ }).all()) {
    await paymentMode.getByRole('radio', { name: /^(Expense|Income)$/ }).click()
  }

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()
  const progress = page.getByRole('dialog', { name: 'Import progress' })

  // A failed or stopped import ends the wait too, and fails with what the dialog says. Only the
  // test's own timeout bounds the import, not the minute an expectation gets
  const outcome = progress.getByText(/^Import (complete|failed|stopped)$/)
  await expect(outcome).toBeVisible({ timeout: 0 })
  if (await outcome.textContent() !== 'Import complete') throw new Error(`The import did not complete: ${await progress.innerText()}`)

  // Read before Done, which leaves the import screen. Either title is absent when nothing was skipped
  const readTitle = async (pattern: RegExp) => {
    const title = page.getByText(pattern)
    return await title.count() ? await title.first().textContent() : null
  }
  const skipped = {
    rows: await readTitle(/^\d+ rows? (was|were) not imported$/),
    budgets: await readTitle(/^\d+ budgets? skipped$/),
  }
  const skippedRows = await readSkippedRows(page)
  await progress.getByRole('button', { name: 'Done', exact: true }).click()

  const lumina = await readLumina(request, user)
  const differences = [
    ...compareImport(manifest, lumina, readImportMappings(uploads), currency),
    ...compareSkippedRows(manifest, skippedRows),
  ]
  const { unexpected, stale } = checkExpected(differences, getExpectedDifferences(manifest.budget, manifest.asOf))
  await writeReport(testInfo, manifest, { outcome: 'imported', skipped, differences, unexpected, stale })
  await writeFile(testInfo.outputPath('uploads.json'), `${JSON.stringify(uploads, null, 2)}\n`)

  expect(unexpected, `differences from Actual in the ${manifest.budget} budget that are not on the expected list`).toEqual([])
  expect(stale, 'expected differences that no longer occur, which should come off the list').toEqual([])
}

/** Reads the table of rows the import left out, row by row, as the screen shows it */
async function readSkippedRows(page: Page): Promise<SkippedRowCells[]> {
  const panel = page.locator('button[aria-label="Collapse skipped rows"]').locator('..')
  if (!await panel.count()) return []
  const rows: SkippedRowCells[] = []
  for (const row of await panel.locator('tbody tr').all()) {
    const cells = (await row.locator('td').allInnerTexts()).map((text) => (text.trim() === EMPTY_CELL ? '' : text.trim()))
    const [date, reason, account, amount, payee] = cells
    rows.push({ date, reason, account, amount, payee })
  }
  return rows
}

async function writeReport(
  testInfo: TestInfo,
  manifest: ActualManifest,
  result: { outcome: string; skipped: unknown; differences: ActualDifference[]; unexpected: ActualDifference[]; stale: unknown[] },
) {
  const report = {
    budget: manifest.budget,
    actual: { version: runInfo.actualVersion, apiVersion: runInfo.apiVersion, asOf: runInfo.asOf },
    ...result,
  }
  await writeFile(testInfo.outputPath('comparison.json'), `${JSON.stringify(report, null, 2)}\n`)
}
