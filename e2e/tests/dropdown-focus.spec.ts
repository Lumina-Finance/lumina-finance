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
