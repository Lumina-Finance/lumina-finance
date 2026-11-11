import { expect, test } from '@playwright/test'

import { createAccount, signUpUser } from '../support/api'
import { logInViaApi, openModal, openPage } from '../support/app'

// Runs on desktop only: the dropdown's tab order is the same at every size

/**
 * Guards focus on the shared dropdown. Its press animation used to put a second, silent Tab stop on
 * the box around its button
 */

// Motion on, since the press animation is what made the box a stop
test('is one Tab stop, on its button', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const field = dialog.getByRole('combobox').first()

  // The dialog moves focus into itself a frame after it opens, so that lands before the test moves it
  await expect.poll(() => dialog.evaluate((node) => node.contains(document.activeElement))).toBe(true)
  await field.focus()
  await page.keyboard.press('Shift+Tab')
  // Focus left the field for whatever comes before it, not for the box the field sits in
  expect(await field.evaluate((node) => !!document.activeElement?.contains(node))).toBe(false)
  await page.keyboard.press('Tab')
  await expect(field).toBeFocused()
})

test('draws the focus ring on the search row of a searchable dropdown opened with the keyboard', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const timezone = page.locator('section#profile').getByRole('combobox', { name: 'Timezone', exact: true })
  await timezone.focus()
  await page.keyboard.press('Enter')

  const search = page.locator('[data-dropdown-search="true"]')
  await expect(search).toBeFocused()
  // The ring sits on the whole row around the field, inside its edge, as any focused text field shows it
  await expect
    .poll(() =>
      search.evaluate((input) => {
        const row = getComputedStyle(input.closest('.app-dropdown-search')!)
        return { color: row.outlineColor, width: row.outlineWidth }
      }),
    )
    .toEqual({ color: 'rgb(161, 126, 79)', width: '2px' })
})

// The create action closes with its list, so the dialogue it opened used to hand focus back to the page
test('returns focus to the dropdown once the dialogue its create action opened closes', async ({ page, request }) => {
  const user = await signUpUser(request)
  await createAccount(request, user, { name: 'Everyday' })
  await logInViaApi(page, user)
  await openPage(page, '/transactions')
  const dialog = await openModal(page, ['Add transaction'], 'Add transaction')
  const merchant = dialog.getByRole('combobox', { name: 'Merchant', exact: true })
  const addMerchant = page.getByRole('dialog', { name: 'Add merchant' })

  await merchant.click()
  await page.keyboard.type('Corner Bakery')
  await page.getByRole('button', { name: 'Create merchant "Corner Bakery"', exact: true }).click()
  await addMerchant.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(addMerchant).toBeHidden()
  await expect(merchant).toBeFocused()
  await expect(merchant).toContainText('Corner Bakery')

  await merchant.click()
  await page.keyboard.type('Second Shop')
  await page.getByRole('button', { name: 'Create merchant "Second Shop"', exact: true }).click()
  await expect(addMerchant).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(addMerchant).toBeHidden()
  await expect(merchant).toBeFocused()
})
