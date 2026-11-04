/**
 * Staging the Firefly III export the import specs share
 */

import { fileURLToPath } from 'node:url'
import { expect, type Page } from '@playwright/test'

import { chooseFromDropdown, leaveImportSetup, openPage, showImportSetup } from './app'

// Copies of the export the frontend's unit tests read, written by a local Firefly III server from
// the weekly check's seed. The suite runs from its own directory alone, so it holds the copies
// rather than reaching into the frontend's
const EXPORT_FILES = ['transactions.csv', 'budgets.csv', 'accounts.csv']
  .map((name) => fileURLToPath(new URL(`../fixtures/firefly-export/${name}`, import.meta.url)))

/**
 * Opens the importer on Firefly III and stages the three export files, leaving the setup panel
 *
 * @param page - Page of a signed-in user
 */
export async function stageFireflyExport(page: Page): Promise<void> {
  await openPage(page, '/settings/imports')
  await chooseFromDropdown(page.locator('body'), 'Data source', /^Firefly III/)

  // The screen reads one file at a time and refuses another meanwhile, so each lands before the next
  const uploads = page.locator('input[type="file"][accept=".csv,text/csv"]')
  for (const [index, file] of EXPORT_FILES.entries()) {
    await expect(uploads.nth(index)).toBeEnabled()
    await uploads.nth(index).setInputFiles(file)
    // The setup panel collapses once the last file lands, so it is slid out to see that file
    if (index === EXPORT_FILES.length - 1) await showImportSetup(page)
    await expect(page.getByText(file.split('/').at(-1)!, { exact: true })).toBeVisible()
  }
  await leaveImportSetup(page)
}
