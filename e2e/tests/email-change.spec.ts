/**
 * Guards changing the account email from the Security card: Save asks for the password, the new address
 * is emailed a link, opening it in the signed-in browser and clicking Confirm email changes the address
 * and signs the browser out, and from then on only the new address logs in
 */
import { expect, test } from '@playwright/test'

import { signUpUser } from '../support/api'
import { expectSignedIn, logIn, logInViaApi, openPage } from '../support/app'
import { waitForEmailChangeLink } from '../support/mail'

// Runs on desktop only: the card, its dialogue and the confirm page behave the same at every size

test('changes the email through the Security card and the emailed link', async ({ page, request }) => {
  const user = await signUpUser(request)
  const newEmail = `e2e-${crypto.randomUUID()}@example.com`
  await logInViaApi(page, user)
  await openPage(page, '/settings#security')

  const card = page.locator('#security')
  await card.getByLabel('Email', { exact: true }).fill(newEmail)
  await card.getByRole('button', { name: 'Save', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" })
  await dialog.getByLabel('Current password').fill(user.password)
  await dialog.getByRole('button', { name: 'Send email' }).click()

  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('status').filter({ hasText: 'sent a confirmation email' })).toHaveText(
    `We've sent a confirmation email to ${newEmail}. Please confirm your email using the link included in the email.`,
  )
  // The address on the account stays as it was until the link is used
  await expect(card.getByLabel('Email', { exact: true })).toHaveValue(user.email)

  // The requester usually opens the link in the browser they asked from, so it is opened signed in. The
  // page only asks, since a mail scanner opening the link must not spend it
  await page.goto(await waitForEmailChangeLink(newEmail))
  await expect(page.getByRole('heading', { name: 'Confirm your new email' })).toBeVisible()
  await page.getByRole('button', { name: 'Confirm email' }).click()
  await expect(page.getByRole('heading', { name: 'Email changed' })).toBeVisible()
  await expect(page.getByText(`Your email is now ${newEmail}. Please log in with it.`)).toBeVisible()

  // Every session ended, this browser's included, so the login page shows instead of sending the browser home
  await page.getByRole('link', { name: 'Log in' }).click()
  await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()

  await page.getByLabel('Email').fill(user.email)
  await page.getByLabel('Password', { exact: true }).fill(user.password)
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Incorrect email or password. Please try again.')).toBeVisible()

  await logIn(page, { ...user, email: newEmail })
  await expectSignedIn(page)
})
