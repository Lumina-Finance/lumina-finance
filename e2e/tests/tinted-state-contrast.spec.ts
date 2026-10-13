import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { chooseFromDropdown, logInViaApi, openModal, openPage } from '../support/app'
import { faintestText } from '../support/contrast'

/**
 * Guards the contrast of text on the states that lay a tint over the surface under them: a field in error,
 * an open dropdown's highlighted and chosen rows, a row the import leaves out and the archive warning.
 * Each tint took the faint or muted text on it below the 4.5:1 every text needs
 */

// One column the reader maps to Amount on its own, and one it maps to nothing and leaves out
const CSV = ['Date,Merchant,Amount,Batch', '2026-03-15,Kiosk,-12.00,B7'].join('\n')

async function expectReadable(area: Locator, label: string) {
  // Read until the area has come in, since text not yet on screen measures as nothing to read
  await expect.poll(async () => (await faintestText(area)).text, { message: label }).toMatch(/\S/)
  const faintest = await faintestText(area)
  expect(faintest.contrast, `"${faintest.text}" ${label}`).toBeGreaterThanOrEqual(4.5)
}

async function openImport(page: Page, request: Parameters<typeof signUpUser>[0]) {
  const user = await signUpUser(request)
  const account = await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, `/settings/imports?account=${account.id}`)
  const upload = page.locator('input[type="file"][accept=".csv,text/csv"]')
  await expect(upload).toBeEnabled()
  await upload.setInputFiles({ name: 'spending.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) })
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`in the ${colorScheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    })

    async function expectTheme(page: Page) {
      await expect(page.locator('html')).toHaveClass(colorScheme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/)
    }

    test('draws an open dropdown\'s highlighted and chosen rows at full contrast', async ({ page, request }) => {
      await openImport(page, request)
      await expectTheme(page)

      // The Amount column comes in mapped to Amount. Every option carries a hint under its label
      await page.getByRole('combobox', { name: /Amount$/ }).click()
      const chosen = page.getByRole('option', { selected: true })
      await expect(chosen).toBeVisible()

      // The list opens with the keyboard on the chosen row, and the next press moves it to the row after
      await expect(chosen).toHaveClass(/app-dropdown-row-highlighted/)
      await expectReadable(chosen, 'on the chosen row while highlighted')
      await page.keyboard.press('ArrowDown')
      await expect(chosen).not.toHaveClass(/app-dropdown-row-highlighted/)
      await expectReadable(chosen, 'on the chosen row')
      await expectReadable(page.locator('.app-dropdown-row-highlighted'), 'on a highlighted row')
    })

    test('draws a column the import leaves out at full contrast', async ({ page, request }) => {
      await openImport(page, request)
      await expectTheme(page)
      await expectReadable(page.getByRole('row').filter({ hasText: 'Ignored' }), 'on the ignored column\'s row')
    })

    test('draws a money field in error at full contrast', async ({ page, request }) => {
      const user = await signUpUser(request)
      await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)
      await openPage(page, '/transactions')
      await expectTheme(page)
      const dialog = await openModal(page, ['Add Transaction', 'Add transaction'], 'Add Transaction')
      // The field shows the currency symbol once an account gives it a currency
      await chooseFromDropdown(dialog, 'Account', 'Everyday')
      await dialog.getByTestId('transaction-submit').click()
      const amount = dialog.locator('#txn-amount')
      await expect(amount).toHaveClass(/app-input-error/)
      await expect(amount.locator('..').getByText('$', { exact: true })).toBeVisible()
      await expectReadable(amount.locator('..'), 'in the amount field')
    })

    test('draws the archive warning at full contrast', async ({ page, request }) => {
      const user = await signUpUser(request)
      const account = await createAccount(request, user, { name: 'Everyday' })
      await logInViaApi(page, user)
      await openPage(page, `/accounts/${account.id}`)
      await expectTheme(page)
      await page.getByRole('button', { name: 'Edit account', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Edit Account', exact: true })
      await dialog.getByText('Archive account', { exact: true }).click()
      await expect(dialog.getByRole('switch')).toBeChecked()
      const heading = dialog.getByText('Balance will be set to zero', { exact: true })
      // The dialog scrolls the warning up from under its footer as it opens, so read it once its closing
      // sentence is in view
      await expect(dialog.getByText('no balance adjustment will be recorded', { exact: false })).toBeInViewport({ ratio: 1 })
      await expectReadable(heading.locator('xpath=../../..'), 'in the archive warning')
    })
  })
}
