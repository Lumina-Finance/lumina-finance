/**
 * Imports each seeded Actual Budget export through the real import screen as a new user, then
 * compares what Lumina holds with what Actual's own API said about the same budget and with the
 * budget figures the seed found in the export's own table
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test'

import { TEST_CURRENCY, TEST_TIMEZONE, signUpUser, todayInTestTimezone, type TestUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'
import { readLumina } from '../firefly-check/lumina.ts'
import {
  checkExpected,
  compareImport,
  compareSkippedRows,
  type ActualLuminaSnapshot,
  type Difference,
  type SkippedRowCells,
} from './compare.ts'
import { getExpectedDifferences } from './expected-differences.ts'
import { readImportMappings, type CapturedUpload } from './lumina.ts'
import type { ActualManifest, ActualRunInfo } from './manifest.ts'

const OUTPUT_DIR = join(import.meta.dirname, 'output')

// The budgets whose amounts all have two decimal places, which import and compare in full whatever
// becomes of the yen budget
const TWO_DECIMAL_BUDGETS = ['envelope', 'edges', 'tracking']

// Actual records no currency for a budget whose currency feature is off, so the check answers the
// one its user signed up with
const CHOSEN_CURRENCY = TEST_CURRENCY

// The importer's version guard refusing a yen file, word for word, so it can't be mistaken for the
// refusals of amounts stored another way or of a missing column
const VERSION_GUARD_REFUSAL = 'This budget is in JPY, and it comes from a newer version of Actual than the import has been '
  + 'checked against. Amounts in currencies without decimal places could be read at the wrong size, so it '
  + "can't be imported yet."

// What the table of rows left out shows in a blank cell
const EMPTY_CELL = '–'

let runInfo: ActualRunInfo

test.beforeAll(async () => {
  runInfo = JSON.parse(await readOutput('run.json')) as ActualRunInfo

  // The datasets date everything from the run date, and the import leaves out rows after today in
  // the user's own timezone, so a seed from another day compares against the wrong rows
  const today = todayInTestTimezone()
  if (runInfo.asOf !== today || runInfo.timezone !== TEST_TIMEZONE) {
    throw new Error(`The output is stale, re-seed: it was measured on ${runInfo.asOf} in ${runInfo.timezone}, and today is ${today} in ${TEST_TIMEZONE}`)
  }
})

test("Actual still keeps currencies the way the importer's version guard relies on", () => {
  // Either change would let a newer Actual's yen file past the guard with every amount 100 times off
  expect(
    runInfo.actual.zeroDecimalCurrencies,
    "Actual's currencies without decimal places, against ACTUAL_ZERO_DECIMAL_CURRENCIES in the importer",
  ).toEqual(runInfo.importer.zeroDecimalCurrencies)
  expect(runInfo.actual.currencyIsFeatureFlag, 'whether currency is still one of Actual\'s feature flags, which the importer reads').toBe(true)
})

for (const budget of TWO_DECIMAL_BUDGETS) {
  test(`the ${budget} budget imports to the balances, totals and budgets Actual reports`, async ({ page, request }, testInfo) => {
    const manifest = await readManifest(budget)
    const started = await startImport(page, request, manifest)
    if (started.isRefused) throw new Error(`The version guard refused the ${budget} budget, which is not in a currency without decimal places`)
    await importAndCompare(page, request, testInfo, manifest, started)
  })
}

/*
 * Rechecking a newer Actual release for yen
 *
 * The importer refuses a budget in a currency without decimal places from an Actual release newer
 * than ACTUAL_NEWEST_CHECKED_MIGRATION in frontend/src/pages/imports/actual/constants.ts, since a
 * release that stored those amounts at another scale would otherwise import each 100 times off, and
 * nothing in the file says which scale it used. When the yen test fails on the guard, recheck the
 * release by hand and then raise the constant. Never loosen the test to let the refusal pass
 *
 * 1. Start the release's server with `docker run --rm -p 127.0.0.1:5006:5006
 *    ghcr.io/actualbudget/actual:<version>`, open http://localhost:5006 and set a password
 * 2. Create a budget. In Settings, turn on currency support among the experimental features and
 *    choose Japanese Yen as the default currency
 * 3. Add an on-budget account, type a transaction of ¥1,234 into it, and budget ¥5,000 for a
 *    category in the current month, all through Actual's own screens
 * 4. Export the budget from Settings, unzip it, and read db.sqlite. Actual 26.9 stores the
 *    transaction as 123400 in transactions.amount and the figure as 5000 in zero_budgets.amount
 * 5. If the release stores both the same way, set the constant to the newest migration the failure
 *    names. If it doesn't, the importer has to read the new scale before the constant moves
 */
