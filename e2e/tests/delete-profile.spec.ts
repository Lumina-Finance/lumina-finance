/**
 * Guards Delete profile at the bottom of Settings: the dialogue holds off until the user types delete,
 * the password confirms it, the app lands on the sign-in screen saying the profile is gone, and the
 * password no longer signs in
 */
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { logInViaApi, openPage } from '../support/app'
import { API_BASE_URL } from '../support/target'

// Runs on desktop only: the section and its dialogue behave the same at every size

const DELETE_URL = `${API_BASE_URL}/auth/profile/delete`

test('deletes the profile once the user types delete and confirms with the password', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })

  // Pressing Delete profile before typing the word only says what is missing
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()
  await expect(dialog.getByRole('alert')).toHaveText('Please type delete to confirm')

  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()

  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await stepUp.getByLabel('Current password').fill(user.password)
  const deleted = page.waitForResponse((response) => response.url() === DELETE_URL && response.request().method() === 'POST')
  await stepUp.getByRole('button', { name: 'Delete profile', exact: true }).click()
  expect((await deleted).status()).toBe(204)

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('status').filter({ hasText: 'Your profile and data were deleted.' })).toBeVisible()

  const signIn = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: user.password } })
  expect(signIn.status()).toBe(401)
})
