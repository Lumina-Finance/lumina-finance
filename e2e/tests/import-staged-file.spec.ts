import { expect, test, type Locator } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

// No header row, four columns and one byte that isn't UTF-8, so the reader adds its note about the byte
const CSV = Buffer.concat([
  Buffer.from('2026-03-15,Kiosk,-12.00,Lunch\n2026-03-16,Caf'),
  Buffer.from([0xff]),
  Buffer.from(',-4.50,Coffee\n'),
])

/** Whether an element shows all of its text, rather than cutting it off */
async function showsWholeText(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element.scrollWidth <= element.clientWidth)
}

/** The top of an element on screen */
async function top(locator: Locator): Promise<number> {
  return (await locator.boundingBox())!.y
}

test('shows a staged file\'s whole name, its row count and its warning, with the remove button by the name', async ({ page, request }) => {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday chequing' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)

  const name = 'a-long-statement-export-name-for-the-chequing-account.csv'
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name, mimeType: 'text/csv', buffer: CSV })

  const fileName = page.getByText(name, { exact: true })
  const detail = page.getByText('2 rows · 4 columns · no header row', { exact: true })
  const warning = page.getByText('1 character could not be read', { exact: true })
  await expect(fileName).toBeVisible()
  await expect(detail).toBeVisible()
  await expect(warning).toBeVisible()
  // Wrapped onto as many lines as they need rather than cut off with an ellipsis
  expect(await showsWholeText(fileName)).toBe(true)
  expect(await showsWholeText(warning)).toBe(true)

  // The remove button sits at the top of the row, by the name's first line, however far the name wraps
  const remove = page.getByRole('button', { name: `Remove ${name}`, exact: true })
  expect(Math.abs(await top(remove) - await top(fileName))).toBeLessThan(8)
})