test('the yen budget imports to what Actual reports, on a release the importer was checked against', async ({ page, request }, testInfo) => {
  const manifest = await readManifest('yen')
  const checked = runInfo.importer.newestCheckedMigration
  const isNewer = manifest.databaseVersion === null || manifest.databaseVersion > checked
  const started = await startImport(page, request, manifest)

  if (started.isRefused) {
    await writeReport(testInfo, manifest, { outcome: 'refused by the version guard', skipped: null, differences: [], unexpected: [], stale: [] })
    if (!isNewer) {
      throw new Error(`The version guard refused the yen budget from ${describeRelease()}, whose newest migration ${manifest.databaseVersion} the importer was checked against`)
    }
    const added = runInfo.actual.migrations.filter((migration) => migration.id > checked)
    throw new Error(
      `The importer's version guard refuses the yen budget from ${describeRelease()}, whose file carries migrations `
      + `newer than ${checked}: ${added.map((migration) => `${migration.id} (${migration.file})`).join(', ')}. Recheck how this `
      + 'release stores yen with the procedure above the yen test in e2e/actual-check/import.spec.ts, then raise '
      + 'ACTUAL_NEWEST_CHECKED_MIGRATION. Do not loosen this test',
    )
  }
  if (isNewer) {
    await writeReport(testInfo, manifest, { outcome: 'taken although the version guard should refuse it', skipped: null, differences: [], unexpected: [], stale: [] })
    throw new Error(`The import screen took the yen budget from ${describeRelease()}, whose newest migration ${manifest.databaseVersion} is newer than the ${checked} the importer was checked against, so its version guard did not fire`)
  }
  await importAndCompare(page, request, testInfo, manifest, started)
})

// An edge server image reports the release it builds towards, so a nightly API seed is named too
function describeRelease() {
  const release = `Actual ${runInfo.actualVersion}`
  return runInfo.apiVersion === runInfo.actualVersion ? release : `${release} seeded with @actual-app/api ${runInfo.apiVersion}`
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

  /** Whether the importer's version guard refused the export */
  isRefused: boolean
}

/**
 * Signs up a new user, opens the Actual import and uploads the budget's export, which the screen
 * either stages or refuses on its version guard. Any other refusal fails the test with the
 * screen's own words
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

  const staged = page.getByText('export.zip', { exact: true })
  const refused = page.getByText(VERSION_GUARD_REFUSAL, { exact: true })
  try {
    await expect(staged.or(refused)).toBeVisible()
  } catch {
    const card = page.getByRole('button', { name: /Upload budget export/ })
    throw new Error(`The import screen neither staged the ${manifest.budget} export nor refused it on its version: ${await card.innerText().catch(() => 'no upload card')}`)
  }
  return { user, uploads, isRefused: await refused.isVisible() }
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

  const lumina = await readLumina(request, user) as ActualLuminaSnapshot
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
  result: { outcome: string; skipped: unknown; differences: Difference[]; unexpected: Difference[]; stale: unknown[] },
) {
  const report = {
    budget: manifest.budget,
    actual: { version: runInfo.actualVersion, apiVersion: runInfo.apiVersion, asOf: runInfo.asOf },
    ...result,
  }
  await writeFile(testInfo.outputPath('comparison.json'), `${JSON.stringify(report, null, 2)}\n`)
}
