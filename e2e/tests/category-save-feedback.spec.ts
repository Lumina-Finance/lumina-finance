import { expect, test } from '@playwright/test'

import { createTaxAdvantagedCategory, signUpUser } from '../support/api'
import { logInViaApi, openPage, waitForDialogFocus } from '../support/app'

test.describe('tax-advantaged category save feedback', () => {
  test('confirms a saved year in the shared message, closes its dialogue and shows a failed one once, in the dialogue', async ({ page, request }) => {
    const user = await signUpUser(request)
    await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
    await logInViaApi(page, user)
    await openPage(page, '/settings#tax-advantaged-categories')
    const category = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
    await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
    await category.getByRole('button', { name: 'Add year', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New year', exact: true })
    const dismiss = page.getByRole('button', { name: 'Dismiss message', exact: true })

    // The dialogue moves focus onto its first field a frame after it opens. A fill that has focused the
    // limit field by then has its text typed into the year field instead, so the fills wait for that focus
    await waitForDialogFocus(dialog)

    // A server that cannot be reached leaves one message, under the dialogue's own fields, and nothing floating
    await dialog.getByRole('textbox', { name: 'New tax year', exact: true }).fill('2019')
    const limit = dialog.getByRole('textbox', { name: 'New tax-year contribution limit', exact: true })
    await limit.fill('5000')
    await expect(limit).toHaveValue('5000')
    // Fails the first save only, so the save after it reaches the server
    await page.route('**/tax-advantaged-categories/*/limits', (route) => route.abort('failed'), { times: 1 })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(1)
    await expect(dialog.getByRole('alert')).toHaveText("Couldn't reach the server. Please try again.")
    // Messages that float over the page sit straight under the body
    await expect(page.locator('body > [role="alert"]')).toHaveCount(0)
    await expect(dismiss).toHaveCount(0)

    // The same save going through is confirmed in the message every page shares, which can be dismissed
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('body > [role="status"]').filter({ hasText: 'Limits saved.' })).toBeVisible()
    await expect(dismiss).toBeVisible()

    // Saving the new year closes its dialogue, rather than opening the saved year, and leaves the category open
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: '2019', exact: true })).toHaveCount(0)
    await expect(category).toBeVisible()
    await expect(category.getByRole('row').filter({ hasText: '2019' })).toBeVisible()
  })
})
