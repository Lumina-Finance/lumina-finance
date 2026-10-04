import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

import { countLedgerTransactions, createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

const COMMIT_URL = /\/transactions\/import\/runs\/[^/]+\/commit$/

// One category is new to the user and answered create, so the first save creates it and the
// refresh after the lost answer finds it, which must not count as a changed answer
const CSV = [
  'Date,Amount,Category,Merchant,Notes',
  '2024-03-15,-42.50,Groceries,Market,Weekly shop',
  '2024-03-16,1200.00,Salary,Employer,Pay',
  '2024-03-17,-18.25,Pottery classes,Studio,Term fee',
].join('\n')

/**
 * Stages a three-row CSV for an account of a fresh user, then saves it with the first save landing
 * but its answer lost, and checks the screen says so
 *
 * @returns How many transactions the ledger holds after that first save
 */
async function importWithLostAnswer(page: Page, request: APIRequestContext) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'interrupted.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await page.getByRole('combobox', { name: 'Existing Category Pottery classes', exact: true }).click()
  await page.getByRole('option', { name: 'Create new category' }).click()

  // The first save is held until the overlay has been checked mid-save, then lands with its answer lost
  let markFirstSaveHeld!: () => void
  let releaseFirstSave!: () => void
  const firstSaveHeld = new Promise<void>((resolve) => { markFirstSaveHeld = resolve })
  const firstSaveReleased = new Promise<void>((resolve) => { releaseFirstSave = resolve })
  let commitAttempts = 0
  await page.route(COMMIT_URL, async (route) => {
    commitAttempts += 1
    if (commitAttempts > 1) {
      await route.continue()
      return
    }
    markFirstSaveHeld()
    await firstSaveReleased
    const landed = await route.fetch()
    expect(landed.status()).toBe(201)
    await route.abort('connectionfailed')
  })

  const commit = page.getByRole('button', { name: 'Commit import', exact: true })
  await expect(commit).toBeEnabled()
  await commit.click()

  // Once the upload has handed over to the save, stopping can no longer undo anything, so it isn't offered
  const overlay = page.getByRole('dialog')
  await firstSaveHeld
  await expect(overlay.locator('[aria-current="step"]')).toContainText('Saving the import')
  await expect(overlay.getByRole('button', { name: 'Stop import', exact: true })).toHaveCount(0)
  releaseFirstSave()

  await expect(overlay.getByText('Save interrupted', { exact: true })).toBeVisible()
  await expect(overlay.getByRole('strong')).toHaveText('stay on the import page')
  const ledgerAfterFirstSave = await countLedgerTransactions(request, user)
  expect(ledgerAfterFirstSave).toBe(3)

  await overlay.getByRole('button', { name: 'Back to import', exact: true }).click()
  await expect(page.getByText('Save interrupted. Please try again.', { exact: true })).toBeVisible()
  return { overlay, user, ledgerAfterFirstSave }
}

// Importing again with the answers the interrupted save was sent with saves that kept upload, which
// lands it at most once
test('saves the kept upload once after a CSV save that landed but whose answer was lost', async ({ page, request }) => {
  const { overlay, user, ledgerAfterFirstSave } = await importWithLostAnswer(page, request)

  await page.getByRole('button', { name: 'Commit import', exact: true }).click()

  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await expect(overlay.getByText('3 transactions imported · 0 accounts created · 1 category created', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(ledgerAfterFirstSave)
})

// Importing again with an answer changed finds out first whether the interrupted save landed, and
// writes nothing when it had
test('imports nothing twice after a CSV save that landed but whose answer was lost', async ({ page, request }) => {
  const { overlay, user, ledgerAfterFirstSave } = await importWithLostAnswer(page, request)

  await page.getByRole('combobox', { name: 'Match To App Field Notes', exact: true }).click()
  await page.getByRole('option', { name: /^Do not import/ }).click()
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()

  await expect(overlay.getByText('Import complete', { exact: true })).toBeVisible()
  await expect(overlay.getByText('Your earlier import was saved, so this one wasn\'t imported.', { exact: true })).toBeVisible()
  expect(await countLedgerTransactions(request, user)).toBe(ledgerAfterFirstSave)
})
