import { expect, test, type Locator, type Page } from '@playwright/test'

import { createAccount, createTaxAdvantagedCategory, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

const PHONE_SIZES = [
  { width: 390, height: 844 },
  { width: 390, height: 667 },
]

/** Polled while the message shows, since it moves up out of the way over a moment. False once it has gone */
function isClearOfToast(page: Page, toastText: string, targets: Locator[]) {
  return async () => {
    const toast = page.locator('body > [role="status"]').filter({ hasText: toastText })
    if (!await toast.isVisible()) return false
    const toastBox = await toast.boundingBox()
    if (!toastBox) return false
    for (const target of targets) {
      const box = await target.boundingBox()
      if (!box) return false
      const overlaps = box.x < toastBox.x + toastBox.width && box.x + box.width > toastBox.x
        && box.y < toastBox.y + toastBox.height && box.y + box.height > toastBox.y
      if (overlaps) return false
    }
    return true
  }
}

for (const size of PHONE_SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size })

    test('keeps the Limits saved message off the year dialogue\'s Save and Cancel buttons', async ({ page, request }) => {
      const user = await signUpUser(request)
      await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
      await logInViaApi(page, user)
      await openPage(page, '/settings#tax-advantaged-categories')
      await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
      await page.getByRole('dialog', { name: 'Retirement Savings', exact: true }).getByRole('button', { name: 'Add year', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'New year', exact: true })
      await dialog.getByRole('textbox', { name: 'New tax year', exact: true }).fill('2019')
      await dialog.getByRole('textbox', { name: 'New tax-year contribution limit', exact: true }).fill('5000')
      await dialog.getByRole('button', { name: 'Save', exact: true }).click()

      await expect(page.locator('body > [role="status"]').filter({ hasText: 'Limits saved.' })).toBeVisible()
      // The dialogue now shows the saved year, with its own Cancel and Save
      const save = page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true })
      const cancel = page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true })
      await expect(save).toBeVisible()
      await expect.poll(isClearOfToast(page, 'Limits saved.', [save, cancel])).toBe(true)
    })

    test('keeps the Saving account link message off the linked count under the account list', async ({ page, request }) => {
      const user = await signUpUser(request)
      await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
      const account = await createAccount(request, user, { name: 'Link account' })
      await logInViaApi(page, user)
      await openPage(page, '/settings#tax-advantaged-categories')
      await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
      const category = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
      await category.getByRole('tab', { name: 'Accounts', exact: true }).click()
      const checkbox = category.getByRole('checkbox', { name: /Link account$/ })
      await expect(checkbox).toBeVisible()
      // Slow enough that the message is still showing when it is measured
      await page.route(`**/accounts/${account.id}`, async (route) => {
        if (route.request().method() !== 'GET') await new Promise((resolve) => setTimeout(resolve, 3000))
        return route.continue()
      }, { times: 1 })
      await checkbox.click()

      await expect(page.locator('body > [role="status"]').filter({ hasText: 'Saving account link...' })).toBeVisible()
      await expect.poll(isClearOfToast(page, 'Saving account link...', [category.getByText(/^\d+ of \d+ linked$/)])).toBe(true)
    })
  })
}
