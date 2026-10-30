/**
 * Driving an import to the point where the user undoes it and the importer opens again, for the
 * specs about what that moment looks like
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test'

import { createAccount, signUpUser } from './api'
import { commitImport, logInViaApi, openPage } from './app'

/** How the user reaches a control: with a pointer or with the keyboard alone */
export type Input = 'mouse' | 'keyboard'

export const UNDO_SIZES = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
]

export const UNDO_FILE_NAME = 'undo-controls.csv'

// The row dated February 31 is skipped, which keeps the finished import on screen to be read
const CSV = ['Date,Amount,Merchant', '2024-03-15,-12.50,Market', '2024-02-31,-9.99,Market', '2024-03-16,-4.00,Market'].join('\n')

/**
 * Runs an import and leaves it finished on screen
 *
 * @param page - Page to drive
 * @param request - Request context for the setup the page does not do
 * @param size - Window size to run at
 * @returns The button reading Imported
 */
export async function finishImport(page: Page, request: APIRequestContext, size: { width: number, height: number }) {
  await page.setViewportSize(size)
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday', startingBalance: 10000 })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: UNDO_FILE_NAME, mimeType: 'text/csv', buffer: Buffer.from(CSV) })
  await commitImport(page)
  await page.getByRole('dialog').getByRole('button', { name: 'Review skipped rows', exact: true }).click()
  const imported = page.getByRole('button', { name: 'Imported', exact: true })
  await expect(imported).toBeDisabled()
  return imported
}

/** Undoes the finished import, confirming the dialogue with a click or with the keyboard */
export async function undoImport(page: Page, input: Input) {
  await page.getByRole('button', { name: `Undo import of ${UNDO_FILE_NAME}` }).click()
  const confirm = page.getByRole('dialog', { name: 'Undo this import?' }).getByRole('button', { name: 'Undo import', exact: true })
  if (input === 'keyboard') await confirm.press('Enter')
  else await confirm.click()
}
