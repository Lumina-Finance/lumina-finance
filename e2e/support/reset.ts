/**
 * Driving the password reset pages, from asking for a link on the login page to submitting a new password.
 */

import { expect, type Page } from '@playwright/test'

import { waitForResetLink } from './mail'

/**
 * Ask for a reset link from the login page.
 *
 * @param page - Page to drive
 * @param email - Address of the account to reset
 * @returns The link the app emailed
 */
export async function requestResetLink(page: Page, email: string): Promise<string> {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Forgot password?', exact: true }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText(`If an account exists for ${email}`)).toBeVisible()
  return waitForResetLink(email)
}

/**
 * Open the emailed link and submit a new password.
 *
 * @param page - Page to drive
 * @param link - Link from `requestResetLink`
 * @param password - New password, typed in both fields
 */
export async function chooseNewPassword(page: Page, link: string, password: string): Promise<void> {
  await page.goto(link)
  await page.getByLabel('New password', { exact: true }).fill(password)
  await page.getByLabel('Confirm new password').fill(password)
  await page.getByRole('button', { name: 'Reset password' }).click()
}
