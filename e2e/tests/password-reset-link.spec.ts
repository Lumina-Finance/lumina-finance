import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { reachTwoFactorChallenge } from '../support/app'
import { chooseNewPassword, requestResetLink } from '../support/reset'
import { API_BASE_URL } from '../support/target'
import { currentTotp, enrollTotp } from '../support/totp'

// Runs on desktop only: asking for a link and choosing a password behave the same at every size

const NEW_PASSWORD = 'N3wE2ePassw0rd!'
const RESET_DONE = 'Your password has been reset. You can now log in with your new password.'

test('refuses a reset link the second time it is used', async ({ page, request }) => {
  const user = await signUpUser(request)
  const link = await requestResetLink(page, user.email)

  await chooseNewPassword(page, link, NEW_PASSWORD)
  await expect(page.getByText(RESET_DONE)).toBeVisible()

  const reusedPassword = `${NEW_PASSWORD}2`
  await chooseNewPassword(page, link, reusedPassword)
  await expect(page.getByText('This reset link is invalid or has expired')).toBeVisible()
  await expect(page.getByText(RESET_DONE)).toHaveCount(0)

  // The second use changed nothing, so its password is refused
  const refused = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: reusedPassword } })
  expect(refused.status()).toBe(401)
})

test('asks a user with two-factor for an authenticator code before the reset takes effect', async ({ page, request }) => {
  const user = await signUpUser(request)
  const secret = await enrollTotp(request, user)
  const link = await requestResetLink(page, user.email)

  await chooseNewPassword(page, link, NEW_PASSWORD)
  const code = page.getByLabel('One-time code')
  await expect(code).toBeVisible()
  await expect(page.getByText(RESET_DONE)).toHaveCount(0)

  // The new password is not accepted while the code is still to come
  const early = await request.post(`${API_BASE_URL}/auth/login`, { data: { email: user.email, password: NEW_PASSWORD } })
  expect(early.status()).toBe(401)

  await code.fill(currentTotp(secret))
  await expect(page.getByText(RESET_DONE)).toBeVisible()

  // The old password is refused, and the new one leads to the second-factor step
  await page.goto('/login')
  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()
  await reachTwoFactorChallenge(page, { ...user, password: NEW_PASSWORD })
})
