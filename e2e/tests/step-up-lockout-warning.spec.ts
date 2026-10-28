import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { ACROSS_ORIGINS } from '../support/origins'
import { API_BASE_URL, BASE_URL } from '../support/target'

// Runs in the cross-origin project only: the warning reads the same at every size, but it needs the API on another origin

// The browser can read the attempts count only when the API lists the header as exposed to another
// origin, so the warning shows nothing unless the two origins differ, as they do on the dev instance
test('warns how many attempts remain after a wrong step-up password', ACROSS_ORIGINS, async ({ page, request }) => {
  expect(new URL(API_BASE_URL).origin).not.toBe(new URL(BASE_URL).origin)

  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  await page.locator('#security').getByRole('button', { name: 'Manage' }).click()
  await page.getByRole('button', { name: 'Enable' }).click()
  await page.getByRole('dialog').getByLabel('Current password').fill(`${user.password}-wrong`)
  await page.getByRole('button', { name: 'Continue' }).click()

  // The wording is pinned by the unit tests, so this only needs a count of attempts to be shown
  await expect(page.getByText(/\d+ attempts? remaining/)).toBeVisible()
})
