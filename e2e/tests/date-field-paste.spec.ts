import { expect, test, type Locator } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'

// Runs on desktop only: pasting works the same at every size

/**
 * Guards pasting a whole date into the date field. A paste lands in one part of the field, which kept
 * four digits for the year and dropped the rest, so the old date stayed
 */

/** Pastes text into a part of the field as the browser does, from a paste event carrying the clipboard */
async function paste(target: Locator, text: string) {
  await target.focus()
  await target.evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, text)
}

test('fills every part of the date from a whole date pasted into any part, and ignores a day that does not exist', async ({
  page,
  request,
}) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const [year, month, day] = ['Year', 'Month', 'Day'].map((name) => dialog.getByRole('textbox', { name, exact: true }))
  const date = async () => [await year.inputValue(), await month.inputValue(), await day.inputValue()].join('-')

  await paste(year, '2026-10-01')
  expect(await date()).toBe('2026-10-01')

  await paste(day, '20250704')
  expect(await date()).toBe('2025-07-04')

  await paste(month, '2026/2/9')
  expect(await date()).toBe('2026-02-09')

  await paste(day, '2026-02-30')
  expect(await date()).toBe('2026-02-09')
})
