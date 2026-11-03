import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { expectSignedIn, reachTwoFactorChallenge } from '../support/app'
import { currentTotp, enrollTotpWithRecoveryCodes } from '../support/totp'

// Runs on desktop only: the second-factor step behaves the same at every size

// A code the authenticator will not show for the steps around now, so Verify refuses it
const WRONG_CODE = '000000'

const WRONG_CODE_MESSAGE = 'That code was incorrect. Please try again.'

test('refuses a wrong authenticator code and signs in once the right one is entered', async ({ page, request }) => {
  const user = await signUpUser(request)
  const { secret } = await enrollTotpWithRecoveryCodes(request, user)

  // A refused code ends the challenge, so the password has to be sent again
  await reachTwoFactorChallenge(page, user)
  await page.getByLabel('One-time code').pressSequentially(WRONG_CODE)
  await expect(page.getByRole('alert')).toContainText(WRONG_CODE_MESSAGE)
  await expect(page.getByLabel('One-time code')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Accounts' })).toHaveCount(0)

  await reachTwoFactorChallenge(page, user)
  await page.getByLabel('One-time code').fill(currentTotp(secret))
  await expectSignedIn(page)
})

test('spends a recovery code on sign-in, asks for a new second factor and refuses the code a second time', async ({ page, browser, request }) => {
  const user = await signUpUser(request)
  const { recoveryCodes } = await enrollTotpWithRecoveryCodes(request, user)
  const [spentCode, otherCode] = recoveryCodes

  await reachTwoFactorChallenge(page, user)
  await page.getByRole('button', { name: 'Enter a recovery code instead' }).click()
  await page.getByPlaceholder('Recovery code').fill(spentCode)
  await page.getByRole('button', { name: 'Verify' }).click()

  // The recovery code removed the authenticator, so the account stays closed until a new factor is set up
  await expect(page.getByRole('heading', { name: 'Two-factor' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Accounts' })).toHaveCount(0)

  // Only recovery codes are left to sign in with, and the one just used no longer works
  const again = await browser.newPage()
  const signInWith = async (recoveryCode: string) => {
    await again.goto('/login')
    await again.getByLabel('Email').fill(user.email)
    await again.getByLabel('Password', { exact: true }).fill(user.password)
    await again.getByRole('button', { name: 'Log in' }).click()
    await again.getByPlaceholder('Recovery code').fill(recoveryCode)
    await again.getByRole('button', { name: 'Verify' }).click()
  }
  await signInWith(spentCode)
  await expect(again.getByRole('alert')).toContainText(WRONG_CODE_MESSAGE)

  await signInWith(otherCode)
  await expect(again.getByRole('heading', { name: 'Two-factor' })).toBeVisible()
  await again.close()
})
