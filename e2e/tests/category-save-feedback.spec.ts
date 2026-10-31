import { expect, test } from '@playwright/test'

import { createTaxAdvantagedCategory, signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'

test.describe('tax-advantaged category save feedback', () => {
  test('confirms a saved year in the shared message and shows a failed one once, in the dialogue', async ({ page, request }) => {
    const user = await signUpUser(request)
    await createTaxAdvantagedCategory(request, user, 'Retirement Savings')
    await logInViaApi(page, user)
    await openPage(page, '/settings#tax-advantaged-categories')
    const category = page.getByRole('dialog', { name: 'Retirement Savings', exact: true })
    await page.getByRole('row').filter({ hasText: 'Retirement Savings' }).click()
    await category.getByRole('button', { name: 'Add year', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'New year', exact: true })
    const dismiss = page.getByRole('button', { name: 'Dismiss message', exact: true })

    // A server that cannot be reached leaves one message, under the dialogue's own fields, and nothing floating
    await dialog.getByRole('textbox', { name: 'New tax year', exact: true }).fill('2019')
    await dialog.getByRole('textbox', { name: 'New tax-year contribution limit', exact: true }).fill('5000')
    // Fails the first save only, so the save after it reaches the server
    await page.route('**/tax-advantaged-categories/*/limits', (route) => route.abort('failed'), { times: 1 })
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(dialog.getByRole('alert')).toHaveCount(1)
    // Messages that float over the page sit straight under the body
    await expect(page.locator('body > [role="alert"]')).toHaveCount(0)
    await expect(dismiss).toHaveCount(0)

    // The same save going through is confirmed in the message every page shares, which can be dismissed
    await dialog.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('body > [role="status"]').filter({ hasText: 'Limits saved.' })).toBeVisible()
    await expect(dismiss).toBeVisible()
  })
})
