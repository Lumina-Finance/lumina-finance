/**
 * Imports the seeded Firefly III exports through the real import screen as a new user, then
 * compares what Lumina holds with what Firefly III's own API said about the same data
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'
import { checkExpected, compareImport } from './compare.ts'
import { EXPECTED_DIFFERENCES } from './expected-differences.ts'
import { readLumina } from './lumina.ts'
import { buildUploadFixture, type CapturedUpload } from './upload-fixture.ts'
import type { FireflyManifest, FireflyRunInfo } from './manifest.ts'

const OUTPUT_DIR = join(import.meta.dirname, 'output')

test('a Firefly III export imports to the balances, totals and budgets Firefly III reports', async ({ page, request }, testInfo) => {
  const read = (name: string) => readFile(join(OUTPUT_DIR, name), 'utf8').catch(() => {
    throw new Error(`${name} is missing from ${OUTPUT_DIR}. Run firefly-check/seed.sh first`)
  })
  const manifest = JSON.parse(await read('manifest.json')) as FireflyManifest
  const runInfo = JSON.parse(await read('run.json')) as FireflyRunInfo

  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data Source', /^Firefly III/)

  // Every request of the import run, kept in the results beside the comparison with the commit's
  // summary, and made into the fixture the backend test replays
  const uploads: (CapturedUpload & { response: unknown })[] = []
  page.on('response', async (response) => {
    const path = response.url().slice(API_BASE_URL.length)
    const method = response.request().method()
    if (!['POST', 'PUT'].includes(method) || !path.startsWith('/transactions/import/runs')) return
    uploads.push({ method, path, body: response.request().postDataJSON(), response: await response.json().catch(() => null) })
  })

  const files = page.locator('input[type="file"][accept=".csv,text/csv"]')
  // The screen reads one file at a time and refuses another meanwhile, so each lands before the next
  for (const [index, name] of ['transactions.csv', 'budgets.csv'].entries()) {
    await expect(files.nth(index)).toBeEnabled()
    await files.nth(index).setInputFiles(join(OUTPUT_DIR, name))
    await expect(page.getByText(name, { exact: true })).toBeVisible()
  }

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()
  const progress = page.getByRole('dialog', { name: 'Import progress' })
  // A failed or stopped import ends the wait too, and fails with what the dialog says. The import
  // is most of the test, so only the test's own timeout bounds the wait, not the minute an
  // expectation gets
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
  await progress.getByRole('button', { name: 'Done', exact: true }).click()
  const lumina = await readLumina(request, user)
  const differences = compareImport(manifest, runInfo, lumina)
  const { unexpected, stale } = checkExpected(differences, EXPECTED_DIFFERENCES)

  const report = { firefly: runInfo, skipped, differences, unexpected, stale }
  await writeFile(testInfo.outputPath('comparison.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(testInfo.outputPath('uploads.json'), `${JSON.stringify(uploads, null, 2)}\n`)
  const fixture = buildUploadFixture(uploads, lumina, manifest, runInfo)
  await writeFile(testInfo.outputPath('upload-fixture.json'), `${JSON.stringify(fixture, null, 2)}\n`)

  expect(unexpected, 'differences from Firefly III that are not on the expected list').toEqual([])
  expect(stale, 'expected differences that no longer occur, which should come off the list').toEqual([])
})
