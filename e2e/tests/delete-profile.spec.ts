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

  // The message shows once, so reloading the sign-in screen drops it
  await page.reload()
  await expect(page.getByRole('button', { name: 'Log in', exact: true })).toBeVisible()
  await expect(page.getByText('Your profile and data were deleted.')).toHaveCount(0)

  const signIn = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: user.password } })
  expect(signIn.status()).toBe(401)
})

test('asks for the word again after the password step is closed', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  const open = page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true })
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })

  await open.click()
  await dialog.getByRole('textbox').fill('delete')
  await dialog.getByRole('button', { name: 'Delete profile', exact: true }).click()
  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await expect(stepUp).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(stepUp).toBeHidden()

  await open.click()
  await expect(dialog.getByRole('textbox')).toHaveValue('')
})

test('holds the deletion until the export the dialogue started has finished', async ({ page, request }) => {
  const user = await signUpUser(request)
  await logInViaApi(page, user)
  await openPage(page, '/settings')
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  await page.route('**/me/export', async (route) => {
    await held
    await route.continue()
  })

  await page.locator('#delete-profile').getByRole('button', { name: 'Delete profile', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete your profile and all your data?' })
  await dialog.getByRole('button', { name: 'Export all data' }).click()
  await dialog.getByRole('textbox').fill('delete')
  const confirm = dialog.getByRole('button', { name: 'Delete profile', exact: true })
  await expect(confirm).toBeDisabled()
  // Enter in the field asks to confirm as the button would, and is held off the same way
  await dialog.getByRole('textbox').press('Enter')
  const stepUp = page.getByRole('dialog', { name: 'Delete profile' })
  await expect(stepUp).toBeHidden()
  await expect(dialog).toBeVisible()

  const downloaded = page.waitForEvent('download')
  release()
  await downloaded
  await confirm.click()
  await expect(stepUp).toBeVisible()
})
