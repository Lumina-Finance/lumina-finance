import { expect, test, type Page } from '@playwright/test'

import { chooseFromDropdown, commitImport, logInViaApi, openPage } from '../support/app'
import { createAccount, signUpUser } from '../support/api'
import { buildBankMessageSet, buildFile, CAFE } from '../support/ofx'

// Runs on desktop only: where the import page leads back to is the same at every size

const CLOSE_NAME = 'Close import workflow'

async function expectPath(page: Page, pathname: string) {
  await expect.poll(() => new URL(page.url()).pathname).toBe(pathname)
}

/**
 * Imports one OFX statement from the open import page and presses Done on the result
 */
async function importStatementAndPressDone(page: Page) {
  await chooseFromDropdown(page.locator('body'), 'Data source', 'OFX/QFX')
  const upload = page.locator('input[type="file"][accept*=".ofx"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({
    name: 'statement.ofx',
    mimeType: 'application/octet-stream',
    buffer: Buffer.from(buildFile([buildBankMessageSet('CAD', [CAFE])])),
  })
  await commitImport(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Done', exact: true }).click()
}

test('closes back to the Transactions page the import was opened from', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)

  await openPage(page, '/transactions')
  await page.getByRole('button', { name: 'Import transactions', exact: true }).click()
  await expectPath(page, '/settings/imports')
  await page.getByRole('button', { name: CLOSE_NAME }).click()
  await expectPath(page, '/transactions')
})

test('closes back to Settings when the import was opened from Settings', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)

  await openPage(page, '/settings')
  await page.getByRole('button', { name: 'Import', exact: true }).first().click()
  await expectPath(page, '/settings/imports')
  await page.getByRole('button', { name: CLOSE_NAME }).click()
  await expectPath(page, '/settings')
})

test('closes to Settings when the import page was opened directly', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)

  await openPage(page, '/settings/imports')
  await page.getByRole('button', { name: CLOSE_NAME }).click()
  await expectPath(page, '/settings')
})

test('closes back to the account an import was opened for', async ({ page, request }) => {
  const user = await signUpUser(request)
  const checking = await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)

  await openPage(page, `/accounts/${checking.id}`)
  await page.getByRole('button', { name: 'Import transactions into this account', exact: true }).click()

  // Close leads to the account only once the page has checked that the account can be imported into
  await expect(page.getByRole('combobox', { name: 'Data source' })).toBeVisible()
  await page.getByRole('button', { name: CLOSE_NAME }).click()
  await expectPath(page, `/accounts/${checking.id}`)
})

// The reload checks that the origin lives in the browser's history entry, not in memory, so a user
// who refreshes mid-import still gets back to where they started
test('finishes an import back on the Transactions page it was opened from', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Checking' })
  await logInViaApi(page, user)

  await openPage(page, '/transactions')
  await page.getByRole('button', { name: 'Import transactions', exact: true }).click()
  await page.reload()
  await importStatementAndPressDone(page)
  await expectPath(page, '/transactions')
})

test('finishes an import opened directly on the home page', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)

  await openPage(page, '/settings/imports')
  await importStatementAndPressDone(page)
  await expectPath(page, '/')
})
